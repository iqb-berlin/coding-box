import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Res,
  UseGuards,
  Logger
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiParam,
  ApiBody,
  ApiTags
} from '@nestjs/swagger';
import { Response } from 'express';
import * as fs from 'fs';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { CodebookGenerationService } from '../../database/services/coding';
import { JobQueueService, CodebookJobResult } from '../../job-queue/job-queue.service';
import { CacheService } from '../../cache/cache.service';

@ApiTags('Admin Workspace Coding')
@Controller('admin/workspace')
export class WorkspaceCodingCodebookController {
  private readonly logger = new Logger(WorkspaceCodingCodebookController.name);

  constructor(
    private codebookGenerationService: CodebookGenerationService,
    private jobQueueService: JobQueueService,
    private cacheService: CacheService
  ) { }

  @Post(':workspace_id/coding/codebook')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Codebook generation parameters',
    schema: {
      type: 'object',
      properties: {
        missingsProfile: {
          type: 'string',
          description: 'Name of the missings profile to use',
          example: 'IQB-Standard'
        },
        contentOptions: {
          type: 'object',
          description: 'Options for codebook content generation',
          properties: {
            exportFormat: { type: 'string' },
            missingsProfile: { type: 'string' },
            hasOnlyManualCoding: { type: 'boolean' },
            hasGeneralInstructions: { type: 'boolean' },
            hasDerivedVars: { type: 'boolean' },
            hasOnlyVarsWithCodes: { type: 'boolean' },
            hasClosedVars: { type: 'boolean' },
            codeLabelToUpper: { type: 'boolean' },
            showScore: { type: 'boolean' },
            hideItemVarRelation: { type: 'boolean' }
          }
        },
        unitList: {
          type: 'array',
          items: { type: 'number' },
          description: 'List of unit IDs to include in the codebook'
        }
      },
      required: ['missingsProfile', 'contentOptions', 'unitList']
    }
  })
  @ApiOkResponse({
    description: 'Codebook generated successfully.',
    schema: {
      type: 'string',
      format: 'binary',
      description: 'Generated codebook file'
    }
  })
  async generateCodebook(
    @WorkspaceId() workspace_id: number,
      @Body()
                   body: {
                     missingsProfile: number;
                     contentOptions: {
                       exportFormat: string;
                       missingsProfile: string;
                       hasOnlyManualCoding: boolean;
                       hasGeneralInstructions: boolean;
                       hasDerivedVars: boolean;
                       hasOnlyVarsWithCodes: boolean;
                       hasClosedVars: boolean;
                       codeLabelToUpper: boolean;
                       showScore: boolean;
                       hideItemVarRelation: boolean;
                     };
                     unitList: number[];
                   },
                   @Res() res: Response
  ): Promise<void> {
    const { missingsProfile, contentOptions, unitList } = body;

    const codebook = await this.codebookGenerationService.generateCodebook(
      workspace_id,
      missingsProfile,
      contentOptions,
      unitList
    );

    if (!codebook) {
      res.status(404).send('Failed to generate codebook');
      return;
    }

    const contentType =
      contentOptions.exportFormat === 'docx' ?
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
        'application/json';

    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=codebook.${contentOptions.exportFormat.toLowerCase()}`
    );
    res.send(codebook);
  }

  @Post(':workspace_id/coding/codebook/job')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Start a background codebook generation job',
    schema: {
      type: 'object',
      properties: {
        missingsProfile: { type: 'number' },
        contentOptions: {
          type: 'object',
          properties: {
            exportFormat: { type: 'string' },
            missingsProfile: { type: 'string' },
            hasOnlyManualCoding: { type: 'boolean' },
            hasGeneralInstructions: { type: 'boolean' },
            hasDerivedVars: { type: 'boolean' },
            hasOnlyVarsWithCodes: { type: 'boolean' },
            hasClosedVars: { type: 'boolean' },
            codeLabelToUpper: { type: 'boolean' },
            showScore: { type: 'boolean' },
            hideItemVarRelation: { type: 'boolean' }
          }
        },
        unitList: {
          type: 'array',
          items: { type: 'number' }
        }
      },
      required: ['missingsProfile', 'contentOptions', 'unitList']
    }
  })
  @ApiOkResponse({
    description: 'Codebook generation job created successfully',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        message: { type: 'string' }
      }
    }
  })
  async startCodebookJob(
    @WorkspaceId() workspace_id: number,
      @Body()
                   body: {
                     missingsProfile: number;
                     contentOptions: {
                       exportFormat: string;
                       missingsProfile: string;
                       hasOnlyManualCoding: boolean;
                       hasGeneralInstructions: boolean;
                       hasDerivedVars: boolean;
                       hasOnlyVarsWithCodes: boolean;
                       hasClosedVars: boolean;
                       codeLabelToUpper: boolean;
                       showScore: boolean;
                       hideItemVarRelation: boolean;
                     };
                     unitList: number[];
                   }
  ): Promise<{ jobId: string; message: string }> {
    try {
      const job = await this.jobQueueService.addCodebookGenerationJob({
        workspaceId: workspace_id,
        missingsProfile: body.missingsProfile,
        contentOptions: body.contentOptions,
        unitIds: body.unitList
      });

      this.logger.log(
        `Codebook generation job ${job.id} created for workspace ${workspace_id}`
      );

      return {
        jobId: job.id.toString(),
        message: `Codebook generation job created successfully. Job ID: ${job.id}`
      };
    } catch (error) {
      this.logger.error(
        `Error creating codebook generation job: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  @Get(':workspace_id/coding/codebook/job/:jobId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'jobId', type: 'string' })
  @ApiOkResponse({
    description: 'Codebook generation job status',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'processing', 'completed', 'failed'] },
        progress: { type: 'number' },
        result: { type: 'object' },
        error: { type: 'string' }
      }
    }
  })
  async getCodebookJobStatus(
    @Param('jobId') jobId: string
  ): Promise<
      | {
        status: string;
        progress: number;
        result?: CodebookJobResult;
        error?: string;
      }
      | { error: string }
      > {
    try {
      const job = await this.jobQueueService.getCodebookGenerationJob(jobId);
      if (!job) {
        return { error: `Codebook generation job with ID ${jobId} not found` };
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
    } catch (error) {
      this.logger.error(
        `Error getting codebook job status: ${error.message}`,
        error.stack
      );
      return { error: error.message };
    }
  }

  @Get(':workspace_id/coding/codebook/job/:jobId/download')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'jobId', type: 'string' })
  @ApiOkResponse({
    description: 'Download the generated codebook file'
  })
  async downloadCodebook(
    @Param('jobId') jobId: string,
      @WorkspaceId() workspace_id: number,
      @Res() res: Response
  ): Promise<void> {
    try {
      const metadata = await this.cacheService.get<CodebookJobResult>(
        `codebook-result:${jobId}`
      );

      if (!metadata) {
        res.status(404).json({ error: 'Codebook file not found or expired' });
        return;
      }

      if (metadata.workspaceId !== workspace_id) {
        res.status(403).json({ error: 'Access denied to this codebook' });
        return;
      }

      const filePath = metadata.filePath;

      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Codebook file not found on disk' });
        return;
      }

      const isDocx = metadata.exportFormat === 'docx';
      res.setHeader(
        'Content-Type',
        isDocx ?
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
          'application/json'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="codebook.${metadata.exportFormat}"`
      );
      res.setHeader('Content-Length', metadata.fileSize);

      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    } catch (error) {
      this.logger.error(
        `Error downloading codebook: ${error.message}`,
        error.stack
      );
      res.status(500).json({ error: error.message });
    }
  }
}
