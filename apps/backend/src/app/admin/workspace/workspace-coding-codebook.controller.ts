import {
  BadRequestException,
  Controller,
  Post,
  Get,
  Body,
  Param,
  Res,
  UseGuards,
  Logger,
  ForbiddenException,
  NotFoundException,
  HttpException
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
import {
  CodeBookContentSetting,
  CodebookExportFormat
} from '../code-book/codebook.interfaces';

type CodebookRequestBody = {
  missingsProfile?: unknown;
  contentOptions?: Partial<CodeBookContentSetting>;
  unitList?: unknown;
};

type NormalizedCodebookRequest = {
  missingsProfile: number;
  contentOptions: CodeBookContentSetting;
  unitList: number[];
};

type PublicCodebookJobResult = Omit<CodebookJobResult, 'filePath'>;

type CodebookJobStatusResponse =
  | {
    status: string;
    progress: number;
    result?: PublicCodebookJobResult;
    error?: string;
  }
  | { error: string };

type BooleanCodebookContentSetting = Exclude<keyof CodeBookContentSetting, 'exportFormat' | 'missingsProfile'>;

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
      @Body() body: CodebookRequestBody,
      @Res() res: Response
  ): Promise<void> {
    const { missingsProfile, contentOptions, unitList } =
      this.normalizeCodebookRequest(body);

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
      @Body() body: CodebookRequestBody
  ): Promise<{ jobId: string; message: string }> {
    const { missingsProfile, contentOptions, unitList } =
      this.normalizeCodebookRequest(body);

    try {
      const job = await this.jobQueueService.addCodebookGenerationJob({
        workspaceId: workspace_id,
        missingsProfile,
        contentOptions,
        unitIds: unitList
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
    @WorkspaceId() workspace_id: number,
      @Param('jobId') jobId: string
  ): Promise<CodebookJobStatusResponse> {
    try {
      const job = await this.jobQueueService.getCodebookGenerationJob(jobId);
      if (!job) {
        throw new NotFoundException(
          `Codebook generation job with ID ${jobId} not found`
        );
      }
      if (job.data.workspaceId !== workspace_id) {
        throw new ForbiddenException('Access denied to this codebook job');
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

      const normalizedProgress = typeof progress === 'number' ? progress : 0;
      if (status === 'completed') {
        const result = await this.getAvailableCodebookResult(
          jobId,
          job.returnvalue
        );
        return result ?
          { status, progress: normalizedProgress, result } :
          {
            status: 'failed',
            progress: normalizedProgress,
            error: 'Codebook file expired'
          };
      }

      return {
        status,
        progress: normalizedProgress,
        ...(status === 'failed' && failedReason ? { error: failedReason } : {})
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
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
      const cacheKey = `codebook-result:${jobId}`;

      if (!fs.existsSync(filePath)) {
        await this.cacheService.delete(cacheKey);
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

      await this.streamCodebookFile(filePath, res);
      await this.cleanupCodebookResult(filePath, cacheKey);
    } catch (error) {
      this.logger.error(
        `Error downloading codebook: ${error.message}`,
        error.stack
      );
      if (res.headersSent || res.destroyed || res.writableEnded) {
        if (!res.destroyed) {
          res.destroy(error);
        }
        return;
      }
      res.removeHeader('Content-Disposition');
      res.removeHeader('Content-Length');
      res.setHeader('Content-Type', 'application/json');
      res.status(500).json({ error: error.message });
    }
  }

  private normalizeCodebookRequest(body: CodebookRequestBody): NormalizedCodebookRequest {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Request body is required');
    }

    const missingsProfile = this.normalizeMissingsProfile(body.missingsProfile);
    const contentOptions = this.normalizeContentOptions(
      body.contentOptions,
      missingsProfile
    );
    const unitList = this.normalizeUnitList(body.unitList);

    return {
      missingsProfile,
      contentOptions,
      unitList
    };
  }

  private normalizeMissingsProfile(value: unknown): number {
    return this.normalizeInteger(value, 0, 'missingsProfile');
  }

  private normalizeContentOptions(
    contentOptions: Partial<CodeBookContentSetting> | undefined,
    missingsProfile: number
  ): CodeBookContentSetting {
    if (!contentOptions || typeof contentOptions !== 'object') {
      throw new BadRequestException('contentOptions are required');
    }

    const exportFormat = this.normalizeExportFormat(contentOptions.exportFormat);
    const booleanFields: BooleanCodebookContentSetting[] = [
      'hasOnlyManualCoding',
      'hasGeneralInstructions',
      'hasDerivedVars',
      'hasOnlyVarsWithCodes',
      'hasClosedVars',
      'codeLabelToUpper',
      'showScore',
      'hideItemVarRelation'
    ];

    booleanFields.forEach(field => {
      if (typeof contentOptions[field] !== 'boolean') {
        throw new BadRequestException(`contentOptions.${field} must be boolean`);
      }
    });

    return {
      exportFormat,
      missingsProfile: `${missingsProfile}`,
      hasOnlyManualCoding: contentOptions.hasOnlyManualCoding,
      hasGeneralInstructions: contentOptions.hasGeneralInstructions,
      hasDerivedVars: contentOptions.hasDerivedVars,
      hasOnlyVarsWithCodes: contentOptions.hasOnlyVarsWithCodes,
      hasClosedVars: contentOptions.hasClosedVars,
      codeLabelToUpper: contentOptions.codeLabelToUpper,
      showScore: contentOptions.showScore,
      hideItemVarRelation: contentOptions.hideItemVarRelation
    };
  }

  private normalizeExportFormat(value: unknown): CodebookExportFormat {
    const normalized = typeof value === 'string' ? value.toLowerCase() : '';
    if (normalized !== 'docx' && normalized !== 'json') {
      throw new BadRequestException(
        'Unsupported codebook export format. Use "docx" or "json".'
      );
    }
    return normalized;
  }

  private normalizeUnitList(value: unknown): number[] {
    if (!Array.isArray(value) || value.length === 0) {
      throw new BadRequestException('unitList must contain at least one unit ID');
    }

    const normalized = value.map(unitId => this.normalizeInteger(
      unitId,
      1,
      'unitList'
    ));

    return Array.from(new Set(normalized));
  }

  private normalizeInteger(
    value: unknown,
    minValue: number,
    fieldName: string
  ): number {
    let normalized: number;
    if (typeof value === 'number') {
      normalized = value;
    } else if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      normalized = Number(value.trim());
    } else {
      throw new BadRequestException(this.getIntegerValidationMessage(fieldName, minValue));
    }

    if (!Number.isSafeInteger(normalized) || normalized < minValue) {
      throw new BadRequestException(this.getIntegerValidationMessage(fieldName, minValue));
    }
    return normalized;
  }

  private getIntegerValidationMessage(fieldName: string, minValue: number): string {
    return minValue === 0 ?
      `${fieldName} must be a non-negative integer` :
      `${fieldName} may only contain positive integer IDs`;
  }

  private async getAvailableCodebookResult(
    jobId: string,
    result: CodebookJobResult | undefined
  ): Promise<PublicCodebookJobResult | null> {
    if (!result) {
      return null;
    }

    const cacheKey = `codebook-result:${jobId}`;
    const cachedResult = await this.cacheService.get<CodebookJobResult>(cacheKey);
    if (!cachedResult) {
      return null;
    }

    if (!this.isMatchingCodebookResult(cachedResult, result)) {
      await this.cacheService.delete(cacheKey);
      return null;
    }

    if (!fs.existsSync(cachedResult.filePath)) {
      await this.cacheService.delete(cacheKey);
      return null;
    }

    return this.toPublicCodebookJobResult(cachedResult);
  }

  private isMatchingCodebookResult(
    cachedResult: CodebookJobResult,
    jobResult: CodebookJobResult
  ): boolean {
    return cachedResult.fileId === jobResult.fileId &&
      cachedResult.filePath === jobResult.filePath &&
      cachedResult.workspaceId === jobResult.workspaceId &&
      cachedResult.exportFormat === jobResult.exportFormat;
  }

  private toPublicCodebookJobResult(
    result: CodebookJobResult
  ): PublicCodebookJobResult {
    return {
      fileId: result.fileId,
      fileName: result.fileName,
      fileSize: result.fileSize,
      workspaceId: result.workspaceId,
      exportFormat: result.exportFormat,
      createdAt: result.createdAt
    };
  }

  private streamCodebookFile(filePath: string, res: Response): Promise<void> {
    return new Promise((resolve, reject) => {
      const fileStream = fs.createReadStream(filePath);
      const cleanupListeners = () => {
        fileStream.removeListener('error', fail);
        res.removeListener('error', fail);
        res.removeListener('finish', finish);
        res.removeListener('close', close);
      };
      const fail = (error: Error) => {
        cleanupListeners();
        fileStream.destroy();
        reject(error);
      };
      const finish = () => {
        cleanupListeners();
        resolve();
      };
      const close = () => {
        if (!res.writableEnded) {
          fail(new Error('Codebook download connection closed before completion'));
        }
      };

      fileStream.once('error', fail);
      res.once('error', fail);
      res.once('finish', finish);
      res.once('close', close);
      fileStream.pipe(res);
    });
  }

  private async cleanupCodebookResult(
    filePath: string,
    cacheKey: string
  ): Promise<void> {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      await this.cacheService.delete(cacheKey);
    } catch (error) {
      this.logger.warn(`Failed to clean up codebook result: ${error.message}`);
    }
  }
}
