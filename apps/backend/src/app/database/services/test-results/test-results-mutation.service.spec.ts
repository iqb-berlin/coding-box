import { CodingStatisticsService } from '../coding/coding-statistics.service';
import { CodingValidationService } from '../coding/coding-validation.service';
import { WorkspaceStatsCacheService } from '../workspace/workspace-stats-cache.service';
import { ResponseManagementService } from './response-management.service';
import { TestResultsCacheService } from './test-results-cache.service';
import { TestResultsDeletionQueryService } from './test-results-deletion-query.service';
import { TestResultsMutationService } from './test-results-mutation.service';

describe('TestResultsMutationService with real result-cache invalidation', () => {
  function fixture() {
    const events: string[] = [];
    const incomplete = jest.fn(async () => { events.push('availability'); });
    const statistics = jest.fn(async () => { events.push('statistics'); });
    const workspaceStats = jest.fn().mockResolvedValue(true);
    const validation = { invalidateIncompleteVariablesCache: incomplete } as unknown as CodingValidationService;
    const cache = new TestResultsCacheService(validation,
      { invalidateWorkspaceStatsCache: workspaceStats } as unknown as WorkspaceStatsCacheService,
      { invalidateCache: statistics } as unknown as CodingStatisticsService);
    const result = { success: true, report: { deletedResponse: 42, warnings: [] } };
    const remove = jest.fn(async () => { events.push('delete'); return result; });
    const service = new TestResultsMutationService({} as never, {} as never, validation, { deleteResponse: remove } as unknown as ResponseManagementService, cache, {} as TestResultsDeletionQueryService);
    return {
      service, cache, result, remove, incomplete, statistics, workspaceStats, events
    };
  }

  it('invalidates availability and coding statistics after the response owner succeeds', async () => {
    const f = fixture();
    await expect(f.service.deleteResponse(7, 42, '5')).resolves.toBe(f.result);
    expect(f.remove).toHaveBeenCalledWith(7, 42, '5');
    expect(f.incomplete).toHaveBeenCalledWith(7);
    expect(f.statistics).toHaveBeenCalledWith(7);
    expect(f.events).toEqual(['delete', 'availability', 'statistics']);
  });

  it('retains failed-delete semantics without invalidation', async () => {
    const f = fixture();
    f.result.success = false;
    await expect(f.service.deleteResponse(7, 42, '5')).resolves.toBe(f.result);
    expect(f.incomplete).not.toHaveBeenCalled();
    expect(f.statistics).not.toHaveBeenCalled();
  });

  it('propagates invalidation errors after a successful mutation', async () => {
    const f = fixture();
    f.incomplete.mockRejectedValueOnce(new Error('cache unavailable'));
    await expect(f.service.deleteResponse(7, 42, '5')).rejects.toThrow('cache unavailable');
    expect(f.remove).toHaveBeenCalledTimes(1);
    expect(f.statistics).not.toHaveBeenCalled();
  });

  it('invalidates all three projections for a completed bulk deletion', async () => {
    const f = fixture();
    await f.cache.invalidateCachesAfterTestResultDeletion(7);
    expect(f.incomplete).toHaveBeenCalledWith(7);
    expect(f.statistics).toHaveBeenCalledWith(7);
    expect(f.workspaceStats).toHaveBeenCalledWith(7);
  });
});
