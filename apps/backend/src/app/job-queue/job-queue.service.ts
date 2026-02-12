import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, JobOptions, Job } from 'bull';
import { FileIo } from '../admin/workspace/file-io.interface';

export interface TestResultsUploadJobData {
  workspaceId: number;
  file: FileIo;
  resultType: 'logs' | 'responses';
  overwriteExisting: boolean;
  personMatchMode?: 'strict' | 'loose';
  overwriteMode?: 'skip' | 'merge' | 'replace';
  scope?: 'person' | 'workspace' | 'group' | 'booklet' | 'unit' | 'response';
  scopeFilters?: { groupName?: string; bookletName?: string; unitNameOrAlias?: string; variableId?: string; subform?: string };
}

export interface TestPersonCodingJobData {
  workspaceId: number;
  personIds: string[];
  groupNames?: string;
  isPaused?: boolean;
  autoCoderRun?: number;
}

export interface ResetCodingVersionJobData {
  workspaceId: number;
  version: 'v1' | 'v2' | 'v3';
  unitFilters?: string[];
  variableFilters?: string[];
}

export interface FlatResponseFilterOptionsJobData {
  workspaceId: number;
  processingDurationThresholdMs: number;
}

export interface ExportJobData {
  workspaceId: number;
  userId: number;
  exportType:
  | 'aggregated'
  | 'by-coder'
  | 'by-variable'
  | 'detailed'
  | 'coding-times'
  | 'test-results'
  | 'test-logs';
  outputCommentsInsteadOfCodes?: boolean;
  includeReplayUrl?: boolean;
  anonymizeCoders?: boolean;
  usePseudoCoders?: boolean;
  doubleCodingMethod?:
  | 'new-row-per-variable'
  | 'new-column-per-coder'
  | 'most-frequent';
  includeComments?: boolean;
  includeModalValue?: boolean;
  includeDoubleCoded?: boolean;
  excludeAutoCoded?: boolean;
  authToken?: string;
  isCancelled?: boolean;
  testResultFilters?: {
    groupNames?: string[];
    bookletNames?: string[];
    unitNames?: string[];
    personIds?: number[];
  };
}

export interface ExportJobResult {
  fileId: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  workspaceId: number;
  userId: number;
  exportType: string;
  createdAt: number;
}

export interface RedisConnectionStatus {
  connected: boolean;
  message: string;
  details?: {
    pingLatency?: number;
    queueStatus?: {
      name: string;
      isReady: boolean;
      jobCounts?: {
        waiting: number;
        active: number;
        completed: number;
        failed: number;
        delayed: number;
        paused: number;
      };
    };
  };
}

@Injectable()
export class JobQueueService {
  private readonly logger = new Logger(JobQueueService.name);

  constructor(
    @InjectQueue('test-person-coding') private testPersonCodingQueue: Queue,
    @InjectQueue('coding-statistics') private codingStatisticsQueue: Queue,
    @InjectQueue('data-export') private dataExportQueue: Queue,
    @InjectQueue('flat-response-filter-options')
    private flatResponseFilterOptionsQueue: Queue,
    @InjectQueue('test-results-upload') private testResultsUploadQueue: Queue,
    @InjectQueue('reset-coding-version') private resetCodingVersionQueue: Queue
  ) { }

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

  async addCodingStatisticsJob(
    workspaceId: number,
    version?: 'v1' | 'v2' | 'v3',
    options?: JobOptions
  ): Promise<Job<{ workspaceId: number; version?: 'v1' | 'v2' | 'v3' }>> {
    this.logger.log(
      `Adding coding statistics job for workspace ${workspaceId} (version: ${version || 'v1'})`
    );
    return this.codingStatisticsQueue.add({ workspaceId, version }, options);
  }

  async getCodingStatisticsJob(
    jobId: string
  ): Promise<Job<{ workspaceId: number }>> {
    return this.codingStatisticsQueue.getJob(jobId);
  }

  async addFlatResponseFilterOptionsJob(
    workspaceId: number,
    processingDurationThresholdMs: number,
    options?: JobOptions
  ): Promise<Job<FlatResponseFilterOptionsJobData>> {
    this.logger.log(
      `Adding flat response filter-options cache job for workspace ${workspaceId}`
    );
    return this.flatResponseFilterOptionsQueue.add(
      {
        workspaceId,
        processingDurationThresholdMs
      },
      options
    );
  }

  async addUploadJob(
    data: TestResultsUploadJobData,
    options?: JobOptions
  ): Promise<Job<TestResultsUploadJobData>> {
    this.logger.log(
      `Adding upload job for workspace ${data.workspaceId}, file: ${data.file.originalname}`
    );
    return this.testResultsUploadQueue.add(data, options);
  }

  async getUploadJob(jobId: string): Promise<Job<TestResultsUploadJobData>> {
    return this.testResultsUploadQueue.getJob(jobId);
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
    this.logger.log(`Found ${jobs.length} jobs in total`);
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
        this.logger.log(
          `Job ${jobId} has been cancelled and removed from queue`
        );
        return true;
      }

      if (state === 'active') {
        await job.discard();
        this.logger.log(
          `Job ${jobId} is active, marked for discard (will not retry on failure)`
        );
        return true;
      }

      if (state === 'completed' || state === 'failed') {
        this.logger.log(`Job ${jobId} is already ${state}, no action needed`);
        return true;
      }

