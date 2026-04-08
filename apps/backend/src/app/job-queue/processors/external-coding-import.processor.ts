import { Processor, Process } from '@nestjs/bull';
import {
  Inject, Injectable, Logger, forwardRef
} from '@nestjs/common';
import { Job } from 'bull';
import * as fs from 'fs';
import { ExternalCodingImportService } from '../../database/services/coding';
import { CacheService } from '../../cache/cache.service';
import { ExternalCodingImportJobData } from '../job-queue.service';

@Injectable()
@Processor('external-coding-import')
export class ExternalCodingImportProcessor {
  private readonly logger = new Logger(ExternalCodingImportProcessor.name);

  constructor(
    @Inject(forwardRef(() => ExternalCodingImportService))
    private readonly externalCodingImportService: ExternalCodingImportService,
    private readonly cacheService: CacheService
  ) {}

  @Process()
  async process(job: Job<ExternalCodingImportJobData>): Promise<{
    message: string;
    processedRows: number;
    updatedRows: number;
    errorCount: number;
    affectedRowCount: number;
  }> {
    const { workspaceId, tempFilePath, fileName } = job.data;
    this.logger.log(
      `Processing external coding import job ${job.id} for workspace ${workspaceId}, file: ${fileName}`
    );

    try {
      await job.progress(0);

      const fileBuffer = fs.readFileSync(tempFilePath);
      const fileBase64 = fileBuffer.toString('base64');

      const result = await this.externalCodingImportService.importExternalCoding(
        workspaceId,
        { file: fileBase64, fileName, previewOnly: false },
        async (progress: number, message: string) => {
          this.logger.debug(`Job ${job.id} progress: ${progress}% - ${message}`);
          await job.progress(progress);
        }
      );

      // Store full result (including affectedRows) in cache for later retrieval
      await this.cacheService.set(
        `external-coding-import-result:${job.id}`,
        result,
        3600
      );

      await job.progress(100);
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
        `Error processing external coding import job ${job.id}: ${error.message}`,
        error.stack
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
          `Failed to clean up temp file ${tempFilePath}: ${cleanupError.message}`
        );
      }
    }
  }
}
