import { CacheService } from '../../../cache/cache.service';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { TestResultsFrequenciesService } from './test-results-frequencies.service';

describe('TestResultsFrequenciesService', () => {
  function fixture() {
    const query = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      clone: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn()
    };
    const repository = { createQueryBuilder: jest.fn().mockReturnValue(query) };
    const cache = { get: jest.fn(), set: jest.fn() };
    const exclusions = { resolveExclusionsForQueries: jest.fn().mockResolvedValue({ globalIgnoredUnits: [], ignoredBooklets: [], testletIgnoredUnits: [] }) };
    const service = new TestResultsFrequenciesService(repository as never, cache as unknown as CacheService, exclusions as unknown as WorkspaceExclusionService);
    return {
      service, query, repository, cache, exclusions
    };
  }

  it('returns a workspace-specific cache hit without querying response rows', async () => {
    const f = fixture();
    const result = { 'U:v': { total: 2, values: [{ value: 'x', count: 1, p: 0.5 }] } };
    f.cache.get.mockResolvedValue(result);
    await expect(f.service.findFlatResponseFrequencies(7, [{ unitKey: 'U', variableId: 'v', values: ['x'] }])).resolves.toBe(result);
    expect(f.cache.get).toHaveBeenCalledWith(expect.stringContaining('7-'));
    expect(f.repository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('merges repeated combinations, preserves zero-count values and never divides by zero', async () => {
    const f = fixture();
    f.query.getRawMany.mockResolvedValueOnce([{ unitKey: 'U', variableId: 'v', total: '4' }])
      .mockResolvedValueOnce([{
        unitKey: 'U', variableId: 'v', value: 'x', count: '2'
      }]);
    const result = await f.service.findFlatResponseFrequencies(7, [
      { unitKey: 'U', variableId: 'v', values: ['x'] },
      {
        unitKey: ' U ', variableId: 'v', values: ['x', 'missing']
      },
      { unitKey: 'empty', variableId: 'v', values: ['x'] }
    ]);
    expect(result).toEqual({
      'U:v': { total: 4, values: [{ value: 'x', count: 2, p: 0.5 }, { value: 'missing', count: 0, p: 0 }] },
      'empty:v': { total: 0, values: [{ value: 'x', count: 0, p: 0 }] }
    });
    expect(f.exclusions.resolveExclusionsForQueries).toHaveBeenCalledWith(7);
    expect(f.query.where).toHaveBeenCalledWith('person.workspace_id = :workspaceId', { workspaceId: 7 });
    expect(f.cache.set).toHaveBeenCalledWith(expect.any(String), result, 300);
  });

  it('rejects invalid workspaces before accessing cache or data', async () => {
    const f = fixture();
    await expect(f.service.findFlatResponseFrequencies(0, [])).rejects.toThrow('Invalid workspaceId');
    expect(f.cache.get).not.toHaveBeenCalled();
    expect(f.repository.createQueryBuilder).not.toHaveBeenCalled();
  });
});
