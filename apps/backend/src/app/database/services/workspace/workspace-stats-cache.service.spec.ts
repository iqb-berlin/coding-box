import { WorkspaceStatsCacheService } from './workspace-stats-cache.service';
import { FLAT_FREQUENCIES_CACHE_PREFIX, OVERVIEW_STATS_CACHE_PREFIX } from './workspace-constants';
import { getCodingReadinessCachePattern, getCodingReadinessCacheVersionKey } from '../coding/coding-readiness-cache-key.util';

describe('workspace result cache invalidation', () => {
  const cache = { delete: jest.fn(), deleteByPattern: jest.fn(), incr: jest.fn() };
  const service = new WorkspaceStatsCacheService(cache as never);

  beforeEach(() => {
    cache.delete.mockReset().mockResolvedValue(true);
    cache.deleteByPattern.mockReset().mockResolvedValue(true);
    cache.incr.mockReset().mockResolvedValue(1);
  });

  it('invalidates overview, frequencies, filter options and readiness state together', async () => {
    await expect(service.invalidateWorkspaceStatsCache(7)).resolves.toBe(true);
    expect(cache.delete.mock.calls).toEqual([
      [`${OVERVIEW_STATS_CACHE_PREFIX}7`], ['flat_response_filter_options:version:7']
    ]);
    expect(cache.deleteByPattern.mock.calls).toEqual([
      [`${FLAT_FREQUENCIES_CACHE_PREFIX}7-*`], ['flat_response_filter_options:7:*'], [getCodingReadinessCachePattern(7)]
    ]);
    expect(cache.incr).toHaveBeenCalledWith(getCodingReadinessCacheVersionKey(7));
  });

  it('preserves failure reporting when a cache operation fails', async () => {
    cache.incr.mockResolvedValue(0);
    await expect(service.invalidateWorkspaceStatsCache(7)).resolves.toBe(false);
    cache.incr.mockResolvedValue(1);
    cache.delete.mockResolvedValue(false);
    await expect(service.invalidateWorkspaceStatsCache(7)).resolves.toBe(false);
  });
});
