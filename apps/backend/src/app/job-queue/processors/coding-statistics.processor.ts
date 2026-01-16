import {
  Processor,
  Process
} from '@nestjs/bull';
import {
  Injectable,
  Logger
} from '@nestjs/common';
import { Job } from 'bull';
import { CodingStatistics } from '../../database/services/shared';
import { CodingStatisticsService } from '../../database/services/coding';

export interface CodingStatisticsJobData {
  workspaceId: number;
}

@Injectable()
@Processor('coding-statistics')
export class CodingStatisticsProcessor {
  private readonly logger = new Logger(CodingStatisticsProcessor.name);

  constructor(
    private codingStatisticsService: CodingStatisticsService
  ) { }

  @Process()
  async process(job: Job<CodingStatisticsJobData>): Promise<CodingStatistics> {
    this.logger.log(`Processing coding statistics job ${job.id} for workspace ${job.data.workspaceId}`);
    try {
      await job.progress(0);
      const result = await this.codingStatisticsService.getCodingStatistics(job.data.workspaceId);
      await job.progress(100);
      this.logger.log(`Coding statistics job ${job.id} completed successfully`);
      return result;
    } catch (error) {
      this.logger.error(`Error processing coding statistics job ${job.id}: ${error.message}`, error.stack);
      throw error;
    }
  }
}
