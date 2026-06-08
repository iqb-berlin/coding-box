import { Processor, Process } from '@nestjs/bull';
import {
  Injectable,
  Logger
} from '@nestjs/common';
import { Job } from 'bull';
import { TestPersonCodingJobData } from '../job-queue.service';
import { CodingStatistics } from '../../database/services/shared';
import { WorkspaceCodingService } from '../../database/services/workspace';

@Injectable()
@Processor('test-person-coding')
export class TestPersonCodingProcessor {
  private readonly logger = new Logger(TestPersonCodingProcessor.name);

  constructor(
    private readonly workspaceCodingService: WorkspaceCodingService
  ) { }

  private async shouldStopBeforeBatch(
    job: Job<TestPersonCodingJobData>,
    batchNumber: number
  ): Promise<boolean> {
    const currentState = await job.getState();
    if (currentState === 'failed' || currentState === 'paused') {
      this.logger.log(`Job ${job.id} was ${currentState} before processing batch ${batchNumber}`);
      return true;
    }

    let isPausedInLatestJob = false;
    try {
      const latestJob = await job.queue.getJob(job.id);
      isPausedInLatestJob = Boolean(latestJob?.data?.isPaused);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not refresh pause state for job ${job.id} before processing batch ${batchNumber}: ${message}`
      );
    }

    if (job.data.isPaused || isPausedInLatestJob) {
      this.logger.log(`Job ${job.id} was paused before processing batch ${batchNumber}`);
      return true;
    }

    return false;
  }

  @Process()
  async process(job: Job<TestPersonCodingJobData>): Promise<CodingStatistics> {
    this.logger.log(`Processing test person coding job ${job.id} for workspace ${job.data.workspaceId}`);

    try {
      const BATCH_SIZE = 50;
      const totalPersons = job.data.personIds.length;
      const combinedResult: CodingStatistics = { totalResponses: 0, statusCounts: {} };

      await job.progress(0);

      for (let i = 0; i < job.data.personIds.length; i += BATCH_SIZE) {
        const batchNumber = (i / BATCH_SIZE) + 1;
        if (await this.shouldStopBeforeBatch(job, batchNumber)) {
          return combinedResult;
        }

        const batchPersonIds = job.data.personIds.slice(i, i + BATCH_SIZE);
        const totalBatches = Math.ceil(totalPersons / BATCH_SIZE);
        this.logger.log(`Processing batch ${batchNumber} of ${totalBatches} (${batchPersonIds.length} persons)`);

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

        const batchResult = await this.workspaceCodingService.processTestPersonsBatch(
          job.data.workspaceId,
          batchPersonIds,
          job.data.autoCoderRun || 1,
          progressCallback,
          job.id.toString(),
          job.data.unitIds,
          job.data.freshnessSourceRevision
        );

        combinedResult.totalResponses += batchResult.totalResponses;
        Object.entries(batchResult.statusCounts).forEach(([status, count]) => {
          if (!combinedResult.statusCounts[status]) {
            combinedResult.statusCounts[status] = 0;
          }
          combinedResult.statusCounts[status] += count;
        });
      }

      await job.progress(100);

      this.logger.log(`Job ${job.id} completed successfully`);
      return combinedResult;
    } catch (error) {
      this.logger.error(`Error processing job ${job.id}: ${error.message}`, error.stack);
      throw error;
    }
  }
}
