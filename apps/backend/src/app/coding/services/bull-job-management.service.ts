import {
  Injectable, Logger
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, JobOptions, Job } from 'bull';
import { CodingStatistics } from '../../common';
import { TestPersonCodingJobData, ExportJobData } from '../interfaces/job-data.interface';

@Injectable()
export class BullJobManagementService {
  private readonly logger = new Logger(BullJobManagementService.name);

  constructor(
    @InjectQueue('test-person-coding') private testPersonCodingQueue: Queue,
    @InjectQueue('coding-statistics') private codingStatisticsQueue: Queue,
    @InjectQueue('data-export') private dataExportQueue: Queue
  ) {}

  // --- Test Person Coding Jobs ---

  async addTestPersonCodingJob(
    data: TestPersonCodingJobData,
    options?: JobOptions
  ): Promise<Job<TestPersonCodingJobData>> {
    this.logger.log(
      `Adding test person coding job for workspace ${data.workspaceId}`
    );
    return this.testPersonCodingQueue.add(data, options);
  }

  async getTestPersonCodingJob(
    jobId: string
  ): Promise<Job<TestPersonCodingJobData>> {
    return this.testPersonCodingQueue.getJob(jobId);
  }

  async getTestPersonCodingJobs(
    workspaceId: number
  ): Promise<Job<TestPersonCodingJobData>[]> {
    this.logger.log(
      `Fetching all test person coding jobs for workspace ${workspaceId}`
    );
    const jobs = await this.testPersonCodingQueue.getJobs([
      'completed',
      'failed',
      'active',
      'waiting',
      'delayed'
    ]);
    return jobs.filter(job => job.data.workspaceId === workspaceId);
  }

  async cancelTestPersonCodingJob(jobId: string): Promise<boolean> {
    const job = await this.testPersonCodingQueue.getJob(jobId);
    if (!job) {
      this.logger.warn(`Job with ID ${jobId} not found`);
      return false;
    }

    try {
      const state = await job.getState();

      if (state === 'waiting' || state === 'delayed') {
        await job.remove();
        return true;
      }

      if (state === 'active') {
        await job.discard();
        return true;
      }

      if (state === 'completed' || state === 'failed') {
        return true;
      }

      await job.remove();
      return true;
    } catch (error) {
      this.logger.error(`Error cancelling job: ${error.message}`, error.stack);
      return false;
    }
  }

  async deleteTestPersonCodingJob(jobId: string): Promise<boolean> {
    const job = await this.testPersonCodingQueue.getJob(jobId);
    if (!job) {
      this.logger.warn(`Job with ID ${jobId} not found`);
      return false;
    }

    try {
      await job.remove();
      return true;
    } catch (error) {
      this.logger.error(`Error deleting job: ${error.message}`, error.stack);
      return false;
    }
  }

  // --- Coding Statistics Jobs ---

  async addCodingStatisticsJob(
    workspaceId: number,
    options?: JobOptions
  ): Promise<Job<{ workspaceId: number }>> {
    this.logger.log(
      `Adding coding statistics job for workspace ${workspaceId}`
    );
    return this.codingStatisticsQueue.add({ workspaceId }, options);
  }

  async getCodingStatisticsJob(
    jobId: string
  ): Promise<Job<{ workspaceId: number }>> {
    return this.codingStatisticsQueue.getJob(jobId);
  }

  // --- Export Jobs ---

  async addExportJob(
    data: ExportJobData,
    options?: JobOptions
  ): Promise<Job<ExportJobData>> {
    this.logger.log(
      `Adding export job for workspace ${data.workspaceId}, type: ${data.exportType}`
    );
    return this.dataExportQueue.add(data, options);
  }

  async getExportJob(jobId: string): Promise<Job<ExportJobData>> {
    return this.dataExportQueue.getJob(jobId);
  }

  async getExportJobs(workspaceId: number): Promise<Job<ExportJobData>[]> {
    this.logger.log(`Fetching all export jobs for workspace ${workspaceId}`);
    const jobs = await this.dataExportQueue.getJobs([
      'completed',
      'failed',
      'active',
      'waiting',
      'delayed'
    ]);
    return jobs.filter(job => job.data.workspaceId === workspaceId);
  }

  async cancelExportJob(jobId: string): Promise<boolean> {
    const job = await this.dataExportQueue.getJob(jobId);
    if (!job) {
      this.logger.warn(`Export job with ID ${jobId} not found`);
      return false;
    }

    try {
      const state = await job.getState();

      if (state === 'waiting' || state === 'delayed') {
        await job.remove();
        return true;
      }

      if (state === 'active') {
        await job.discard();
        return true;
      }

      if (state === 'completed' || state === 'failed') {
        return true;
      }

      await job.remove();
      return true;
    } catch (error) {
      this.logger.error(`Error cancelling export job: ${error.message}`, error.stack);
      return false;
    }
  }

  async markExportJobCancelled(jobId: string): Promise<boolean> {
    const job = await this.dataExportQueue.getJob(jobId);
    if (!job) {
      this.logger.warn(`Export job with ID ${jobId} not found`);
      return false;
    }

    try {
      const updatedData = {
        ...job.data,
        isCancelled: true
      };
      await job.update(updatedData);
      return true;
    } catch (error) {
      this.logger.error(`Error marking export job as cancelled: ${error.message}`, error.stack);
      return false;
    }
  }

  async isExportJobCancelled(jobId: string): Promise<boolean> {
    try {
      const job = await this.dataExportQueue.getJob(jobId);
      if (!job) {
        return false;
      }
      return job.data.isCancelled === true;
    } catch (error) {
      this.logger.error(`Error checking export job cancellation: ${error.message}`, error.stack);
      return false;
    }
  }

  async deleteExportJob(jobId: string): Promise<boolean> {
    const job = await this.dataExportQueue.getJob(jobId);
    if (!job) {
      this.logger.warn(`Export job with ID ${jobId} not found`);
      return false;
    }

    try {
      await job.remove();
      return true;
    } catch (error) {
      this.logger.error(`Error deleting export job: ${error.message}`, error.stack);
      return false;
    }
  }

  // --- Original BullJobManagementService methods ---

  async pauseJob(jobId: string): Promise<{ success: boolean; message: string }> {
    try {
      const bullJob = await this.getTestPersonCodingJob(jobId);
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
      const bullJob = await this.getTestPersonCodingJob(jobId);
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
      const bullJob = await this.getTestPersonCodingJob(jobId);
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

      const newJob = await this.addTestPersonCodingJob({
        workspaceId: bullJob.data.workspaceId,
        personIds: bullJob.data.personIds,
        groupNames: bullJob.data.groupNames
      });

      await this.deleteTestPersonCodingJob(jobId);

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
      const bullJobs = await this.getTestPersonCodingJobs(workspaceId);
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
