import { Job } from 'bullmq';
import type { Repository } from 'typeorm';
import { ResponseMatchingFlag } from '../../database/services/coding/coding-job.service';
import { CacheService } from '../../cache/cache.service';
import type { PagedCodingAnalysis } from '../../database/services/coding/coding-analysis-cache-key.util';
import { EmptyResponseSelectionService } from '../../database/services/coding/empty-response-selection.service';
import { ResponseEntity } from '../../database/entities/response.entity';
import { WorkspaceExclusionService } from '../../database/services/workspace';
import type { WorkspaceFileMetadataReader } from '../../database/services/workspace/workspace-file-metadata-reader.token';
import { getManualCodingScopeKey } from '../../database/utils/manual-coding-scope.util';
import {
  CODING_COMPLETE_STATUS, CODING_INCOMPLETE_STATUS, INTENDED_INCOMPLETE_STATUS
} from '../../database/utils/manual-coding-candidate.util';
import { CodingAnalysisJobData } from '../job-queue.service';
import { CodingAnalysisProcessor } from './coding-analysis.processor';
import { ANALYSIS_BATCH_SIZE } from './coding-analysis-duplicates';

describe('CodingAnalysisProcessor', () => {
  function createProcessor(cacheService: Partial<CacheService>) {
    const processor = new CodingAnalysisProcessor(
      {} as never,
      cacheService as CacheService,
      {} as WorkspaceExclusionService,
      {} as EmptyResponseSelectionService
    );
    const analysis: PagedCodingAnalysis = {
      storage: 'paged',
      listPrefix: '',
      emptyResponses: {
        total: 0,
        totalUncoded: 0
      },
      duplicateValues: {
        total: 0,
        totalResponses: 0,
        isAggregationApplied: false
      },
      aggregationSummary: {
        duplicateGroups: 0,
        duplicateResponses: 0,
        collapsedCases: 0,
        rawCases: 0,
        effectiveCases: 0,
        threshold: 2,
        aggregationActive: true
      },
      matchingFlags: [],
      analysisTimestamp: '2026-05-22T00:00:00.000Z'
    };

    const computeResponseAnalysis = jest.fn(async (_workspaceId: number, _flags: string[], _threshold: number, listPrefix: string) => {
      analysis.listPrefix = listPrefix;
      return analysis;
    });
    (processor as unknown as { computeResponseAnalysis: typeof computeResponseAnalysis }).computeResponseAnalysis = computeResponseAnalysis;

    return {
      processor,
      analysis,
      computeResponseAnalysis
    };
  }

  function createJob(runId: string): Job<CodingAnalysisJobData> {
    return {
      id: 'analysis-job-1',
      data: {
        workspaceId: 7,
        matchingFlags: [],
        threshold: 2,
        cacheKey: 'response-analysis:7__t2',
        runId
      },
      getState: jest.fn(),
      updateProgress: jest.fn().mockResolvedValue(undefined)
    } as unknown as Job<CodingAnalysisJobData>;
  }

  it('does not publish analysis results superseded by a newer run', async () => {
    const cacheService = {
      publishListResult: jest.fn().mockResolvedValue(false),
      delete: jest.fn().mockResolvedValue(true)
    };
    const { processor, analysis } = createProcessor(cacheService);

    await expect(processor.handleResponseAnalysis(createJob('old-run'))).resolves.toBe(analysis.aggregationSummary);

    expect(cacheService.publishListResult).toHaveBeenCalledWith(
      'response-analysis:7__t2', expect.anything(), expect.objectContaining({
        marker: { key: 'response-analysis:7__t2:run', value: 'old-run' }
      })
    );
    expect(cacheService.delete).toHaveBeenCalledTimes(4);
  });

  it('publishes the current result and records only the summary in the job', async () => {
    const cacheService = {
      publishListResult: jest.fn().mockResolvedValue(true)
    };
    const { processor, analysis } = createProcessor(cacheService);
    const job = createJob('current-run');

    await expect(processor.handleResponseAnalysis(job)).resolves.toBe(analysis.aggregationSummary);
    expect(cacheService.publishListResult).toHaveBeenCalledWith('response-analysis:7__t2', analysis, {
      ttl: 600,
      listTtl: 660,
      lists: [
        { key: `${analysis.listPrefix}:empty`, length: 0 },
        { key: `${analysis.listPrefix}:duplicates`, length: 0 },
        { key: `${analysis.listPrefix}:occurrences`, length: 0 }
      ],
      marker: { key: 'response-analysis:7__t2:run', value: 'current-run' }
    });
    expect(job.updateProgress).toHaveBeenCalledWith(100);
  });

  it('renews staging expiries during a long calculation and stops after it finishes', async () => {
    jest.useFakeTimers();
    try {
      const expire = jest.fn().mockResolvedValue(undefined);
      const { processor, analysis, computeResponseAnalysis } = createProcessor({
        expire, publishListResult: jest.fn().mockResolvedValue(true)
      });
      let finishCalculation!: () => void;
      const calculation = new Promise<void>(resolve => { finishCalculation = resolve; });
      computeResponseAnalysis.mockImplementationOnce(async (_workspaceId, _flags, _threshold, listPrefix) => {
        analysis.listPrefix = listPrefix;
        await calculation;
        return analysis;
      });

      const job = processor.handleResponseAnalysis(createJob('long-running'));
      jest.advanceTimersByTime(61 * 60_000);
      expect(expire.mock.calls).toEqual([
        [`${analysis.listPrefix}:empty`, 3600],
        [`${analysis.listPrefix}:duplicates`, 3600],
        [`${analysis.listPrefix}:occurrences`, 3600],
        [`${analysis.listPrefix}:candidates`, 3600],
        [`${analysis.listPrefix}:empty`, 3600],
        [`${analysis.listPrefix}:duplicates`, 3600],
        [`${analysis.listPrefix}:occurrences`, 3600],
        [`${analysis.listPrefix}:candidates`, 3600]
      ]);
      finishCalculation();
      await job;

      jest.advanceTimersByTime(60 * 60_000);
      expect(expire).toHaveBeenCalledTimes(8);
    } finally {
      jest.useRealTimers();
    }
  });

  it('fails the job if Redis rejects publication and leaves the staging keys to expire', async () => {
    const cacheService = {
      publishListResult: jest.fn().mockRejectedValue(new Error('Incomplete analysis result list')),
      delete: jest.fn()
    };
    const { processor } = createProcessor(cacheService);
    const job = createJob('incomplete-run');

    await expect(processor.handleResponseAnalysis(job)).rejects.toThrow('Incomplete analysis result list');
    expect(job.updateProgress).not.toHaveBeenCalled();
    expect(cacheService.delete).not.toHaveBeenCalled();
  });

  it('keeps the marker during a retry and releases it only when a job finishes', async () => {
    const deleteIfMarkerMatches = jest.fn();
    const { processor } = createProcessor({ deleteIfMarkerMatches });
    const job = createJob('retried-run');
    jest.mocked(job.getState).mockResolvedValueOnce('delayed').mockResolvedValueOnce('failed');

    await processor.releaseFailedRunMarker(job);
    expect(deleteIfMarkerMatches).not.toHaveBeenCalled();
    await processor.releaseFailedRunMarker(job);
    expect(deleteIfMarkerMatches).toHaveBeenNthCalledWith(1, 'response-analysis:7__t2:run', 'retried-run');

    await processor.releaseCompletedRunMarker(createJob('completed-run'));
    expect(deleteIfMarkerMatches).toHaveBeenNthCalledWith(2, 'response-analysis:7__t2:run', 'completed-run');
  });

  function repositoryWithCursor<T>(rows: T[], sourceRepository?: unknown) {
    let offset = 0;
    const runner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      release: jest.fn(),
      manager: { getRepository: () => sourceRepository },
      query: jest.fn(async (sql: string) => {
        const fetch = /^FETCH FORWARD (\d+) FROM batch_rows$/.exec(sql);
        if (!fetch) return [];
        const limit = Number(fetch[1]);
        const page = rows.slice(offset, offset + limit);
        offset += limit;
        return page;
      })
    };
    const query = {
      select: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      clone: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getExists: jest.fn().mockResolvedValue(false),
      getCount: jest.fn().mockResolvedValue(rows.length),
      getQueryAndParameters: () => ['SELECT id FROM response', []],
      connection: { createQueryRunner: () => runner }
    };
    const repository = { createQueryBuilder: () => query } as unknown as Repository<ResponseEntity>;
    return { repository, query, runner };
  }

  function workspaceExclusions() {
    return {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [], ignoredBooklets: [], testletIgnoredUnits: []
      })
    } as unknown as WorkspaceExclusionService;
  }

  it('reads a popular variable in fixed pages and preserves every duplicate occurrence', async () => {
    const rows = Array.from({ length: ANALYSIS_BATCH_SIZE * 2 + 1 }, (_, index) => ({
      id: index + 1,
      unitid: index + 1,
      variableid: 'VAR',
      unitName: 'UNIT',
      unitAlias: 'UNIT',
      value: index === 1 ? 'unique' : ['ab', ' A B '][index % 2],
      personLogin: 'person',
      bookletName: 'booklet'
    }));
    const { repository, runner } = repositoryWithCursor(rows);
    const lists = new Map<string, unknown[]>();
    const staged: string[] = [];
    const cache = {
      appendSortedItems: jest.fn(async (_key, candidates: unknown[]) => {
        staged.push(...candidates.map(item => JSON.stringify(item)));
      }),
      getSortedItems: jest.fn(async (_key, offset: number, limit: number) => (
        staged.sort().slice(offset, offset + limit).map(item => JSON.parse(item))
      )),
      delete: jest.fn(async () => { staged.length = 0; return true; }),
      appendListItems: jest.fn(async (key: string, items: unknown[]) => {
        const list = lists.get(key) ?? [];
        list.push(...items);
        lists.set(key, list);
      }),
      publishListResult: jest.fn().mockResolvedValue(true)
    };
    const selectionService = {
      createContext: jest.fn().mockResolvedValue({ derivedVariableMap: new Map() }),
      filterEffectivelyEmptyResponses: jest.fn().mockResolvedValue([])
    } as unknown as EmptyResponseSelectionService;
    const processor = new CodingAnalysisProcessor(
      repository, cache as unknown as CacheService, workspaceExclusions(), selectionService
    );
    const job = createJob('large-variable');
    job.data.matchingFlags = [ResponseMatchingFlag.IGNORE_CASE, ResponseMatchingFlag.IGNORE_WHITESPACE];

    await expect(processor.handleResponseAnalysis(job)).resolves.toMatchObject({
      rawCases: rows.length, duplicateGroups: 1, duplicateResponses: rows.length - 1
    });

    expect(runner.query.mock.calls.filter(([sql]) => sql.startsWith('FETCH'))).toEqual([
      ['FETCH FORWARD 500 FROM batch_rows'], ['FETCH FORWARD 500 FROM batch_rows'], ['FETCH FORWARD 500 FROM batch_rows']
    ]);
    const { listPrefix } = cache.publishListResult.mock.calls[0][1] as PagedCodingAnalysis;
    expect(lists.get(`${listPrefix}:duplicates`)).toEqual([expect.objectContaining({
      occurrenceCount: 1000, occurrenceStart: 0, normalizedValue: 'ab'
    })]);
    expect(lists.get(`${listPrefix}:occurrences`)).toHaveLength(1000);
    expect(lists.get(`${listPrefix}:occurrences`)).toContainEqual(expect.objectContaining({ responseId: 1001 }));
    expect(lists.get(`${listPrefix}:occurrences`)).not.toContainEqual(expect.objectContaining({ responseId: 2 }));
  });

  it('selects the status needed to report an empty derived response for a mixed selection and justification', async () => {
    const derivedResponse = {
      id: 1,
      value: 'technical solver value',
      variableid: 'DERIVED',
      unitid: 2,
      status_v1: CODING_INCOMPLETE_STATUS,
      status_v2: null,
      code_v2: null,
      unitName: 'UNIT',
      personLogin: 'person',
      bookletName: 'booklet'
    };

    const sourceQuery = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        {
          id: 2, unitid: 2, variableid: 'CHOICE', value: 'selected', status_v1: CODING_COMPLETE_STATUS
        },
        {
          id: 3, unitid: 2, variableid: 'REASON', value: '', status_v1: INTENDED_INCOMPLETE_STATUS
        }
      ])
    };
    const sourceRepository = { createQueryBuilder: () => sourceQuery };
    const { repository, query: analysisQuery } = repositoryWithCursor([derivedResponse], sourceRepository);
    const emptyResponseSelectionService = new EmptyResponseSelectionService(
      sourceRepository as unknown as Repository<ResponseEntity>,
      {
        getDerivedVariableMetadata: jest.fn().mockResolvedValue({
          metadataAvailable: true,
          derivedVariableMap: new Map([['UNIT', new Set(['DERIVED'])]]),
          derivedVariablesBySourceMap: new Map([
            [getManualCodingScopeKey('UNIT', 'CHOICE'), new Set(['DERIVED'])],
            [getManualCodingScopeKey('UNIT', 'REASON'), new Set(['DERIVED'])]
          ])
        })
      } as unknown as WorkspaceFileMetadataReader
    );
    const appendListItems = jest.fn();
    const publish = jest.fn().mockResolvedValue(true);
    const processor = new CodingAnalysisProcessor(
      repository,
      { appendListItems, appendSortedItems: jest.fn(), publishListResult: publish } as unknown as CacheService,
      workspaceExclusions(),
      emptyResponseSelectionService
    );

    await processor.handleResponseAnalysis(createJob('mixed-response-run'));

    expect(analysisQuery.select).toHaveBeenCalledWith(expect.arrayContaining(['response.status_v1 AS status_v1']));
    expect(appendListItems).toHaveBeenCalledWith(expect.stringMatching(/:empty$/), [
      expect.objectContaining({ responseId: 1, value: 'technical solver value' })
    ], expect.any(Number));
    const analysis = publish.mock.calls[0][1] as PagedCodingAnalysis;
    expect(publish).toHaveBeenCalledWith(
      'response-analysis:7__t2',
      expect.objectContaining({ emptyResponses: { total: 1, totalUncoded: 1 }, duplicateValues: expect.objectContaining({ total: 0 }) }),
      {
        ttl: 600,
        listTtl: 660,
        lists: [
          { key: `${analysis.listPrefix}:empty`, length: 1 },
          { key: `${analysis.listPrefix}:duplicates`, length: 0 },
          { key: `${analysis.listPrefix}:occurrences`, length: 0 }
        ],
        marker: { key: 'response-analysis:7__t2:run', value: 'mixed-response-run' }
      }
    );
  });
});
