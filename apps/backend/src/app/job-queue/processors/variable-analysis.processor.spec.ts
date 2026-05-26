import { Job } from 'bull';
import { CacheService } from '../../cache/cache.service';
import { WorkspaceExclusionService } from '../../database/services/workspace';
import { VariableAnalysisJobData } from '../job-queue.service';
import { VariableAnalysisProcessor } from './variable-analysis.processor';

const createQueryBuilder = (rawRows: unknown[] = []) => ({
  innerJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  distinct: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  addOrderBy: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  addGroupBy: jest.fn().mockReturnThis(),
  clone: jest.fn().mockReturnThis(),
  getRawMany: jest.fn().mockResolvedValue(rawRows),
  getQueryAndParameters: jest.fn().mockReturnValue(['SELECT 1', []])
});

describe('VariableAnalysisProcessor', () => {
  it('stores full analysis results in cache and returns only small job metadata', async () => {
    const baseQuery = createQueryBuilder();
    const variableCombosQuery = createQueryBuilder([
      { unitId: '1', unitName: 'UNIT', variableId: 'VAR' }
    ]);
    const summaryQuery = createQueryBuilder([
      {
        unitId: '1',
        variableId: 'VAR',
        totalCount: '10',
        emptyCount: '1',
        distinctValueCount: '2'
      }
    ]);
    const topValuesQuery = createQueryBuilder();
    const statusQuery = createQueryBuilder([
      {
        unitId: '1',
        variableId: 'VAR',
        status: '3',
        count: '10'
      }
    ]);
    baseQuery.clone = jest.fn()
      .mockReturnValueOnce(variableCombosQuery)
      .mockReturnValueOnce(summaryQuery)
      .mockReturnValueOnce(topValuesQuery)
      .mockReturnValueOnce(statusQuery);

    const responseRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(baseQuery),
      query: jest.fn().mockResolvedValue([
        {
          unitId: '1',
          unitName: 'UNIT',
          variableId: 'VAR',
          value: 'x'.repeat(500),
          valueLength: '1000',
          valueHash: 'abc123',
          count: '9'
        }
      ])
    };
    const cacheService = {
      set: jest.fn().mockResolvedValue(true)
    };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };
    const processor = new VariableAnalysisProcessor(
      responseRepository as never,
      cacheService as unknown as CacheService,
      workspaceExclusionService as unknown as WorkspaceExclusionService
    );
    const job = {
      id: 'job-1',
      data: {
        workspaceId: 1,
        cacheKey: 'variable-analysis:1:job-1'
      },
      progress: jest.fn().mockResolvedValue(undefined)
    } as unknown as Job<VariableAnalysisJobData>;

    const metadata = await processor.process(job);

    expect(metadata).toEqual(expect.objectContaining({
      cacheKey: 'variable-analysis:1:job-1',
      workspaceId: 1,
      total: 1,
      storage: 'chunked',
      variableComboChunks: 1,
      frequencyChunks: 1,
      storedAt: expect.any(String)
    }));
    expect(metadata).not.toHaveProperty('variableCombos');
    expect(cacheService.set).toHaveBeenCalledWith(
      'variable-analysis:1:job-1:variable-combos:0',
      [expect.objectContaining({
        unitId: 1,
        unitName: 'UNIT',
        variableId: 'VAR'
      })],
      86400
    );
    expect(cacheService.set).toHaveBeenCalledWith(
      'variable-analysis:1:job-1:frequencies:0',
      [['1:VAR', [expect.objectContaining({
        value: `${'x'.repeat(500)}... [truncated 1000 chars, md5:abc123]`,
        count: 9,
        percentage: 90
      })]]],
      86400
    );
    expect(cacheService.set).toHaveBeenCalledWith(
      'variable-analysis:1:job-1',
      expect.objectContaining({
        storage: 'chunked',
        total: 1,
        variableComboChunks: 1,
        frequencyChunks: 1
      }),
      86400
    );
  });
});
