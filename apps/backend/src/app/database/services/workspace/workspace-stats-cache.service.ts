import { Inject, Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../../../cache/cache.service';
import { JobQueueService } from '../../../job-queue/job-queue.service';
import { getErrorMessage } from '../../../utils/error.util';
import { FLAT_FREQUENCIES_CACHE_PREFIX, OVERVIEW_STATS_CACHE_PREFIX } from './workspace-constants';
import { getCodingReadinessCachePattern, getCodingReadinessCacheVersionKey } from '../coding/coding-readiness-cache-key.util';

/** Workspace mutations can invalidate result caches without loading result queries or coding workflows. */
@Injectable()
export class WorkspaceStatsCacheService {
  private readonly logger = new Logger(WorkspaceStatsCacheService.name);

  constructor(
    private readonly cacheService: CacheService,
    @Inject(JobQueueService)
    private readonly jobQueueService: Pick<JobQueueService, 'addFlatResponseFilterOptionsPurgeJob'>
  ) {}

  async invalidateWorkspaceStatsCache(workspaceId: number, { purgeFilterOptions = false } = {}): Promise<boolean> {
    const results = await Promise.all([
      this.cacheService.delete(`${OVERVIEW_STATS_CACHE_PREFIX}${workspaceId}`),
      this.cacheService.deleteByPattern(`${FLAT_FREQUENCIES_CACHE_PREFIX}${workspaceId}-*`),
      purgeFilterOptions ?
        this.purgeFilterOptions(workspaceId) :
        this.invalidateFilterOptions(workspaceId),
      this.cacheService.incr(getCodingReadinessCacheVersionKey(workspaceId)),
      this.cacheService.deleteByPattern(getCodingReadinessCachePattern(workspaceId))
    ]);
    return results.every(result => (
      typeof result === 'number' ? result > 0 : result === true
    ));
  }

  private async purgeFilterOptions(workspaceId: number): Promise<boolean> {
    if (await this.cacheService.purgeFlatResponseFilterOptions(workspaceId)) return true;
    if (await this.cacheService.purgeFlatResponseFilterOptions(workspaceId)) return true;

    try {
      await this.jobQueueService.addFlatResponseFilterOptionsPurgeJob(workspaceId);
    } catch (error) {
      this.logger.warn(`Could not queue filter-options purge for workspace ${workspaceId}: ${getErrorMessage(error)}`);
    }
    return false;
  }

  private async invalidateFilterOptions(workspaceId: number): Promise<boolean> {
    const generation = await this.cacheService.invalidateFlatResponseFilterOptions(workspaceId);
    if (generation !== null) return true;
    const retryGeneration = await this.cacheService.invalidateFlatResponseFilterOptions(workspaceId);
    // Redis can still accept DEL when maxmemory prevents SET.
    return retryGeneration !== null || this.cacheService.clearFlatResponseFilterOptionsGeneration(workspaceId);
  }
}
