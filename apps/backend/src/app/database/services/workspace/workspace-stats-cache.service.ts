import { Injectable } from '@nestjs/common';
import { CacheService } from '../../../cache/cache.service';
import { FLAT_FREQUENCIES_CACHE_PREFIX, OVERVIEW_STATS_CACHE_PREFIX } from './workspace-constants';
import { getCodingReadinessCachePattern, getCodingReadinessCacheVersionKey } from '../coding/coding-readiness-cache-key.util';

/** Workspace mutations can invalidate result caches without loading result queries or coding workflows. */
@Injectable()
export class WorkspaceStatsCacheService {
  constructor(private readonly cacheService: CacheService) {}

  async invalidateWorkspaceStatsCache(workspaceId: number): Promise<boolean> {
    const results = await Promise.all([
      this.cacheService.delete(`${OVERVIEW_STATS_CACHE_PREFIX}${workspaceId}`),
      this.cacheService.deleteByPattern(`${FLAT_FREQUENCIES_CACHE_PREFIX}${workspaceId}-*`),
      this.cacheService.delete(`flat_response_filter_options:version:${workspaceId}`),
      this.cacheService.deleteByPattern(`flat_response_filter_options:${workspaceId}:*`),
      this.cacheService.incr(getCodingReadinessCacheVersionKey(workspaceId)),
      this.cacheService.deleteByPattern(getCodingReadinessCachePattern(workspaceId))
    ]);
    return results.every(result => (
      typeof result === 'number' ? result > 0 : result === true
    ));
  }
}
