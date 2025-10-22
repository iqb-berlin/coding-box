import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, JobOptions, Job } from 'bull';

export interface TestPersonCodingJobData {
  workspaceId: number;
  personIds: string[];
  groupNames?: string;
  isPaused?: boolean;
}

export interface CodingStatisticsJobData {
  workspaceId: number;
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
    @InjectQueue('coding-statistics') private codingStatisticsQueue: Queue
  ) {}

  /**
   * Add a test person coding job to the queue
   * @param data Job data
   * @param options Job options
   * @returns The created job
   */
  async addTestPersonCodingJob(
    data: TestPersonCodingJobData,
    options?: JobOptions
  ): Promise<Job<TestPersonCodingJobData>> {
    this.logger.log(`Adding test person coding job for workspace ${data.workspaceId}`);
    return this.testPersonCodingQueue.add(data, options);
  }

  /**
   * Get a test person coding job by ID
   * @param jobId The job ID
   * @returns The job
   */
  async getTestPersonCodingJob(jobId: string): Promise<Job<TestPersonCodingJobData>> {
    return this.testPersonCodingQueue.getJob(jobId);
  }

  /**
   * Add a coding statistics job to the queue
   */
  async addCodingStatisticsJob(workspaceId: number, options?: JobOptions): Promise<Job<{ workspaceId: number }>> {
    this.logger.log(`Adding coding statistics job for workspace ${workspaceId}`);
    return this.codingStatisticsQueue.add({ workspaceId }, options);
  }

  /**
   * Get a coding statistics job by ID
   */
  async getCodingStatisticsJob(jobId: string): Promise<Job<{ workspaceId: number }>> {
    return this.codingStatisticsQueue.getJob(jobId);
  }

  /**
   * Get all test person coding jobs for a workspace
   * @param workspaceId The workspace ID
   * @returns Array of jobs
   */
  async getTestPersonCodingJobs(workspaceId: number): Promise<Job<TestPersonCodingJobData>[]> {
    this.logger.log(`Fetching all test person coding jobs for workspace ${workspaceId}`);
    const jobs = await this.testPersonCodingQueue.getJobs(['completed', 'failed', 'active', 'waiting', 'delayed']);
    this.logger.log(`Found ${jobs.length} jobs in total`);
    return jobs.filter(job => job.data.workspaceId === workspaceId);
  }

  /**
   * Cancel a test person coding job
   * @param jobId The job ID
   * @returns True if the job was cancelled, false otherwise
   */
  async cancelTestPersonCodingJob(jobId: string): Promise<boolean> {
    const job = await this.testPersonCodingQueue.getJob(jobId);
    if (!job) {
      this.logger.warn(`Job with ID ${jobId} not found`);
      return false;
    }

    try {
      await job.remove();
      this.logger.log(`Job ${jobId} has been cancelled`);
      return true;
    } catch (error) {
      this.logger.error(`Error cancelling job: ${error.message}`, error.stack);
      return false;
    }
  }

  /**
   * Clean completed and failed jobs
   * @returns The number of jobs cleaned
   */
  async cleanJobs(): Promise<number> {
    // Keep jobs for 24 hours
    const grace = 24 * 60 * 60 * 1000;
    const completedCount = await this.testPersonCodingQueue.clean(grace, 'completed');
    const failedCount = await this.testPersonCodingQueue.clean(grace, 'failed');

    this.logger.log(`Cleaned ${completedCount} completed jobs and ${failedCount} failed jobs`);
    return completedCount.length + failedCount.length;
  }

  /**
   * Delete a test person coding job
   * @param jobId The job ID
   * @returns True if the job was deleted, false otherwise
   */
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

  /**
   * Check if Redis is connected and jobs can be managed
   * @returns Redis connection status
   */
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

      // Measure ping latency
      const startTime = Date.now();
      await client.ping();
      const pingLatency = Date.now() - startTime;

      // Get queue job counts to verify job management
      const originalJobCounts = await this.testPersonCodingQueue.getJobCounts();

      // Add the missing 'paused' property to match our RedisConnectionStatus interface
      const jobCounts = {
        ...originalJobCounts,
        paused: 0 // Default value since JobCounts doesn't include this property
      };

      // Check if queue is ready
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
      this.logger.error(`Redis connection check failed: ${error.message}`, error.stack);

      return {
        connected: false,
        message: `Redis connection failed: ${error.message}`
      };
    }
  }
}
