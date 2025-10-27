import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, JobOptions, Job } from 'bull';

export interface TestPersonCodingJobData {
  workspaceId: number;
  personIds: string[];
  groupNames?: string;
  isPaused?: boolean;
  autoCoderRun?: number;
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

  async addTestPersonCodingJob(
    data: TestPersonCodingJobData,
    options?: JobOptions
  ): Promise<Job<TestPersonCodingJobData>> {
    this.logger.log(`Adding test person coding job for workspace ${data.workspaceId}`);
    return this.testPersonCodingQueue.add(data, options);
  }

  async getTestPersonCodingJob(jobId: string): Promise<Job<TestPersonCodingJobData>> {
    return this.testPersonCodingQueue.getJob(jobId);
  }

  async addCodingStatisticsJob(workspaceId: number, options?: JobOptions): Promise<Job<{ workspaceId: number }>> {
    this.logger.log(`Adding coding statistics job for workspace ${workspaceId}`);
    return this.codingStatisticsQueue.add({ workspaceId }, options);
  }

  async getCodingStatisticsJob(jobId: string): Promise<Job<{ workspaceId: number }>> {
    return this.codingStatisticsQueue.getJob(jobId);
  }

  async getTestPersonCodingJobs(workspaceId: number): Promise<Job<TestPersonCodingJobData>[]> {
    this.logger.log(`Fetching all test person coding jobs for workspace ${workspaceId}`);
    const jobs = await this.testPersonCodingQueue.getJobs(['completed', 'failed', 'active', 'waiting', 'delayed']);
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
      this.logger.error(`Redis connection check failed: ${error.message}`, error.stack);

      return {
        connected: false,
        message: `Redis connection failed: ${error.message}`
      };
    }
  }
}
