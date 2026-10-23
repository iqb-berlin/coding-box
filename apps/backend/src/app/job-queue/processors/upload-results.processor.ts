import { WorkerHost, Processor } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { getErrorMessage, getErrorStack } from '../../utils/error.util';
import { UploadResultsService } from '../../database/services/test-results';
import { TestResultsUploadJobData } from '../job-queue.service';

@Processor('test-results-upload', { concurrency: 1 })
export class UploadResultsProcessor extends WorkerHost {
  private readonly logger = new Logger(UploadResultsProcessor.name);

  constructor(
    private readonly uploadResultsService: UploadResultsService
  ) {
    super();
  }

  process(job: Job<TestResultsUploadJobData>) {
    return this.handleUpload(job);
  }

  async handleUpload(job: Job<TestResultsUploadJobData>) {
    this.logger.log(`Processing upload job ${job.id} for workspace ${job.data.workspaceId}`);
    try {
      const result = await this.uploadResultsService.processUpload(job);
      this.logger.log(`Upload job ${job.id} completed successfully`);
      return result;
    } catch (error) {
      this.logger.error(`Upload job ${job.id} failed: ${getErrorMessage(error)}`, getErrorStack(error));
      throw error;
    }
  }
}
