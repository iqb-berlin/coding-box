import { Injectable, Logger } from '@nestjs/common';
import { JobQueueService } from '../../job-queue/job-queue.service';
import { CacheService } from '../../cache/cache.service';
import { BullJobManagementService } from './bull-job-management.service';
import { CodingStatistics } from '../../workspaces/shared-types';

@Injectable()
export class CodingJobManager {
  private readonly logger = new Logger(CodingJobManager.name);

  constructor(
    private jobQueueService: JobQueueService,
    private cacheService: CacheService,
    private bullJobManagementService: BullJobManagementService
  ) {}

  async getJobStatus(
    jobId: string
  ): Promise<{
      status:
      | 'pending'
      | 'processing'
      | 'completed'
      | 'failed'
      | 'cancelled'
      | 'paused';
      progress: number;
      result?: CodingStatistics;
      error?: string;
    } | null> {
    try {
      let bullJob = await this.jobQueueService.getTestPersonCodingJob(jobId);

      if (!bullJob) {
        bullJob = (await this.jobQueueService.getCodingStatisticsJob(
          jobId
        )) as never;
      }

      if (bullJob) {
        const state = await bullJob.getState();
        const progress = (await bullJob.progress()) || 0;

        const status = this.bullJobManagementService.mapJobStateToStatus(state);
        const { result, error } =
          this.bullJobManagementService.extractJobResult(bullJob, state);

        return {
          status,
          progress: typeof progress === 'number' ? progress : 0,
          result,
          error
        };
      }

      return null;
    } catch (error) {
      this.logger.error(
        `Error getting job status: ${error.message}`,
        error.stack
      );
      return null;
    }
  }

  async createCodingStatisticsJob(
    workspaceId: number
  ): Promise<{ jobId: string; message: string }> {
    try {
      const cacheKey = `coding-statistics:${workspaceId}`;
      const cachedResult = await this.cacheService.get<CodingStatistics>(
        cacheKey
      );
      if (cachedResult) {
        this.logger.log(
          `Cached coding statistics exist for workspace ${workspaceId}, returning empty jobId to use cache`
        );
        return { jobId: '', message: 'Using cached coding statistics' };
      }
      await this.cacheService.delete(cacheKey); // Clear any stale cache
      this.logger.log(
        `No cached coding statistics for workspace ${workspaceId}, creating job to recalculate`
      );

      const job = await this.jobQueueService.addCodingStatisticsJob(
        workspaceId
      );
      this.logger.log(
        `Created coding statistics job ${job.id} for workspace ${workspaceId}`
      );
      return {
        jobId: job.id.toString(),
        message: 'Created coding statistics job - no cache available'
      };
    } catch (error) {
      this.logger.error(
        `Error creating coding statistics job: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  async cancelJob(
    jobId: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const bullJob = await this.jobQueueService.getTestPersonCodingJob(jobId);
      if (!bullJob) {
        return { success: false, message: `Job with ID ${jobId} not found` };
      }

      const state = await bullJob.getState();
      if (state === 'completed' || state === 'failed') {
        return {
          success: false,
          message: `Job with ID ${jobId} cannot be cancelled because it is already ${state}`
        };
      }

      if (state === 'active') {
        return {
          success: false,
          message: `Job with ID ${jobId} is currently being processed and cannot be cancelled. Please wait for it to complete or use pause instead.`
        };
      }

      const result = await this.jobQueueService.cancelTestPersonCodingJob(
        jobId
      );
      if (result) {
        this.logger.log(`Job ${jobId} has been cancelled successfully`);
        return {
          success: true,
          message: `Job ${jobId} has been cancelled successfully`
        };
      }
      return { success: false, message: `Failed to cancel job ${jobId}` };
    } catch (error) {
      this.logger.error(`Error cancelling job: ${error.message}`, error.stack);
      return {
        success: false,
        message: `Error cancelling job: ${error.message}`
      };
    }
  }

  async deleteJob(
    jobId: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const bullJob = await this.jobQueueService.getTestPersonCodingJob(jobId);
      if (!bullJob) {
        return { success: false, message: `Job with ID ${jobId} not found` };
      }

      const result = await this.jobQueueService.deleteTestPersonCodingJob(
        jobId
      );
      if (result) {
        this.logger.log(`Job ${jobId} has been deleted successfully`);
        return {
          success: true,
          message: `Job ${jobId} has been deleted successfully`
        };
      }
      return { success: false, message: `Failed to delete job ${jobId}` };
    } catch (error) {
      this.logger.error(`Error deleting job: ${error.message}`, error.stack);
      return {
        success: false,
        message: `Error deleting job: ${error.message}`
      };
    }
  }

  async isJobCancelled(jobId: string | number): Promise<boolean> {
    try {
      const bullJob = await this.jobQueueService.getTestPersonCodingJob(
        jobId.toString()
      );
      if (bullJob) {
        if (bullJob.data.isPaused) {
          return true;
        }
        const state = await bullJob.getState();
        return state === 'paused';
      }
      return false;
    } catch (error) {
      this.logger.error(
        `Error checking job cancellation or pause: ${error.message}`,
        error.stack
      );
      return false;
    }
  }

  async pauseJob(
    jobId: string
  ): Promise<{ success: boolean; message: string }> {
    return this.bullJobManagementService.pauseJob(jobId);
  }

  async resumeJob(
    jobId: string
  ): Promise<{ success: boolean; message: string }> {
    return this.bullJobManagementService.resumeJob(jobId);
  }

  async restartJob(
    jobId: string
  ): Promise<{ success: boolean; message: string; jobId?: string }> {
    return this.bullJobManagementService.restartJob(jobId);
  }

  async getBullJobs(workspaceId: number): Promise<
  {
    jobId: string;
    status:
    | 'pending'
    | 'processing'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'paused';
    progress: number;
    result?: CodingStatistics;
    error?: string;
    workspaceId?: number;
    createdAt?: Date;
    groupNames?: string;
    durationMs?: number;
    completedAt?: Date;
  }[]
  > {
    const jobs = await this.jobQueueService.getTestPersonCodingJobs(workspaceId);
    const resultPromises = jobs
      .map(async job => {
        const state = await job.getState();
        const progress = (await job.progress()) || 0;
        const status = this.bullJobManagementService.mapJobStateToStatus(state);
        const { result, error } =
          this.bullJobManagementService.extractJobResult(job, state);

        return {
          jobId: job.id.toString(),
          status,
          progress: typeof progress === 'number' ? progress : 0,
          result,
          error,
          workspaceId: job.data.workspaceId,
          createdAt: new Date(job.timestamp),
          groupNames: '', // Needs to be populated if data available
          durationMs: job.finishedOn ? job.finishedOn - job.processedOn : 0,
          completedAt: job.finishedOn ? new Date(job.finishedOn) : null
        };
      });

    return Promise.all(resultPromises);
  }
}
