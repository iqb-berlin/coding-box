import { WorkspaceStatsCacheService } from './workspace-stats-cache.service';
import { FLAT_FREQUENCIES_CACHE_PREFIX, OVERVIEW_STATS_CACHE_PREFIX } from './workspace-constants';
import { getCodingReadinessCachePattern, getCodingReadinessCacheVersionKey } from '../coding/coding-readiness-cache-key.util';

describe('workspace result cache invalidation', () => {
  const cache = {
    delete: jest.fn(), deleteByPattern: jest.fn(), invalidateFlatResponseFilterOptions: jest.fn(), incr: jest.fn()
  };
  const service = new WorkspaceStatsCacheService(cache as never);

  beforeEach(() => {
    cache.delete.mockReset().mockResolvedValue(true);
    cache.deleteByPattern.mockReset().mockResolvedValue(true);
    cache.invalidateFlatResponseFilterOptions.mockReset().mockResolvedValue('g2-next');
    cache.incr.mockReset().mockResolvedValue(1);
  });

  it('invalidates overview, frequencies, filter options and readiness state together', async () => {
    await expect(service.invalidateWorkspaceStatsCache(7)).resolves.toBe(true);
    expect(cache.delete.mock.calls).toEqual([[`${OVERVIEW_STATS_CACHE_PREFIX}7`]]);
    expect(cache.deleteByPattern.mock.calls).toEqual([
      [`${FLAT_FREQUENCIES_CACHE_PREFIX}7-*`], [getCodingReadinessCachePattern(7)]
    ]);
    expect(cache.invalidateFlatResponseFilterOptions).toHaveBeenCalledTimes(1);
    expect(cache.invalidateFlatResponseFilterOptions).toHaveBeenCalledWith(7);
    expect(cache.incr).toHaveBeenCalledWith(getCodingReadinessCacheVersionKey(7));
  });

  it('retries only the failed filter-options invalidation', async () => {
    cache.invalidateFlatResponseFilterOptions.mockResolvedValueOnce(null);
    await expect(service.invalidateWorkspaceStatsCache(7)).resolves.toBe(true);
    expect(cache.invalidateFlatResponseFilterOptions.mock.calls).toEqual([[7], [7]]);
    expect(cache.delete).toHaveBeenCalledTimes(1);
    expect(cache.incr).toHaveBeenCalledTimes(1);
  });

  it('preserves failure reporting when a cache operation fails', async () => {
    cache.incr.mockResolvedValue(0);
    await expect(service.invalidateWorkspaceStatsCache(7)).resolves.toBe(false);
    cache.incr.mockResolvedValue(1);
    cache.delete.mockResolvedValue(false);
    await expect(service.invalidateWorkspaceStatsCache(7)).resolves.toBe(false);
    cache.delete.mockResolvedValue(true);
    cache.invalidateFlatResponseFilterOptions.mockResolvedValue(null);
    await expect(service.invalidateWorkspaceStatsCache(7)).resolves.toBe(false);
  });
});
