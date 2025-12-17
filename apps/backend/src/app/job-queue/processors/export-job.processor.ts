import { Processor, Process } from '@nestjs/bull';
import {
  Injectable, Logger, Inject, forwardRef
} from '@nestjs/common';
import { Job } from 'bull';
import * as path from 'path';
import * as fs from 'fs';
import {
  ExportJobData,
  ExportJobResult,
  JobQueueService
} from '../job-queue.service';
import { CodingExportService } from '../../database/services/coding-export.service';
import { WorkspaceTestResultsService } from '../../database/services/workspace-test-results.service';
import { CacheService } from '../../cache/cache.service';
import { ExportJobCancelledException } from '../exceptions/export-job-cancelled.exception';

@Injectable()
@Processor('data-export')
export class ExportJobProcessor {
  private readonly logger = new Logger(ExportJobProcessor.name);

  constructor(
    @Inject(forwardRef(() => CodingExportService))
    private codingExportService: CodingExportService,
    @Inject(forwardRef(() => WorkspaceTestResultsService))
    private workspaceTestResultsService: WorkspaceTestResultsService,
    private cacheService: CacheService,
    private jobQueueService: JobQueueService
  ) {}

  private async checkCancellation(
    job: Job<ExportJobData>,
    filePath?: string
  ): Promise<void> {
    if (
      job.data.isCancelled ||
      (await this.jobQueueService.isExportJobCancelled(job.id.toString()))
    ) {
      this.logger.log(`Export job ${job.id} cancellation detected`);
      // Clean up partial file if it exists
      if (filePath && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          this.logger.log(`Cleaned up partial export file: ${filePath}`);
        } catch (cleanupError) {
          this.logger.warn(
            `Failed to clean up partial file ${filePath}: ${cleanupError.message}`
          );
        }
      }
      throw new ExportJobCancelledException(job.id);
    }
  }

  @Process()
  async process(job: Job<ExportJobData>): Promise<ExportJobResult> {
    this.logger.log(
      `Processing export job ${job.id} for workspace ${job.data.workspaceId}, type: ${job.data.exportType}`
    );

    const validExportTypes = [
      'aggregated',
      'by-coder',
      'by-variable',
      'detailed',
      'coding-times',
      'test-results',
      'test-logs'
    ];
    if (!validExportTypes.includes(job.data.exportType)) {
      const errorMessage = `Unknown export type: ${job.data.exportType}`;
      this.logger.error(
        `Error processing export job ${job.id}: ${errorMessage}`
      );
      throw new Error(errorMessage);
    }

    let filePath: string | undefined;

    try {
      await this.checkCancellation(job);
      await job.progress(10);
      const tempDir = path.join(process.cwd(), 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      const fileExt = job.data.exportType === 'detailed' ? 'csv' : 'xlsx';
      const fileName = `export_${job.id}_${Date.now()}.${fileExt}`;
      filePath = path.join(tempDir, fileName);
      this.logger.log(`Generating export file: ${filePath}`);
      await this.checkCancellation(job, filePath);

      await job.progress(20);
      const checkCancellation = async (): Promise<void> => {
        await this.checkCancellation(job, filePath);
      };

      let buffer: Buffer | undefined;

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

        case 'test-results':
          filePath = filePath.replace(/\.xlsx$/, '.csv');
          await this.workspaceTestResultsService.exportTestResultsToFile(
            job.data.workspaceId,
            filePath,
            job.data.testResultFilters,
            async progress => {
              const jobProgress = 20 + Math.round((progress / 100) * 70);
              await job.progress(jobProgress);
              await this.checkCancellation(job, filePath);
            }
          );
          break;

        case 'test-logs':
          filePath = filePath.replace(/\.xlsx$/, '.csv');
          await this.workspaceTestResultsService.exportTestLogsToFile(
            job.data.workspaceId,
            filePath,
            job.data.testResultFilters,
            async progress => {
              const jobProgress = 20 + Math.round((progress / 100) * 70);
              await job.progress(jobProgress);
              await this.checkCancellation(job, filePath);
            }
          );
          break;

        // no default - exportType is validated at the start of the method
      }

      await this.checkCancellation(job, filePath);

      await job.progress(90);

      if (buffer) {
        fs.writeFileSync(filePath, buffer);
      }

      await this.checkCancellation(job, filePath);

      const stats = fs.statSync(filePath);
      const fileSize = stats.size;
      const finalFileName = path.basename(filePath);

      this.logger.log(
        `Export file generated successfully: ${finalFileName} (${fileSize} bytes)`
      );

      // Cache file metadata in Redis with 1 hour TTL
      const metadata: ExportJobResult = {
        fileId: job.id.toString(),
        fileName: finalFileName,
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
      this.logger.error(
        `Error processing export job ${job.id}: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }
}