      // Fallback: try to remove
      await job.remove();
      this.logger.log(`Job ${jobId} has been cancelled`);
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
      this.logger.log(`Job ${jobId} has been deleted`);
      return true;
    } catch (error) {
      this.logger.error(`Error deleting job: ${error.message}`, error.stack);
      return false;
    }
  }

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
    this.logger.log(`Found ${jobs.length} export jobs in total`);
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

      // For waiting/delayed jobs, we can remove them directly
      if (state === 'waiting' || state === 'delayed') {
        await job.remove();
        this.logger.log(
          `Export job ${jobId} has been cancelled and removed from queue`
        );
        return true;
      }

      // For active jobs, we can't remove them - the processor will check the isCancelled flag
      // and handle the cancellation. We use discard() to prevent retries.
      if (state === 'active') {
        await job.discard();
        this.logger.log(
          `Export job ${jobId} is active, marked for cancellation (will stop at next checkpoint)`
        );
        return true;
      }

      // For completed/failed jobs, just log and return true
      if (state === 'completed' || state === 'failed') {
        this.logger.log(
          `Export job ${jobId} is already ${state}, no action needed`
        );
        return true;
      }

      // Fallback: try to remove
      await job.remove();
      this.logger.log(`Export job ${jobId} has been cancelled`);
      return true;
    } catch (error) {
      this.logger.error(
        `Error cancelling export job: ${error.message}`,
        error.stack
      );
      return false;
    }
  }

  async markExportJobCancelled(jobId: string): Promise<boolean> {
    const job = await this.dataExportQueue.getJob(jobId);
    if (!job) {
      this.logger.warn(
        `Export job with ID ${jobId} not found for cancellation marking`
      );
      return false;
    }

    try {
      const updatedData = {
        ...job.data,
        isCancelled: true
      };
      await job.update(updatedData);
      this.logger.log(`Export job ${jobId} has been marked as cancelled`);
      return true;
    } catch (error) {
      this.logger.error(
        `Error marking export job as cancelled: ${error.message}`,
        error.stack
      );
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
      this.logger.error(
        `Error checking export job cancellation: ${error.message}`,
        error.stack
      );
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
      this.logger.log(`Export job ${jobId} has been deleted`);
      return true;
    } catch (error) {
      this.logger.error(
        `Error deleting export job: ${error.message}`,
        error.stack
      );
      return false;
    }
  }

  // --- Reset Coding Version Queue Methods ---

  async addResetCodingVersionJob(
    data: ResetCodingVersionJobData,
    options?: JobOptions
  ): Promise<Job<ResetCodingVersionJobData>> {
    this.logger.log(
      `Adding reset coding version job for workspace ${data.workspaceId}, version ${data.version}`
    );
    return this.resetCodingVersionQueue.add(data, options);
  }

  async getResetCodingVersionJob(
    jobId: string
  ): Promise<Job<ResetCodingVersionJobData>> {
    return this.resetCodingVersionQueue.getJob(jobId);
  }

  async getActiveResetCodingVersionJob(
    workspaceId: number
  ): Promise<Job<ResetCodingVersionJobData> | null> {
    const jobs = await this.resetCodingVersionQueue.getJobs([
      'active',
      'waiting',
      'delayed'
    ]);
    return jobs.find(job => job.data.workspaceId === workspaceId) || null;
  }

  async hasActiveJobsForWorkspace(
    workspaceId: number
  ): Promise<{ blocked: boolean; reason?: string }> {
    // Check reset-coding-version queue
    const resetJobs = await this.resetCodingVersionQueue.getJobs([
      'active',
      'waiting',
      'delayed'
    ]);
    const activeResetJob = resetJobs.find(
      job => job.data.workspaceId === workspaceId
    );
    if (activeResetJob) {
      return {
        blocked: true,
        reason: `A reset coding version job is already running for this workspace (job ${activeResetJob.id})`
      };
    }

    // Check test-person-coding queue
    const codingJobs = await this.testPersonCodingQueue.getJobs([
      'active',
      'waiting',
      'delayed'
    ]);
    const activeCodingJob = codingJobs.find(
      job => job.data.workspaceId === workspaceId
    );
    if (activeCodingJob) {
      return {
        blocked: true,
        reason: `An auto-coding job is already running for this workspace (job ${activeCodingJob.id})`
      };
    }

    return { blocked: false };
  }

  async checkRedisConnection(): Promise<RedisConnectionStatus> {
    try {
      this.logger.log('Checking Redis connection status...');

      // Access the Redis client from the Bull queue
      const client = this.testPersonCodingQueue.client;

      if (!client) {
        return {
          connected: false,
          message: 'Redis client is not available'
        };
      }

      const startTime = Date.now();
      await client.ping();
      const pingLatency = Date.now() - startTime;
      const originalJobCounts = await this.testPersonCodingQueue.getJobCounts();
      const jobCounts = {
        ...originalJobCounts,
        paused: 0 // Default value since JobCounts doesn't include this property
      };
      let isReady = false;
      try {
        await this.testPersonCodingQueue.isReady();
        isReady = true;
      } catch (readyError) {
        this.logger.warn(`Queue ready check failed: ${readyError.message}`);
      }

      return {
        connected: true,
        message: 'Redis is connected and jobs can be managed',
        details: {
          pingLatency,
          queueStatus: {
            name: 'test-person-coding',
            isReady,
            jobCounts
          }
        }
      };
    } catch (error) {
      this.logger.error(
        `Redis connection check failed: ${error.message}`,
        error.stack
      );

      return {
        connected: false,
        message: `Redis connection failed: ${error.message}`
      };
    }
  }
}
