import {
  Controller,
  Post,
  Get,
  UseGuards,
  Body,
  Res,
  Param,
  BadRequestException,
  NotFoundException,
  Logger,
  HttpCode
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiBody,
  ApiOperation
} from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { ExternalCodingImportService } from '../../database/services/coding';
import { ExternalCodingImportDto } from '../../../../../../api-dto/coding/external-coding-import.dto';
import { JobQueueService } from '../../job-queue/job-queue.service';
import { CacheService } from '../../cache/cache.service';

const TEMP_DIR = '/tmp/external-coding-import';

@ApiTags('Admin Workspace Coding')
@Controller('admin/workspace')
export class WorkspaceCodingImportController {
  private readonly logger = new Logger(WorkspaceCodingImportController.name);

  constructor(
    private externalCodingImportService: ExternalCodingImportService,
    private jobQueueService: JobQueueService,
    private cacheService: CacheService
  ) { }

  @Post(':workspace_id/coding/external-coding-import/stream')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description:
      'External coding file upload (CSV/Excel) with streaming progress. Only for preview mode (previewOnly=true).',
    type: ExternalCodingImportDto
  })
  @ApiOkResponse({
    description: 'External coding import preview with progress streaming',
    content: {
      'text/event-stream': {
        schema: {
          type: 'string'
        }
      }
    }
  })
  async importExternalCodingWithProgress(
    @WorkspaceId() workspace_id: number,
      @Body() body: ExternalCodingImportDto,
      @Res() res: Response
  ): Promise<void> {
    // Guard: SSE endpoint is only for preview mode
    if (body.previewOnly === false) {
      res.status(400).json({
        statusCode: 400,
        message: 'Use the /apply endpoint for applying changes. This endpoint is only for preview mode.'
      });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

    try {
      const result =
        await this.externalCodingImportService.importExternalCodingWithProgress(
          workspace_id,
          { ...body, previewOnly: true },
          (progress: number, message: string) => {
            res.write(`data: ${JSON.stringify({ progress, message })}\n\n`);
          }
        );

      // Send final result
      res.write(
        `data: ${JSON.stringify({
          progress: 100,
          message: 'Import completed',
          result
        })}\n\n`
      );
      res.end();
    } catch (error) {
      res.write(
        `data: ${JSON.stringify({
          progress: 0,
          message: `Import failed: ${error.message}`,
          error: true
        })}\n\n`
      );
      res.end();
    }
  }

  @Post(':workspace_id/coding/external-coding-import/apply')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @HttpCode(202)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOperation({
    summary: 'Apply external coding import via background job',
    description: 'Queues an external coding import job. Returns a job ID for polling progress.'
  })
  @ApiBody({
    description: 'External coding file upload (CSV/Excel)',
    type: ExternalCodingImportDto
  })
  async applyExternalCodingImport(
    @WorkspaceId() workspace_id: number,
      @Body() body: ExternalCodingImportDto
  ): Promise<{ jobId: string }> {
    if (!body.file) {
      throw new BadRequestException('File data is required.');
    }

    // Write base64 file to temp location to avoid bloating Redis
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
    const tempFileName = `${randomUUID()}-${body.fileName || 'import.csv'}`;
    const tempFilePath = path.join(TEMP_DIR, tempFileName);
    const fileBuffer = Buffer.from(body.file, 'base64');
    fs.writeFileSync(tempFilePath, fileBuffer);

    this.logger.log(
      `Wrote temp file for external coding import: ${tempFilePath} (${fileBuffer.length} bytes)`
    );

    const job = await this.jobQueueService.addExternalCodingImportJob({
      workspaceId: workspace_id,
      tempFilePath,
      fileName: body.fileName || 'external-coding.csv'
    });

    this.logger.log(
      `External coding import job ${job.id} queued for workspace ${workspace_id}`
    );

    return { jobId: job.id.toString() };
  }

  @Get(':workspace_id/coding/external-coding-import/job/:jobId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'jobId', type: String })
  @ApiOperation({
    summary: 'Get external coding import job status',
    description: 'Returns the status and progress of an external coding import job.'
  })
  async getExternalCodingImportJobStatus(
    @WorkspaceId() workspace_id: number,
      @Param('jobId') jobId: string
  ): Promise<{
        status: string;
        progress: number;
        result?: {
          message: string;
          processedRows: number;
          updatedRows: number;
          errorCount: number;
          affectedRowCount: number;
        };
        error?: string;
      }> {
    const job = await this.jobQueueService.getExternalCodingImportJob(jobId);
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    if (job.data.workspaceId !== workspace_id) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    const state = await job.getState();
    const progress = await job.progress();
    const failedReason = job.failedReason;

    let status: string;
    switch (state) {
      case 'completed':
        status = 'completed';
        break;
      case 'failed':
        status = 'failed';
        break;
      case 'active':
        status = 'processing';
        break;
      case 'waiting':
      case 'delayed':
        status = 'pending';
        break;
      case 'paused':
        status = 'paused';
        break;
      default:
        status = state;
    }

    return {
      status,
      progress: typeof progress === 'number' ? progress : 0,
      ...(status === 'completed' && job.returnvalue ?
        { result: job.returnvalue } :
        {}),
      ...(status === 'failed' && failedReason ? { error: failedReason } : {})
    };
  }

  @Get(':workspace_id/coding/external-coding-import/job/:jobId/result')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'jobId', type: String })
  @ApiOperation({
    summary: 'Get full external coding import result',
    description: 'Returns the full import result including affected rows from cache.'
  })
  async getExternalCodingImportResult(
    @WorkspaceId() workspace_id: number,
      @Param('jobId') jobId: string
  ): Promise<unknown> {
    // Verify job belongs to this workspace
    const job = await this.jobQueueService.getExternalCodingImportJob(jobId);
    if (!job || job.data.workspaceId !== workspace_id) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    const cacheKey = `external-coding-import-result:${jobId}`;
    const result = await this.cacheService.get(cacheKey);
    if (!result) {
      throw new NotFoundException(
        `Result for job ${jobId} not found. It may have expired.`
      );
    }

    return result;
  }

  @Post(':workspace_id/coding/external-coding-import')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'External coding file upload (CSV/Excel)',
    type: ExternalCodingImportDto
  })
  async importExternalCoding(
    @WorkspaceId() workspace_id: number,
      @Body() body: ExternalCodingImportDto
  ): Promise<{
        message: string;
        processedRows: number;
        updatedRows: number;
        errors: string[];
        affectedRows: Array<{
          unitAlias: string;
          variableId: string;
          personCode?: string;
          personLogin?: string;
          personGroup?: string;
          bookletName?: string;
          originalCodedStatus: string;
          originalCode: number | null;
          originalScore: number | null;
          updatedCodedStatus: string | null;
          updatedCode: number | null;
          updatedScore: number | null;
        }>;
      }> {
    return this.externalCodingImportService.importExternalCoding(workspace_id, body);
  }
}
