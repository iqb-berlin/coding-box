import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Job } from 'bullmq';
import type { Repository } from 'typeorm';
import { ResponseMatchingFlag } from '../../database/services/coding/coding-job.service';
import { CacheService } from '../../cache/cache.service';
import type {
  FileCodingAnalysis, StoredDuplicateValueGroup
} from '../../database/services/coding/coding-analysis-cache-key.util';
import {
  cleanExpiredCodingAnalysisResults, readCodingAnalysisResult
} from '../../database/services/coding/coding-analysis-result-store';
import type { DuplicateValueOccurrenceDto, EmptyResponseDto } from '../../../../../../api-dto/coding/response-analysis.dto';
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
  let root: string;
  let cwd: jest.SpyInstance;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'response-analysis-'));
    cwd = jest.spyOn(process, 'cwd').mockReturnValue(root);
  });

  afterEach(async () => {
    cwd.mockRestore();
    await rm(root, { recursive: true, force: true });
  });

  function createProcessor(cacheService: Partial<CacheService>) {
    const processor = new CodingAnalysisProcessor(
      {} as never,
      cacheService as CacheService,
      {} as WorkspaceExclusionService,
      {} as EmptyResponseSelectionService
    );
    const analysis: FileCodingAnalysis = {
      storage: 'file',
      resultId: '',
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

    const computeResponseAnalysis = jest.fn(async (_workspaceId: number, _flags: string[], _threshold: number, writer: { resultId: string }) => {
      analysis.resultId = writer.resultId;
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
    const cacheService = { publishIfMarkerMatches: jest.fn().mockResolvedValue(false) };
    const { processor, analysis } = createProcessor(cacheService);

    await expect(processor.handleResponseAnalysis(createJob('old-run'))).resolves.toBe(analysis.aggregationSummary);

    expect(cacheService.publishIfMarkerMatches).toHaveBeenCalledWith(
      'response-analysis:7__t2', analysis, 600, { key: 'response-analysis:7__t2:run', value: 'old-run' }
    );
    await expect(readdir(join(root, 'temp', 'response-analysis', '7'))).resolves.toEqual([]);
  });

  it('publishes the pointer and expires the result file after the read grace period', async () => {
    const cacheService = { publishIfMarkerMatches: jest.fn().mockResolvedValue(true) };
    const { processor, analysis } = createProcessor(cacheService);
    const job = createJob('current-run');

    await expect(processor.handleResponseAnalysis(job)).resolves.toBe(analysis.aggregationSummary);
    expect(cacheService.publishIfMarkerMatches).toHaveBeenCalledWith(
      'response-analysis:7__t2', analysis, 600, { key: 'response-analysis:7__t2:run', value: 'current-run' }
    );
    expect(job.updateProgress).toHaveBeenCalledWith(100);
    await cleanExpiredCodingAnalysisResults(Date.now() + 601_000);
    await expect(readCodingAnalysisResult(7, analysis.resultId, getItems => getItems('empty', 0, 1))).resolves.toEqual([]);
    await cleanExpiredCodingAnalysisResults(Date.now() + 661_000);
    await expect(readCodingAnalysisResult(7, analysis.resultId, getItems => getItems('empty', 0, 1))).resolves.toBeNull();
  });

  it('leaves the result file to expire when publication may have succeeded without a Redis reply', async () => {
    const cacheService = { publishIfMarkerMatches: jest.fn().mockRejectedValue(new Error('Lost Redis reply')) };
    const { processor, analysis } = createProcessor(cacheService);
    const job = createJob('uncertain-run');

    await expect(processor.handleResponseAnalysis(job)).rejects.toThrow('Lost Redis reply');
    expect(job.updateProgress).not.toHaveBeenCalled();
    await expect(readCodingAnalysisResult(7, analysis.resultId, getItems => getItems('empty', 0, 1))).resolves.toEqual([]);
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
      dataSource: { createQueryRunner: () => runner }
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
    const rows = Array.from({ length: ANALYSIS_BATCH_SIZE * 12 + 1 }, (_, index) => ({
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
    const cache = { publishIfMarkerMatches: jest.fn().mockResolvedValue(true) };
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
      ...Array.from({ length: 13 }, () => ['FETCH FORWARD 500 FROM batch_rows'])
    ]);
    const { resultId } = cache.publishIfMarkerMatches.mock.calls[0][1] as FileCodingAnalysis;
    const page = await readCodingAnalysisResult(7, resultId, async getItems => ({
      groups: await getItems<StoredDuplicateValueGroup>('duplicates', 0, 1),
      pages: await Promise.all(Array.from(
        { length: 12 }, (_, index) => getItems<DuplicateValueOccurrenceDto>('occurrences', index * 500, 500)
      ))
    }));
    expect(page?.groups).toEqual([expect.objectContaining({
      occurrenceCount: 6000, occurrenceStart: 0, normalizedValue: 'ab'
    })]);
    expect(page?.pages.map(items => items.length)).toEqual(Array(12).fill(500));
    expect(page?.pages.flat().map(item => item.responseId).sort((a, b) => a - b))
      .toEqual(rows.filter(row => row.id !== 2).map(row => row.id));
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
    const publish = jest.fn().mockResolvedValue(true);
    const processor = new CodingAnalysisProcessor(
      repository,
      { publishIfMarkerMatches: publish } as unknown as CacheService,
      workspaceExclusions(),
      emptyResponseSelectionService
    );

    await processor.handleResponseAnalysis(createJob('mixed-response-run'));

    expect(analysisQuery.select).toHaveBeenCalledWith(expect.arrayContaining(['response.status_v1 AS status_v1']));
    const { resultId } = publish.mock.calls[0][1] as FileCodingAnalysis;
    await expect(readCodingAnalysisResult(7, resultId, getItems => getItems<EmptyResponseDto>('empty', 0, 1)))
      .resolves.toEqual([expect.objectContaining({ responseId: 1, value: 'technical solver value' })]);
    expect(publish).toHaveBeenCalledWith(
      'response-analysis:7__t2',
      expect.objectContaining({
        emptyResponses: { total: 1, totalUncoded: 1 }, duplicateValues: expect.objectContaining({ total: 0 })
      }),
      600,
      { key: 'response-analysis:7__t2:run', value: 'mixed-response-run' }
    );
  });
});
