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
import { ExportJobData, ExportJobResult } from '../job-queue.service';
import { CodingExportService } from '../../database/services/coding-export.service';
import { CacheService } from '../../cache/cache.service';

@Injectable()
@Processor('data-export')
export class ExportJobProcessor {
  private readonly logger = new Logger(ExportJobProcessor.name);

  constructor(
    @Inject(forwardRef(() => CodingExportService))
    private codingExportService: CodingExportService,
    private cacheService: CacheService
  ) {}

  @Process()
  async process(job: Job<ExportJobData>): Promise<ExportJobResult> {
    this.logger.log(`Processing export job ${job.id} for workspace ${job.data.workspaceId}, type: ${job.data.exportType}`);

    const validExportTypes = ['aggregated', 'by-coder', 'by-variable', 'detailed', 'coding-times'];
    if (!validExportTypes.includes(job.data.exportType)) {
      const errorMessage = `Unknown export type: ${job.data.exportType}`;
      this.logger.error(`Error processing export job ${job.id}: ${errorMessage}`);
      throw new Error(errorMessage);
    }

    try {
      await job.progress(10);

      // Ensure temp directory exists
      const tempDir = path.join(process.cwd(), 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const fileName = `export_${job.id}_${Date.now()}.xlsx`;
      const filePath = path.join(tempDir, fileName);

      this.logger.log(`Generating export file: ${filePath}`);

      await job.progress(20);

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
            job.data.excludeAutoCoded || false
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
            job.data.excludeAutoCoded || false
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
            job.data.excludeAutoCoded || false
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
            job.data.excludeAutoCoded || false
          );
          break;

        case 'coding-times':
          buffer = await this.codingExportService.exportCodingTimesReport(
            job.data.workspaceId,
            job.data.anonymizeCoders || false,
            job.data.usePseudoCoders || false,
            job.data.excludeAutoCoded || false
          );
          break;

        // no default - exportType is validated at the start of the method
      }

      await job.progress(90);

      // Write buffer to file
      fs.writeFileSync(filePath, buffer);

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
      this.logger.error(`Error processing export job ${job.id}: ${error.message}`, error.stack);
      throw error;
    }
  }
}
