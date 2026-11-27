import {
  BadRequestException, Controller, Param, Post, Put, Query, Req, UseGuards, UseInterceptors, UploadedFiles, ParseIntPipe, Logger, Get, NotFoundException,
  ParseBoolPipe
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
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
import { Request } from 'express';
import type { RequestBody } from '../../../../../../api-dto/request-contracts';
import { ValidatedBody } from '../../http/validated-body.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import { WorkspaceGuard } from './workspace.guard';
import { FileIo } from './file-io.interface';
import { WorkspaceId } from './workspace.decorator';
import { UploadResultsService } from '../../database/services/test-results';
import { readTestResultsUploadProgress } from '../../../../../../api-dto/files/test-results-upload-progress.dto';
import { TestResultsUploadJobDto } from '../../../../../../api-dto/files/test-results-upload-job.dto';
import { ChunkedUploadInitResponseDto, ChunkedUploadChunkResponseDto } from '../../../../../../api-dto/files/chunked-upload.dto';
import { CacheService } from '../../cache/cache.service';
import { JobQueueService } from '../../job-queue/job-queue.service';

import { ResultUploadStagingService, RESULT_UPLOAD_ROOT, UPLOAD_SESSION_TTL } from './result-upload-staging.service';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB

const uploadScopes = ['workspace', 'person', 'group', 'booklet', 'unit', 'response'] as const;
function normalizeUploadScope(scope?: string): typeof uploadScopes[number] {
  return uploadScopes.find(value => value === scope?.toLowerCase()) ?? 'person';
}

interface ChunkedUploadSession {
  uploadId: string;
  workspaceId: number;
  resultType: 'logs' | 'responses';
  fileName: string;
  fileSize: number;
  mimeType: string;
  totalChunks: number;
  receivedChunks: number[];
  tempDir: string;
}

@ApiTags('Admin Workspace Test Results')
@Controller('admin/workspace')
export class WorkspaceTestResultsImportController {
  private readonly logger = new Logger(
    WorkspaceTestResultsImportController.name
  );

  constructor(
    private uploadResults: UploadResultsService,
    private cacheService: CacheService,
    private jobQueueService: JobQueueService,
    private staging: ResultUploadStagingService
  ) {}

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
        jobId: `flat-response-filter-options-${workspaceId}-v${nextVersion}-thr60000`,
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
  @UseInterceptors(FilesInterceptor('files', 10, { dest: path.join(RESULT_UPLOAD_ROOT, 'multipart') }))
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
    @Query('overwriteExisting', new ParseBoolPipe({ optional: true })) overwriteExisting?: boolean,
    @Query('personMatchMode') personMatchMode?: string,
    @Query('overwriteMode') overwriteMode?: string,
    @Query('scope') scope?: string,
    @Query('groupName') groupName?: string,
    @Query('bookletName') bookletName?: string,
    @Query('unitNameOrAlias') unitNameOrAlias?: string,
    @Query('variableId') variableId?: string,
    @Query('subform') subform?: string,
    @Req() request?: { user: { id: number } }
  ): Promise<TestResultsUploadJobDto[]> {
    const startTime = Date.now();

    if (!workspace_id || Number.isNaN(workspace_id)) {
      throw new BadRequestException('Invalid workspace_id.');
    }

    if (!files || files.length === 0) {
      throw new BadRequestException('No files were uploaded.');
    }
    const shouldOverwrite = overwriteExisting !== false;

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

      // Non-blocking cache invalidation - fire and forget
      const t1 = Date.now();
      this.invalidateFlatResponseFilterOptionsCache(workspace_id)
        .then(() => {
          this.logger.log(
            `Cache invalidation completed in ${Date.now() - t1}ms`
          );
        })
        .catch(err => {
          this.logger.error(
            `Cache invalidation failed: ${err.message}`,
            err.stack
          );
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
        normalizeUploadScope(scope),
        {
          groupName,
          bookletName,
          unitNameOrAlias,
          variableId,
          subform
        },
        request?.user.id,
        file => `multipart-${file.filename}`
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
      throw error;
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
        status: {
          type: 'string',
          enum: [
            'completed',
            'waiting',
            'active',
            'delayed',
            'failed',
            'paused'
          ]
        },
        progress: {
          type: 'number',
          description: 'Percentage of file bytes read. The job status determines when processing has ended.'
        },
        phase: { type: 'string', enum: ['reading', 'processing'] },
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
    const progress = readTestResultsUploadProgress(job.progress);
    const result = job.returnvalue;
    const error = job.failedReason;

    return {
      id: job.id,
      status: state,
      ...progress,
      result,
      error
    };
  }

  // --- Chunked Upload Endpoints ---

  private uploadSessionKey(uploadId: string): string {
    return `chunked-upload:${uploadId}`;
  }

  @Post(':workspace_id/upload/results/:resultType/init')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Initialize a chunked upload session',
    description: 'Creates an upload session for sending a large file in chunks'
  })
  @ApiParam({ name: 'workspace_id', type: Number, required: true })
  @ApiParam({ name: 'resultType', enum: ['logs', 'responses'], required: true })

  @ApiOkResponse({ type: ChunkedUploadInitResponseDto })
  async initChunkedUpload(
    @Param('workspace_id', ParseIntPipe) workspaceId: number,
    @Param('resultType') resultType: 'logs' | 'responses',
    @ValidatedBody('ChunkedUploadInitRequestDto') body: RequestBody<'ChunkedUploadInitRequestDto'>
  ): Promise<ChunkedUploadInitResponseDto> {
    if (!body.fileName || !body.fileSize || !body.mimeType) {
      throw new BadRequestException(
        'fileName, fileSize and mimeType are required.'
      );
    }

    const uploadId = randomUUID();
    const totalChunks = Math.ceil(body.fileSize / CHUNK_SIZE);
    const tempDir = path.join(RESULT_UPLOAD_ROOT, uploadId);

    await fs.promises.mkdir(tempDir, { recursive: true });

    const session: ChunkedUploadSession = {
      uploadId,
      workspaceId,
      resultType,
      fileName: body.fileName,
      fileSize: body.fileSize,
      mimeType: body.mimeType,
      totalChunks,
      receivedChunks: [],
      tempDir
    };

    if (!await this.cacheService.set(this.uploadSessionKey(uploadId), session, UPLOAD_SESSION_TTL)) {
      throw new Error('Could not initialize upload session');
    }

    this.logger.log(
      `Chunked upload initialized: ${uploadId}, file=${body.fileName}, size=${body.fileSize}, chunks=${totalChunks}`
    );

    return { uploadId, chunkSize: CHUNK_SIZE, totalChunks };
  }

  @Put(':workspace_id/upload/results/:uploadId/chunk/:chunkIndex')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Upload a single chunk',
    description: 'Uploads one chunk of a chunked upload session'
  })
  @ApiParam({ name: 'workspace_id', type: Number, required: true })
  @ApiParam({ name: 'uploadId', type: String, required: true })
  @ApiParam({ name: 'chunkIndex', type: Number, required: true })
  @ApiConsumes('application/octet-stream')
  @ApiOkResponse({ type: ChunkedUploadChunkResponseDto })
  async uploadChunk(
    @Param('workspace_id', ParseIntPipe) workspaceId: number,
    @Param('uploadId') uploadId: string,
    @Param('chunkIndex', ParseIntPipe) chunkIndex: number,
    @Req() req: Request
  ): Promise<ChunkedUploadChunkResponseDto> {
    const session = await this.cacheService.getStrict<ChunkedUploadSession>(
      this.uploadSessionKey(uploadId)
    );
    if (!session) {
      throw new NotFoundException(
        `Upload session ${uploadId} not found or expired.`
      );
    }

    if (session.workspaceId !== workspaceId) {
      throw new BadRequestException('Workspace ID mismatch.');
    }

    if (chunkIndex < 0 || chunkIndex >= session.totalChunks) {
      throw new BadRequestException(
        `Invalid chunk index ${chunkIndex}. Expected 0-${session.totalChunks - 1}.`
      );
    }

    const partial = path.join(session.tempDir, `part-${randomUUID()}`);
    try {
      await pipeline(req, fs.createWriteStream(partial));
      return await this.staging.withUploadLock(uploadId, async () => {
        const key = this.uploadSessionKey(uploadId);
        const current = await this.cacheService.getStrict<ChunkedUploadSession>(key);
        if (!current) throw new NotFoundException('Upload session expired or completed');
        const chunkPath = path.join(current.tempDir, `chunk_${String(chunkIndex).padStart(6, '0')}`);
        // Once acknowledged, a part is immutable. Retried PUTs return its receipt.
        if (!current.receivedChunks.includes(chunkIndex)) {
          await fs.promises.rename(partial, chunkPath);
          current.receivedChunks.push(chunkIndex);
        }
        if (!await this.cacheService.set(key, current, UPLOAD_SESSION_TTL)) throw new Error('Could not persist upload progress');
        return { received: true, chunksReceived: current.receivedChunks.length, totalChunks: current.totalChunks };
      });
    } finally {
      await fs.promises.rm(partial, { force: true });
    }
  }

  @Post(':workspace_id/upload/results/:uploadId/complete')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Complete a chunked upload',
    description: 'Merges all chunks and queues the upload job for processing'
  })
  @ApiParam({ name: 'workspace_id', type: Number, required: true })
  @ApiParam({ name: 'uploadId', type: String, required: true })

  @ApiOkResponse({ type: TestResultsUploadJobDto, isArray: true })
  async completeChunkedUpload(
    @Param('workspace_id', ParseIntPipe) workspaceId: number,
    @Param('uploadId') uploadId: string,
    @ValidatedBody('ChunkedUploadCompleteRequestDto', true) body: RequestBody<'ChunkedUploadCompleteRequestDto'> = {},
    @Req() request?: { user: { id: number } }
  ): Promise<TestResultsUploadJobDto[]> {
    const jobId = `upload-${uploadId}`;
    const findAccepted = () => this.jobQueueService.getWorkspaceJob(workspaceId, 'test-results-upload', jobId);
    try {
      const prepared = await this.staging.withUploadLock(uploadId, async () => (
        await findAccepted() ? null : this.prepareUpload(workspaceId, uploadId)
      ));
      if (prepared) {
        await this.enqueuePreparedUpload(prepared, body, request?.user.id);
        await this.cacheService.delete(this.uploadSessionKey(uploadId));
        this.invalidateFlatResponseFilterOptionsCache(workspaceId).catch(error => {
          this.logger.error(`Cache invalidation failed: ${error.message}`, error.stack);
        });
      }
    } catch (error) {
      // A parallel completion or a lost Redis acknowledgement can win the race.
      if (!await findAccepted()) throw error;
    }
    return [{ jobId }];
  }

  private async prepareUpload(workspaceId: number, uploadId: string) {
    const session = await this.cacheService.getStrict<ChunkedUploadSession>(
      this.uploadSessionKey(uploadId)
    );
    if (!session) {
      throw new NotFoundException(
        `Upload session ${uploadId} not found or expired.`
      );
    }

    if (session.workspaceId !== workspaceId) {
      throw new BadRequestException('Workspace ID mismatch.');
    }

    // Check all chunks received
    const missing = [];
    for (let i = 0; i < session.totalChunks; i++) {
      if (!session.receivedChunks.includes(i)) {
        missing.push(i);
      }
    }
    if (missing.length > 0) {
      throw new BadRequestException(`Missing chunks: ${missing.join(', ')}`);
    }

    const mergedPath = await this.staging.assemble(session);
    // Build a file object compatible with the existing upload pipeline
    const file = {
      fieldname: 'files',
      originalname: session.fileName,
      encoding: '7bit',
      mimetype: session.mimeType,
      buffer: Buffer.alloc(0),
      size: session.fileSize,
      path: mergedPath,
      destination: path.dirname(mergedPath),
      filename: 'merged.csv'
    };

    return { file, session };
  }

  private async enqueuePreparedUpload(
    prepared: { file: FileIo; session: ChunkedUploadSession },
    body: RequestBody<'ChunkedUploadCompleteRequestDto'>, requestedByUserId?: number
  ) {
    const { file, session } = prepared;
    // Parse options
    const shouldOverwrite = body.overwriteExisting !== false;
    const personMatchMode =
      (body.personMatchMode || '').toLowerCase() === 'loose' ?
        'loose' :
        undefined;
    const requestedOverwriteMode = (body.overwriteMode || '').toLowerCase();
    let finalOverwriteMode: 'skip' | 'merge' | 'replace' = 'skip';
    if (shouldOverwrite) {
      if (requestedOverwriteMode === 'replace') finalOverwriteMode = 'replace';
      else if (requestedOverwriteMode === 'merge') finalOverwriteMode = 'merge';
    }

    // Queue the upload job
    return this.uploadResults.uploadTestResults(
      session.workspaceId,
      [file],
      session.resultType,
      shouldOverwrite,
      personMatchMode,
      finalOverwriteMode,
      normalizeUploadScope(body.scope),
      {
        groupName: body.groupName,
        bookletName: body.bookletName,
        unitNameOrAlias: body.unitNameOrAlias,
        variableId: body.variableId,
        subform: body.subform
      },
      requestedByUserId,
      () => `upload-${session.uploadId}`
    );
  }
}
