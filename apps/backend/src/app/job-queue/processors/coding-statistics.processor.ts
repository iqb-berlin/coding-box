import {
  Processor
} from '@nestjs/bullmq';
import {
  Injectable,
  Logger
} from '@nestjs/common';
import { Job } from 'bullmq';
import { WorkspaceWorkerHost } from '../workspace-worker-host';
import { getErrorMessage, getErrorStack } from '../../utils/error.util';
import { CodingStatistics } from '../../database/services/shared';
import { CodingStatisticsService } from '../../database/services/coding';

export interface CodingStatisticsJobData {
  workspaceId: number;
  version?: 'v1' | 'v2' | 'v3';
}

@Injectable()
@Processor('coding-statistics', { concurrency: 1 })
export class CodingStatisticsProcessor extends WorkspaceWorkerHost {
  private readonly logger = new Logger(CodingStatisticsProcessor.name);

  constructor(
    private codingStatisticsService: CodingStatisticsService
  ) {
    super();
  }

  async processWorkspaceJob(job: Job<CodingStatisticsJobData>): Promise<CodingStatistics> {
    this.logger.log(`Processing coding statistics job ${job.id} for workspace ${job.data.workspaceId}`);
    try {
      await job.updateProgress(0);
      const result = await this.codingStatisticsService.getCodingStatistics(
        job.data.workspaceId,
        job.data.version || 'v1'
      );
      await job.updateProgress(100);
      this.logger.log(`Coding statistics job ${job.id} completed successfully`);
      return result;
    } catch (error) {
      this.logger.error(`Error processing coding statistics job ${job.id}: ${getErrorMessage(error)}`, getErrorStack(error));
      throw error;
    }
  }
}
