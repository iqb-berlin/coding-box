import { WorkspaceStatsCacheService } from './workspace-stats-cache.service';
import { FLAT_FREQUENCIES_CACHE_PREFIX, OVERVIEW_STATS_CACHE_PREFIX } from './workspace-constants';
import { getCodingReadinessCachePattern, getCodingReadinessCacheVersionKey } from '../coding/coding-readiness-cache-key.util';

describe('workspace result cache invalidation', () => {
  const cache = {
    delete: jest.fn(),
    deleteByPattern: jest.fn(),
    invalidateFlatResponseFilterOptions: jest.fn(),
    clearFlatResponseFilterOptionsGeneration: jest.fn(),
    purgeFlatResponseFilterOptions: jest.fn(),
    incr: jest.fn()
  };
  const queue = { addFlatResponseFilterOptionsPurgeJob: jest.fn() };
  const service = new WorkspaceStatsCacheService(cache as never, queue);

  beforeEach(() => {
    cache.delete.mockReset().mockResolvedValue(true);
    cache.deleteByPattern.mockReset().mockResolvedValue(true);
    cache.invalidateFlatResponseFilterOptions.mockReset().mockResolvedValue('g2-next');
    cache.clearFlatResponseFilterOptionsGeneration.mockReset().mockResolvedValue(true);
    cache.purgeFlatResponseFilterOptions.mockReset().mockResolvedValue(true);
    cache.incr.mockReset().mockResolvedValue(1);
    queue.addFlatResponseFilterOptionsPurgeJob.mockReset().mockResolvedValue({});
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
    expect(cache.clearFlatResponseFilterOptionsGeneration).not.toHaveBeenCalled();
    expect(cache.delete).toHaveBeenCalledTimes(1);
    expect(cache.incr).toHaveBeenCalledTimes(1);
  });

  it('clears the filter-options generation when both writes fail', async () => {
    cache.invalidateFlatResponseFilterOptions.mockResolvedValue(null);
    await expect(service.invalidateWorkspaceStatsCache(7)).resolves.toBe(true);
    expect(cache.invalidateFlatResponseFilterOptions.mock.calls).toEqual([[7], [7]]);
    expect(cache.clearFlatResponseFilterOptionsGeneration).toHaveBeenCalledWith(7);
  });

  it('retries a failed filter-options purge after deletion', async () => {
    cache.purgeFlatResponseFilterOptions.mockResolvedValueOnce(false);
    await expect(service.invalidateWorkspaceStatsCache(7, { purgeFilterOptions: true })).resolves.toBe(true);
    expect(cache.purgeFlatResponseFilterOptions.mock.calls).toEqual([[7], [7]]);
    expect(queue.addFlatResponseFilterOptionsPurgeJob).not.toHaveBeenCalled();
    expect(cache.invalidateFlatResponseFilterOptions).not.toHaveBeenCalled();
  });

  it('queues a purge and reports pending cache invalidation after both attempts fail', async () => {
    cache.purgeFlatResponseFilterOptions.mockResolvedValue(false);
    await expect(service.invalidateWorkspaceStatsCache(7, { purgeFilterOptions: true })).resolves.toBe(false);
    expect(cache.purgeFlatResponseFilterOptions.mock.calls).toEqual([[7], [7]]);
    expect(queue.addFlatResponseFilterOptionsPurgeJob).toHaveBeenCalledWith(7);
  });

  it('preserves failure reporting when a cache operation fails', async () => {
    cache.incr.mockResolvedValue(0);
    await expect(service.invalidateWorkspaceStatsCache(7)).resolves.toBe(false);
    cache.incr.mockResolvedValue(1);
    cache.delete.mockResolvedValue(false);
    await expect(service.invalidateWorkspaceStatsCache(7)).resolves.toBe(false);
    cache.delete.mockResolvedValue(true);
    cache.invalidateFlatResponseFilterOptions.mockResolvedValue(null);
    cache.clearFlatResponseFilterOptionsGeneration.mockResolvedValue(false);
    await expect(service.invalidateWorkspaceStatsCache(7)).resolves.toBe(false);
  });
});
