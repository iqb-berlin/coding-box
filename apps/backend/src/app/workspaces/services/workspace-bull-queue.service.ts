import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, JobOptions, Job } from 'bull';
import { FlatResponseFilterOptionsJobData } from '../interfaces/job-data.interface';

@Injectable()
export class WorkspaceBullQueueService {
  private readonly logger = new Logger(WorkspaceBullQueueService.name);

  constructor(
    @InjectQueue('flat-response-filter-options')
    private flatResponseFilterOptionsQueue: Queue
  ) {}

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
}
