import { Processor, Process } from '@nestjs/bull';
import {
  Injectable,
  Logger,
  Inject,
  forwardRef
} from '@nestjs/common';
import { Job } from 'bull';
import { TestPersonCodingJobData } from '../job-queue.service';
import { CodingStatistics } from '../../database/services/shared-types';
import { WorkspaceCodingService } from '../../database/services/workspace-coding.service';

@Injectable()
@Processor('test-person-coding')
export class TestPersonCodingProcessor {
  private readonly logger = new Logger(TestPersonCodingProcessor.name);

  constructor(
    @Inject(forwardRef(() => WorkspaceCodingService))
    private workspaceCodingService: WorkspaceCodingService
  ) {}

  @Process()
  async process(job: Job<TestPersonCodingJobData>): Promise<CodingStatistics> {
    this.logger.log(`Processing test person coding job ${job.id} for workspace ${job.data.workspaceId}`);

    try {
      // Process test persons in batches
      const BATCH_SIZE = 500;
      const totalPersons = job.data.personIds.length;
      const combinedResult: CodingStatistics = { totalResponses: 0, statusCounts: {} };

      // Update job progress to 0%
      await job.progress(0);

      // Process each batch sequentially
      for (let i = 0; i < job.data.personIds.length; i += BATCH_SIZE) {
        // Check if job has been cancelled or paused
        const currentJob = await job.getState();
        if (currentJob === 'failed' || currentJob === 'paused') {
          this.logger.log(`Job ${job.id} was ${currentJob} before processing batch ${(i / BATCH_SIZE) + 1}`);
          return combinedResult;
        }

        // Check if job is marked as paused in the job data
        if (job.data.isPaused) {
          this.logger.log(`Job ${job.id} was paused before processing batch ${(i / BATCH_SIZE) + 1}`);
          return combinedResult;
        }

        const batchPersonIds = job.data.personIds.slice(i, i + BATCH_SIZE);
        const batchNumber = (i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(totalPersons / BATCH_SIZE);
        this.logger.log(`Processing batch ${batchNumber} of ${totalBatches} (${batchPersonIds.length} persons)`);

        // Process the batch using the actual processing logic
        const progressCallback = async (progress: number) => {
          // Calculate overall progress based on completed batches and current batch progress
          const batchProgress = (i / job.data.personIds.length) * 100; // Progress from completed batches
          const currentBatchProgress = (progress / 100) * (batchPersonIds.length / job.data.personIds.length) * 100; // Progress from current batch
          const overallProgress = Math.min(
            Math.floor(batchProgress + currentBatchProgress),
            99 // Cap at 99% until fully complete
          );

          await job.progress(overallProgress);
        };

        // Call the actual processing logic
        const batchResult = await this.workspaceCodingService.processTestPersonsBatch(
          job.data.workspaceId,
          batchPersonIds,
          progressCallback,
          job.id.toString()
        );

        // Merge batch results into combined results
        combinedResult.totalResponses += batchResult.totalResponses;

        // Merge status counts
        Object.entries(batchResult.statusCounts).forEach(([status, count]) => {
          if (!combinedResult.statusCounts[status]) {
            combinedResult.statusCounts[status] = 0;
          }
          combinedResult.statusCounts[status] += count;
        });
      }

      // Set job progress to 100%
      await job.progress(100);

      this.logger.log(`Job ${job.id} completed successfully`);
      return combinedResult;
    } catch (error) {
      this.logger.error(`Error processing job ${job.id}: ${error.message}`, error.stack);

      // Re-throw the error to mark the job as failed in Bull
      throw error;
    }
  }
}
