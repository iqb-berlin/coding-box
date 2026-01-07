import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { JobQueueService, TestPersonCodingJobData } from '../../job-queue/job-queue.service';
import { CodingStatistics } from '../../database/services/shared-types';

@Injectable()
export class BullJobManagementService {
  private readonly logger = new Logger(BullJobManagementService.name);

  constructor(
    private jobQueueService: JobQueueService
  ) {}

  async pauseJob(jobId: string): Promise<{ success: boolean; message: string }> {
    try {
      const bullJob = await this.jobQueueService.getTestPersonCodingJob(jobId);
      if (!bullJob) {
        return { success: false, message: `Job with ID ${jobId} not found` };
      }

      const state = await bullJob.getState();
      if (state !== 'active' && state !== 'waiting' && state !== 'delayed') {
        return {
          success: false,
          message: `Job with ID ${jobId} cannot be paused because it is ${state}`
        };
      }

      const updatedData = {
        ...bullJob.data,
        isPaused: true
      };

      await bullJob.update(updatedData);
      this.logger.log(`Job ${jobId} has been paused successfully`);

      return { success: true, message: `Job ${jobId} has been paused successfully` };
    } catch (error) {
      this.logger.error(`Error pausing job: ${error.message}`, error.stack);
      return { success: false, message: `Error pausing job: ${error.message}` };
    }
  }

  async resumeJob(jobId: string): Promise<{ success: boolean; message: string }> {
    try {
      const bullJob = await this.jobQueueService.getTestPersonCodingJob(jobId);
      if (!bullJob) {
        return { success: false, message: `Job with ID ${jobId} not found` };
      }

      if (!bullJob.data.isPaused) {
        return {
          success: false,
          message: `Job with ID ${jobId} is not paused and cannot be resumed`
        };
      }

      const { isPaused, ...restData } = bullJob.data;
      await bullJob.update(restData);

      this.logger.log(`Job ${jobId} has been resumed successfully`);
      return { success: true, message: `Job ${jobId} has been resumed successfully` };
    } catch (error) {
      this.logger.error(`Error resuming job: ${error.message}`, error.stack);
      return { success: false, message: `Error resuming job: ${error.message}` };
    }
  }

  async restartJob(jobId: string): Promise<{ success: boolean; message: string; jobId?: string }> {
    try {
      const bullJob = await this.jobQueueService.getTestPersonCodingJob(jobId);
      if (!bullJob) {
        return { success: false, message: `Job with ID ${jobId} not found` };
      }

      const state = await bullJob.getState();
      if (state !== 'failed') {
        return {
          success: false,
          message: `Job with ID ${jobId} is not failed and cannot be restarted`
        };
      }

      const newJob = await this.jobQueueService.addTestPersonCodingJob({
        workspaceId: bullJob.data.workspaceId,
        personIds: bullJob.data.personIds,
        groupNames: bullJob.data.groupNames
      });

      await this.jobQueueService.deleteTestPersonCodingJob(jobId);

      this.logger.log(`Job ${jobId} has been restarted as job ${newJob.id}`);
      return {
        success: true,
        message: `Job ${jobId} has been restarted as job ${newJob.id}`,
        jobId: newJob.id.toString()
      };
    } catch (error) {
      this.logger.error(`Error restarting job: ${error.message}`, error.stack);
      return { success: false, message: `Error restarting job: ${error.message}` };
    }
  }

  mapJobStateToStatus(state: string): 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused' {
    switch (state) {
      case 'active':
        return 'processing';
      case 'completed':
        return 'completed';
      case 'failed':
        return 'failed';
      case 'delayed':
      case 'waiting':
        return 'pending';
      case 'paused':
        return 'paused';
      default:
        return 'pending';
    }
  }

  extractJobResult(bullJob: Job<TestPersonCodingJobData>, state: string): { result?: CodingStatistics; error?: string } {
    let result: CodingStatistics | undefined;
    let error: string | undefined;

    if (state === 'completed' && bullJob.returnvalue) {
      result = bullJob.returnvalue as CodingStatistics;
    } else if (state === 'failed' && bullJob.failedReason) {
      error = bullJob.failedReason;
    }
    return { result, error };
  }

  async getBullJobs(workspaceId: number): Promise<{
    jobId: string;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused';
    progress: number;
    result?: CodingStatistics;
    error?: string;
    workspaceId?: number;
    createdAt?: Date;
    groupNames?: string;
    durationMs?: number;
    completedAt?: Date;
    autoCoderRun?: number;
  }[]> {
    const jobs: {
      jobId: string;
      status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused';
      progress: number;
      result?: CodingStatistics;
      error?: string;
      workspaceId?: number;
      createdAt?: Date;
      groupNames?: string;
      durationMs?: number;
      completedAt?: Date;
      autoCoderRun?: number;
    }[] = [];

    try {
      const bullJobs = await this.jobQueueService.getTestPersonCodingJobs(workspaceId);
      for (const bullJob of bullJobs) {
        const state = await bullJob.getState();
        const progress = await bullJob.progress() || 0;
        // Map Bull job state to our job status
        const status = this.mapJobStateToStatus(state);
        const { result, error } = this.extractJobResult(bullJob, state);

        jobs.push({
          jobId: bullJob.id.toString(),
          status,
          progress: typeof progress === 'number' ? progress : 0,
          result,
          error,
          workspaceId: bullJob.data.workspaceId,
          createdAt: new Date(bullJob.timestamp),
          groupNames: bullJob.data.groupNames,
          completedAt: state === 'completed' ? new Date(bullJob.finishedOn || Date.now()) : undefined,
          durationMs: state === 'completed' && bullJob.finishedOn && bullJob.timestamp ?
            bullJob.finishedOn - bullJob.timestamp :
            undefined,
          autoCoderRun: bullJob.data.autoCoderRun || 1
        });
      }
    } catch (bullError) {
      this.logger.error(`Error getting jobs from Redis queue: ${bullError.message}`, bullError.stack);
    }

    return jobs.sort((a, b) => {
      if (!a.createdAt) return 1;
      if (!b.createdAt) return -1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
  }
}
