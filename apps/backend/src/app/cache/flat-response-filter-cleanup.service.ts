import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { getErrorMessage } from '../utils/error.util';
import { CacheService } from './cache.service';
import { FlatResponseFilterPurgeStore } from './flat-response-filter-purge.store';

@Injectable()
export class FlatResponseFilterCleanupService implements OnModuleInit {
  private readonly logger = new Logger(FlatResponseFilterCleanupService.name);
  private legacyCleanupComplete = false;
  private running = false;

  constructor(private readonly cache: CacheService, private readonly purges: FlatResponseFilterPurgeStore) {}

  onModuleInit(): void {
    this.retryCleanup();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async retryCleanup(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      if (!this.legacyCleanupComplete) {
        this.legacyCleanupComplete = await this.cache.removeLegacyFlatResponseFilterOptions();
      }
      for (const workspaceId of await this.purges.pendingWorkspaces()) {
        await this.cache.purgeFlatResponseFilterOptions(workspaceId);
      }
    } catch (error) {
      this.logger.warn(`Filter cleanup will retry: ${getErrorMessage(error)}`);
    } finally {
      this.running = false;
    }
  }
}
