import { Processor, Process } from '@nestjs/bull';
import {
  Injectable,
  Logger,
  Inject,
  forwardRef
} from '@nestjs/common';
import { Job } from 'bull';
import * as path from 'path';
import * as fs from 'fs';
import { ExportJobData, ExportJobResult, JobQueueService } from '../job-queue.service';
import { CodingExportService } from '../../database/services/coding-export.service';
import { CacheService } from '../../cache/cache.service';
import { ExportJobCancelledException } from '../exceptions/export-job-cancelled.exception';

@Injectable()
@Processor('data-export')
export class ExportJobProcessor {
  private readonly logger = new Logger(ExportJobProcessor.name);

  constructor(
    @Inject(forwardRef(() => CodingExportService))
    private codingExportService: CodingExportService,
    private cacheService: CacheService,
    private jobQueueService: JobQueueService
  ) {}

  private async checkCancellation(job: Job<ExportJobData>, filePath?: string): Promise<void> {
    if (job.data.isCancelled || await this.jobQueueService.isExportJobCancelled(job.id.toString())) {
      this.logger.log(`Export job ${job.id} cancellation detected`);
      // Clean up partial file if it exists
      if (filePath && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          this.logger.log(`Cleaned up partial export file: ${filePath}`);
        } catch (cleanupError) {
          this.logger.warn(`Failed to clean up partial file ${filePath}: ${cleanupError.message}`);
        }
      }
      throw new ExportJobCancelledException(job.id);
    }
  }

  @Process()
  async process(job: Job<ExportJobData>): Promise<ExportJobResult> {
    this.logger.log(`Processing export job ${job.id} for workspace ${job.data.workspaceId}, type: ${job.data.exportType}`);

    const validExportTypes = ['aggregated', 'by-coder', 'by-variable', 'detailed', 'coding-times'];
    if (!validExportTypes.includes(job.data.exportType)) {
      const errorMessage = `Unknown export type: ${job.data.exportType}`;
      this.logger.error(`Error processing export job ${job.id}: ${errorMessage}`);
      throw new Error(errorMessage);
    }

    let filePath: string | undefined;

    try {
      // Check for cancellation before starting
      await this.checkCancellation(job);

      await job.progress(10);

      // Ensure temp directory exists
      const tempDir = path.join(process.cwd(), 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const fileName = `export_${job.id}_${Date.now()}.xlsx`;
      filePath = path.join(tempDir, fileName);

      this.logger.log(`Generating export file: ${filePath}`);

      // Check for cancellation before generating export
      await this.checkCancellation(job, filePath);

      await job.progress(20);

      // Create cancellation check callback for granular checks in export service
      const checkCancellation = async (): Promise<void> => {
        await this.checkCancellation(job, filePath);
      };

      let buffer: Buffer;

      // eslint-disable-next-line default-case
      switch (job.data.exportType) {
        case 'aggregated':
          buffer = await this.codingExportService.exportCodingResultsAggregated(
            job.data.workspaceId,
            job.data.outputCommentsInsteadOfCodes || false,
            job.data.includeReplayUrl || false,
            job.data.anonymizeCoders || false,
            job.data.usePseudoCoders || false,
            job.data.doubleCodingMethod || 'most-frequent',
            job.data.includeComments || false,
            job.data.includeModalValue || false,
            job.data.authToken || '',
            undefined, // req is not available in background job
            job.data.excludeAutoCoded || false,
            checkCancellation
          );
          break;

        case 'by-coder':
          buffer = await this.codingExportService.exportCodingResultsByCoder(
            job.data.workspaceId,
            job.data.outputCommentsInsteadOfCodes || false,
            job.data.includeReplayUrl || false,
            job.data.anonymizeCoders || false,
            job.data.usePseudoCoders || false,
            job.data.authToken || '',
            undefined, // req is not available in background job
            job.data.excludeAutoCoded || false,
            checkCancellation
          );
          break;

        case 'by-variable':
          buffer = await this.codingExportService.exportCodingResultsByVariable(
            job.data.workspaceId,
            job.data.includeModalValue || false,
            job.data.includeDoubleCoded || false,
            job.data.includeComments || false,
            job.data.outputCommentsInsteadOfCodes || false,
            job.data.includeReplayUrl || false,
            job.data.anonymizeCoders || false,
            job.data.usePseudoCoders || false,
            job.data.authToken || '',
            undefined, // req is not available in background job
            job.data.excludeAutoCoded || false,
            checkCancellation
          );
          break;

        case 'detailed':
          buffer = await this.codingExportService.exportCodingResultsDetailed(
            job.data.workspaceId,
            job.data.outputCommentsInsteadOfCodes || false,
            job.data.includeReplayUrl || false,
            job.data.anonymizeCoders || false,
            job.data.usePseudoCoders || false,
            job.data.authToken || '',
            undefined, // req is not available in background job
            job.data.excludeAutoCoded || false,
            checkCancellation
          );
          break;

        case 'coding-times':
          buffer = await this.codingExportService.exportCodingTimesReport(
            job.data.workspaceId,
            job.data.anonymizeCoders || false,
            job.data.usePseudoCoders || false,
            job.data.excludeAutoCoded || false,
            checkCancellation
          );
          break;

        // no default - exportType is validated at the start of the method
      }

      // Check for cancellation after export generation
      await this.checkCancellation(job, filePath);

      await job.progress(90);

      // Write buffer to file
      fs.writeFileSync(filePath, buffer);

      // Check for cancellation before caching
      await this.checkCancellation(job, filePath);

      const stats = fs.statSync(filePath);
      const fileSize = stats.size;

      this.logger.log(`Export file generated successfully: ${fileName} (${fileSize} bytes)`);

      // Cache file metadata in Redis with 1 hour TTL
      const metadata: ExportJobResult = {
        fileId: job.id.toString(),
        fileName,
        filePath,
        fileSize,
        workspaceId: job.data.workspaceId,
        userId: job.data.userId,
        exportType: job.data.exportType,
        createdAt: Date.now()
      };

      await this.cacheService.set(
        `export-result:${job.id}`,
        metadata,
        3600 // 1 hour TTL
      );

      await job.progress(100);

      this.logger.log(`Job ${job.id} completed successfully`);
      return metadata;
    } catch (error) {
      if (error instanceof ExportJobCancelledException) {
        this.logger.log(`Export job ${job.id} was cancelled`);
        throw error;
      }
      this.logger.error(`Error processing export job ${job.id}: ${error.message}`, error.stack);
      throw error;
    }
  }
}
