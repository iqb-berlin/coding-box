import { Processor, WorkerHost } from '@nestjs/bullmq';
import {
  Inject, Injectable, Logger, forwardRef
} from '@nestjs/common';
import { Job } from 'bullmq';
import * as fs from 'fs';
import { getErrorMessage, getErrorStack } from '../../utils/error.util';
import { ExternalCodingImportService } from '../../database/services/coding';
import { CacheService } from '../../cache/cache.service';
import { ExternalCodingImportJobData } from '../job-queue.service';

@Injectable()
@Processor('external-coding-import', { concurrency: 1 })
export class ExternalCodingImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ExternalCodingImportProcessor.name);

  constructor(
    @Inject(forwardRef(() => ExternalCodingImportService))
    private readonly externalCodingImportService: ExternalCodingImportService,
    private readonly cacheService: CacheService
  ) {
    super();
  }

  async process(job: Job<ExternalCodingImportJobData>): Promise<{
    message: string;
    processedRows: number;
    updatedRows: number;
    errorCount: number;
    affectedRowCount: number;
  }> {
    const {
      workspaceId, requestedByUserId, tempFilePath, fileName, sourceFormat, sourceVersion, scoreMode, existingCodingMode
    } = job.data;
    this.logger.log(
      `Processing external coding import job ${job.id} for workspace ${workspaceId}, file: ${fileName}`
    );

    try {
      await job.updateProgress(0);

      const fileBuffer = fs.readFileSync(tempFilePath);
      const fileBase64 = fileBuffer.toString('base64');

      const result = await this.externalCodingImportService.importExternalCoding(
        workspaceId,
        {
          file: fileBase64,
          fileName,
          previewOnly: false,
          sourceFormat,
          sourceVersion,
          scoreMode,
          existingCodingMode
        },
        async (progress: number, message: string) => {
          this.logger.debug(`Job ${job.id} progress: ${progress}% - ${message}`);
          await job.updateProgress(progress);
        },
        requestedByUserId
      );

      // Store full result (including affectedRows) in cache for later retrieval
      await this.cacheService.set(
        `external-coding-import-result:${job.id}`,
        result,
        3600
      );

      await job.updateProgress(100);
      this.logger.log(
        `External coding import job ${job.id} completed: ${result.processedRows} processed, ${result.updatedRows} updated`
      );

      // Return summary without the large affectedRows array
      return {
        message: result.message,
        processedRows: result.processedRows,
        updatedRows: result.updatedRows,
        errorCount: result.errors.length,
        affectedRowCount: result.affectedRows.length
      };
    } catch (error) {
      this.logger.error(
        `Error processing external coding import job ${job.id}: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      throw error;
    } finally {
      // Clean up temp file
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
          this.logger.debug(`Cleaned up temp file: ${tempFilePath}`);
        }
      } catch (cleanupError) {
        this.logger.warn(
          `Failed to clean up temp file ${tempFilePath}: ${getErrorMessage(cleanupError)}`
        );
      }
    }
  }
}
