import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CodingValidationService } from '../database/services/coding';
import { enqueueCacheStartupWarmup } from './cache-startup-warmup.queue';
import { WorkspaceCacheWarmupRunner } from './workspace-cache-warmup.runner';

@Injectable()
export class CodingIncompleteCacheSchedulerService implements OnModuleInit {
  private readonly logger =
    new Logger(CodingIncompleteCacheSchedulerService.name);

  constructor(
    private readonly codingValidationService: CodingValidationService,
    private readonly warmupRunner: WorkspaceCacheWarmupRunner
  ) {}

  onModuleInit(): void {
    this.logger.log(
      'Queued manual coding variables cache warmup on application startup'
    );
    enqueueCacheStartupWarmup(() => this.runWarmup())
      .catch(error => {
        this.logger.error(
          `Unexpected startup warmup queue error: ${error.message}`,
          error.stack
        );
      });
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async refreshAllCODINGIncompleteVariablesCache(): Promise<void> {
    await this.runWarmup();
  }

  private runWarmup(): Promise<void> {
    return this.warmupRunner.run({
      key: 'coding-incomplete',
      description: 'manual coding variables',
      logger: this.logger,
      warmWorkspace: async workspaceId => {
        await this.codingValidationService
          .getCodingIncompleteVariables(workspaceId);
      }
    });
  }
}
