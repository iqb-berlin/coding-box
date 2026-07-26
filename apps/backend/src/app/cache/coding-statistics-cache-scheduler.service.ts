import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CodingStatisticsService } from '../database/services/coding';
import { enqueueCacheStartupWarmup } from './cache-startup-warmup.queue';
import { WorkspaceCacheWarmupRunner } from './workspace-cache-warmup.runner';

@Injectable()
export class CodingStatisticsCacheSchedulerService implements OnModuleInit {
  private readonly logger =
    new Logger(CodingStatisticsCacheSchedulerService.name);

  constructor(
    private readonly codingStatisticsService: CodingStatisticsService,
    private readonly warmupRunner: WorkspaceCacheWarmupRunner
  ) {}

  onModuleInit(): void {
    this.logger.log(
      'Queued coding statistics cache warmup on application startup'
    );
    enqueueCacheStartupWarmup(() => this.runWarmup())
      .catch(error => {
        this.logger.error(
          `Unexpected startup warmup queue error: ${error.message}`,
          error.stack
        );
      });
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async refreshAllCodingStatisticsCache(): Promise<void> {
    await this.runWarmup();
  }

  private runWarmup(): Promise<void> {
    return this.warmupRunner.run({
      key: 'coding-statistics',
      description: 'coding statistics',
      logger: this.logger,
      warmWorkspace: async workspaceId => {
        await this.codingStatisticsService.getCodingStatistics(workspaceId);
      }
    });
  }
}
