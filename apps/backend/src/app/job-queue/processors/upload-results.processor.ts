import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { UploadResultsService } from '../../database/services/test-results';
import { TestResultsUploadJobData } from '../job-queue.service';
import { JobResultStore } from '../job-result.store';

@Processor('test-results-upload')
export class UploadResultsProcessor {
  private readonly logger = new Logger(UploadResultsProcessor.name);

  constructor(
    private readonly uploadResultsService: UploadResultsService,
    private readonly results: JobResultStore
  ) {}

  @Process()
  async handleUpload(job: Job<TestResultsUploadJobData>) {
    this.logger.log(`Processing upload job ${job.id} for workspace ${job.data.workspaceId}`);
    try {
      const result = await this.uploadResultsService.processUpload(job);
      this.logger.log(`Upload job ${job.id} completed successfully`);
      try {
        return await this.results.save(result, String(job.id));
      } catch (storageError) {
        // The import already committed. Preserve the result using Bull's legacy
        // inline representation instead of reporting a failed import/retry.
        this.logger.error(`Job result file could not be saved; retaining inline result: ${storageError.message}`);
        return result;
      }
    } catch (error) {
      this.logger.error(`Upload job ${job.id} failed: ${error.message}`, error.stack);
      throw error;
    }
  }
}
