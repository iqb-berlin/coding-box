import {
  BadRequestException,
  Controller,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  ParseIntPipe,
  Logger,
  Get,
  NotFoundException
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiBadRequestResponse
} from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { UploadResultsService } from '../../database/services/test-results';
import { TestResultsUploadJobDto } from '../../../../../../api-dto/files/test-results-upload-job.dto';
import { CacheService } from '../../cache/cache.service';
import { JobQueueService } from '../../job-queue/job-queue.service';

@ApiTags('Admin Workspace Test Results')
@Controller('admin/workspace')
export class WorkspaceTestResultsImportController {
  private readonly logger = new Logger(WorkspaceTestResultsImportController.name);

  constructor(
    private uploadResults: UploadResultsService,
    private cacheService: CacheService,
    private jobQueueService: JobQueueService
  ) { }

  private async invalidateFlatResponseFilterOptionsCache(
    workspaceId: number
  ): Promise<void> {
    const versionKey =
      this.cacheService.generateFlatResponseFilterOptionsVersionKey(
        workspaceId
      );
    const nextVersion = await this.cacheService.incr(versionKey);
    await this.jobQueueService.addFlatResponseFilterOptionsJob(
      workspaceId,
      60000,
      {
        jobId: `flat-response-filter-options:${workspaceId}:v${nextVersion}:thr60000`,
        removeOnComplete: true,
        removeOnFail: true
      }
    );
  }

  @Post(':workspace_id/upload/results/:resultType')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Upload test results',
    description: 'Uploads test results (logs or responses) to a workspace'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description:
      'The ID of the workspace to which test results should be uploaded.'
  })
  @ApiParam({
    name: 'resultType',
    enum: ['logs', 'responses'],
    required: true,
    description: 'Type of results to upload (logs or responses)'
  })
  @UseInterceptors(FilesInterceptor('files', 10, { dest: '/tmp' }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary'
          },
          description: 'Result files to upload'
        }
      }
    }
  })
  @ApiTags('workspace')
  @ApiOkResponse({
    description: 'Test results upload queued successfully.',
    type: TestResultsUploadJobDto,
    isArray: true
  })
  @ApiBadRequestResponse({
    description: 'Invalid request. Please check your input data.'
  })
  @ApiQuery({
    name: 'overwriteExisting',
    type: Boolean,
    required: false,
    description: 'Whether to overwrite existing logs/responses (default: true)'
  })
  @ApiQuery({
    name: 'personMatchMode',
    required: false,
    description:
      'Person matching mode for import (strict: group+login+code; loose: login+code). Default: strict.'
  })
  @ApiQuery({
    name: 'overwriteMode',
    required: false,
    description:
      'Overwrite mode for existing test results: skip (default), merge (insert missing only), replace (delete matching scope then import).'
  })
  @ApiQuery({
    name: 'scope',
    required: false,
    description:
      'Scope for import/overwrite: person (default, only persons included in upload) or workspace (potentially affects whole workspace).'
  })
  @ApiQuery({ name: 'groupName', required: false })
  @ApiQuery({ name: 'bookletName', required: false })
  @ApiQuery({ name: 'unitNameOrAlias', required: false })
  @ApiQuery({ name: 'variableId', required: false })
  @ApiQuery({ name: 'subform', required: false })
  async addTestResults(
    @Param('workspace_id', ParseIntPipe) workspace_id: number,
      @Param('resultType') resultType: 'logs' | 'responses',
      @UploadedFiles() files: Express.Multer.File[],
      @Query('overwriteExisting') overwriteExisting?: string,
      @Query('personMatchMode') personMatchMode?: string,
      @Query('overwriteMode') overwriteMode?: string,
      @Query('scope') scope?: string,
      @Query('groupName') groupName?: string,
      @Query('bookletName') bookletName?: string,
      @Query('unitNameOrAlias') unitNameOrAlias?: string,
      @Query('variableId') variableId?: string,
      @Query('subform') subform?: string
  ): Promise<TestResultsUploadJobDto[]> {
    const startTime = Date.now();

    if (!workspace_id || Number.isNaN(workspace_id)) {
      throw new BadRequestException('Invalid workspace_id.');
    }

    if (!files || files.length === 0) {
      throw new BadRequestException('No files were uploaded.');
    }
    const shouldOverwrite = overwriteExisting !== 'false';

    this.logger.log(
      `Uploading ${files.length} test results file(s) with overwriteExisting=${shouldOverwrite}`
    );

    try {
      const mode =
        (personMatchMode || '').toLowerCase() === 'loose' ? 'loose' : undefined;
      const requestedOverwriteMode = (overwriteMode || '').toLowerCase();
      let finalOverwriteMode: 'skip' | 'merge' | 'replace' = 'skip';

      if (shouldOverwrite) {
        if (requestedOverwriteMode === 'replace') {
          finalOverwriteMode = 'replace';
        } else if (requestedOverwriteMode === 'merge') {
          finalOverwriteMode = 'merge';
        }
      }

      const finalScope = (scope || '').toLowerCase();
      const allowedScopes = [
        'workspace',
        'person',
        'group',
        'booklet',
        'unit',
        'response'
      ] as const;
      type UploadScope = (typeof allowedScopes)[number];
      const normalizedScope: UploadScope = (
        allowedScopes as readonly string[]
      ).includes(finalScope) ?
        (finalScope as UploadScope) :
        'person';

      // Non-blocking cache invalidation - fire and forget
      const t1 = Date.now();
      this.invalidateFlatResponseFilterOptionsCache(workspace_id)
        .then(() => {
          this.logger.log(`Cache invalidation completed in ${Date.now() - t1}ms`);
        })
        .catch(err => {
          this.logger.error(`Cache invalidation failed: ${err.message}`, err.stack);
        });

      // Queue upload jobs
      const t2 = Date.now();
      const result = await this.uploadResults.uploadTestResults(
        workspace_id,
        files,
        resultType,
        shouldOverwrite,
        mode,
        finalOverwriteMode,
        normalizedScope,
        {
          groupName,
          bookletName,
          unitNameOrAlias,
          variableId,
          subform
        }
      );

      const totalTime = Date.now() - startTime;
      const queueTime = Date.now() - t2;
      this.logger.log(
        `Upload request completed - Queue time: ${queueTime}ms, Total time: ${totalTime}ms, Jobs queued: ${result.length}`
      );

      if (totalTime > 5000) {
        this.logger.warn(
          `Upload request took ${totalTime}ms - investigate potential performance issues`
        );
      }

      return result;
    } catch (error) {
      const totalTime = Date.now() - startTime;
      this.logger.error(
        `Error queuing test results upload after ${totalTime}ms!`,
        error
      );
      throw new BadRequestException(
        'Uploading test results failed to queue. Please try again.'
      );
    }
  }

  @Get(':workspace_id/upload/status/:job_id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get the status of an upload job',
    description: 'Returns the status and result of a background upload job'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The ID of the workspace'
  })
  @ApiParam({
    name: 'job_id',
    type: String,
    required: true,
    description: 'The ID of the job'
  })
  @ApiOkResponse({
    description: 'Job status retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: { type: 'string', enum: ['completed', 'waiting', 'active', 'delayed', 'failed', 'paused'] },
        progress: { type: 'number' },
        result: { type: 'object' },
        error: { type: 'object' }
      }
    }
  })
  async getJobStatus(
  @WorkspaceId() workspaceId: number,
    @Param('job_id') jobId: string
  ) {
    const job = await this.jobQueueService.getUploadJob(jobId);
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    if (job.data.workspaceId !== workspaceId) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    const state = await job.getState();
    const progress = await job.progress();
    const result = job.returnvalue;
    const error = job.failedReason;

    return {
      id: job.id,
      status: state,
      progress,
      result,
      error
    };
  }
}
