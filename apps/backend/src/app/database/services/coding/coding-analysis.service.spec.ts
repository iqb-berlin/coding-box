import { Repository } from 'typeorm';
import { CodingAnalysisResultWriter } from './coding-analysis-result-store';
import { CodingAnalysisService } from './coding-analysis.service';
import { ResponseMatchingFlag } from './coding-job.service';
import { ResponseEntity } from '../../entities/response.entity';
import Persons from '../../entities/persons.entity';
import { Unit } from '../../entities/unit.entity';
import { Booklet } from '../../entities/booklet.entity';

jest.mock('./coding-job.service', () => ({
  ResponseMatchingFlag: {
    NO_AGGREGATION: 'NO_AGGREGATION',
    IGNORE_CASE: 'IGNORE_CASE',
    IGNORE_WHITESPACE: 'IGNORE_WHITESPACE'
  },
  CodingJobService: jest.fn()
}));

jest.mock('./coding-validation.service', () => ({
  CodingValidationService: jest.fn()
}));

jest.mock('./coding-statistics.service', () => ({
  CodingStatisticsService: jest.fn()
}));

describe('CodingAnalysisService aggregation settings', () => {
  function createService() {
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn()
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([{ pg_advisory_unlock: true }]),
      release: jest.fn().mockResolvedValue(undefined),
      manager: {
        getRepository: jest.fn()
      }
    };
    const queryBuilder = {
      select: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([{ id: '11' }, { id: '12' }])
    };
    const responseRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      update: jest.fn().mockResolvedValue(undefined),
      manager: {
        connection: {
          createQueryRunner: jest.fn().mockReturnValue(queryRunner)
        }
      }
    } as unknown as Repository<ResponseEntity>;
    queryRunner.manager.getRepository.mockReturnValue(responseRepository);
    const codingJobService = {
      getAggregationThreshold: jest.fn().mockResolvedValue(2),
      getResponseMatchingMode: jest.fn().mockResolvedValue([]),
      setAggregationThreshold: jest.fn().mockResolvedValue(undefined),
      setResponseMatchingMode: jest.fn().mockImplementation((_workspaceId, flags) => Promise.resolve(flags)),
      normalizeResponseMatchingFlags: jest.fn().mockImplementation(flags => (
        flags?.includes(ResponseMatchingFlag.NO_AGGREGATION) ?
          [ResponseMatchingFlag.NO_AGGREGATION] :
          Array.from(new Set(flags ?? []))
      ))
    };
    const codingValidationService = {
      invalidateIncompleteVariablesCache: jest.fn().mockResolvedValue(undefined)
    };
    const codingStatisticsService = {
      invalidateCache: jest.fn().mockResolvedValue(undefined)
    };
    const cacheService = {
      get: jest.fn().mockResolvedValue(null),
      getStrict: jest.fn().mockResolvedValue(null),
      getListItems: jest.fn().mockResolvedValue([]),
      acquireShortLock: jest.fn().mockResolvedValue(true),
      getAndDeleteIfFieldMatches: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(true),
      deleteByPattern: jest.fn().mockResolvedValue(undefined)
    };
    const jobQueueService = {
      getActiveCodingAnalysisJob: jest.fn().mockResolvedValue(null),
      addCodingAnalysisJob: jest.fn().mockResolvedValue(undefined)
    };

    const service = new CodingAnalysisService(
      responseRepository,
      {} as Repository<Persons>,
      {} as Repository<Booklet>,
      {} as Repository<Unit>,
      codingJobService as never,
      codingValidationService as never,
      codingStatisticsService as never,
      cacheService as never,
      jobQueueService as never
    );

    return {
      service,
      queryRunner,
      responseRepository,
      codingJobService,
      codingValidationService,
      codingStatisticsService,
      cacheService,
      jobQueueService
    };
  }

  it('saves settings, reverts legacy aggregation rows and invalidates dependent caches', async () => {
    const {
      service,
      responseRepository,
      codingJobService,
      codingValidationService,
      codingStatisticsService,
      cacheService,
      queryRunner
    } = createService();

    const result = await service.saveAggregationSettings(7, 101, [
      ResponseMatchingFlag.IGNORE_CASE,
      ResponseMatchingFlag.IGNORE_CASE
    ]);

    expect(result).toMatchObject({
      success: true,
      threshold: 100,
      flags: [ResponseMatchingFlag.IGNORE_CASE],
      aggregationActive: true,
      revertedResponses: 2
    });
    expect(codingJobService.setAggregationThreshold).toHaveBeenCalledWith(
      7,
      100,
      queryRunner.manager
    );
    expect(codingJobService.setResponseMatchingMode).toHaveBeenCalledWith(
      7,
      [ResponseMatchingFlag.IGNORE_CASE],
      queryRunner.manager
    );
    expect(responseRepository.update).toHaveBeenCalledWith(
      { id: expect.anything() },
      { code_v2: null, score_v2: null, status_v2: null }
    );
    expect(cacheService.deleteByPattern).toHaveBeenCalledWith('response-analysis:7_*');
    expect(codingValidationService.invalidateIncompleteVariablesCache).toHaveBeenCalledWith(7);
    expect(codingStatisticsService.invalidateCache).toHaveBeenCalledWith(7);
    expect(queryRunner.query).toHaveBeenNthCalledWith(
      1,
      'SELECT pg_try_advisory_lock($1::int, $2::int) AS locked',
      [774020251, 7]
    );
    expect(queryRunner.query).toHaveBeenNthCalledWith(
      2,
      'SELECT pg_advisory_unlock($1::int, $2::int)',
      [774020251, 7]
    );
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
    expect(queryRunner.query.mock.invocationCallOrder[1])
      .toBeLessThan(cacheService.deleteByPattern.mock.invocationCallOrder[0]);
  });

  it('fails without mutating data when the workspace lock is occupied', async () => {
    const {
      service,
      queryRunner,
      responseRepository,
      codingJobService,
      codingValidationService,
      codingStatisticsService,
      cacheService
    } = createService();
    queryRunner.query.mockReset().mockResolvedValue([{ locked: false }]);

    const result = await service.saveAggregationSettings(7, 4, [
      ResponseMatchingFlag.IGNORE_CASE
    ]);

    expect(result).toMatchObject({
      success: false,
      threshold: 4,
      flags: [ResponseMatchingFlag.IGNORE_CASE],
      revertedResponses: 0
    });
    expect(result.message).toContain('while test results are being modified');
    expect(codingJobService.setAggregationThreshold).not.toHaveBeenCalled();
    expect(codingJobService.setResponseMatchingMode).not.toHaveBeenCalled();
    expect(responseRepository.update).not.toHaveBeenCalled();
    expect(cacheService.deleteByPattern).not.toHaveBeenCalled();
    expect(codingValidationService.invalidateIncompleteVariablesCache)
      .not.toHaveBeenCalled();
    expect(codingStatisticsService.invalidateCache).not.toHaveBeenCalled();
    expect(queryRunner.query).toHaveBeenCalledTimes(1);
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('keeps no aggregation exclusive when saving settings', async () => {
    const { service, codingJobService, queryRunner } = createService();

    const result = await service.saveAggregationSettings(7, 2, [
      ResponseMatchingFlag.NO_AGGREGATION,
      ResponseMatchingFlag.IGNORE_CASE
    ]);

    expect(result.flags).toEqual([ResponseMatchingFlag.NO_AGGREGATION]);
    expect(result.aggregationActive).toBe(false);
    expect(codingJobService.setResponseMatchingMode).toHaveBeenCalledWith(7, [
      ResponseMatchingFlag.NO_AGGREGATION
    ], queryRunner.manager);
  });

  it('clears the selected result and registers a marker without a deadline before enqueueing', async () => {
    const {
      service,
      cacheService,
      jobQueueService
    } = createService();

    await service.startAnalysis(7, [ResponseMatchingFlag.IGNORE_CASE], 4, {
      forceRefresh: true
    });

    expect(cacheService.delete).toHaveBeenCalledWith('response-analysis:7_IGNORE_CASE_t4');
    const [markerKey, runId, ttl] = cacheService.set.mock.calls[0];
    expect([markerKey, runId, ttl]).toEqual(['response-analysis:7_IGNORE_CASE_t4:run', expect.any(String), 0]);
    expect(jobQueueService.addCodingAnalysisJob).toHaveBeenCalledWith({
      workspaceId: 7,
      matchingFlags: [ResponseMatchingFlag.IGNORE_CASE],
      threshold: 4,
      cacheKey: 'response-analysis:7_IGNORE_CASE_t4',
      runId
    });
    expect(cacheService.set.mock.invocationCallOrder[0])
      .toBeLessThan(jobQueueService.addCodingAnalysisJob.mock.invocationCallOrder[0]);
  });

  it('reuses an active analysis with the same settings even on an explicit refresh', async () => {
    const { service, jobQueueService, cacheService } = createService();
    cacheService.getStrict.mockResolvedValue('current-run');
    jobQueueService.getActiveCodingAnalysisJob.mockResolvedValue({ id: 'active-job' });

    await service.startAnalysis(7, [ResponseMatchingFlag.IGNORE_CASE], 4, { forceRefresh: true });

    expect(cacheService.getStrict).toHaveBeenCalledWith('response-analysis:7_IGNORE_CASE_t4:run');
    expect(jobQueueService.getActiveCodingAnalysisJob)
      .toHaveBeenCalledWith(7, 'response-analysis:7_IGNORE_CASE_t4', 'current-run');
    expect(cacheService.delete).not.toHaveBeenCalled();
    expect(jobQueueService.addCodingAnalysisJob).not.toHaveBeenCalled();
  });

  it('accepts a fresh run after invalidation while the previous run is still active', async () => {
    const { service, jobQueueService, cacheService } = createService();
    const cacheKey = 'response-analysis:7__t2';
    let marker: string | null = 'previous-run';
    const queue = [{ data: { runId: marker }, getState: async () => 'active', progress: 70 }];
    cacheService.getStrict.mockImplementation(async () => marker);
    cacheService.deleteByPattern.mockImplementation(async () => { marker = null; });
    cacheService.set.mockImplementation(async (_key, runId: string) => {
      marker = runId;
      return true;
    });
    jobQueueService.getActiveCodingAnalysisJob.mockImplementation(async (_workspaceId, _cacheKey, runId) => (
      queue.find(job => runId === undefined || job.data.runId === runId) ?? null
    ));
    jobQueueService.addCodingAnalysisJob.mockImplementation(async data => {
      queue.push({ data, getState: async () => 'waiting', progress: 0 });
    });

    await service.invalidateCache(7);
    await expect(service.getResponseAnalysis(7)).resolves.toMatchObject({
      isCalculating: false, needsCalculation: true
    });
    await service.startAnalysis(7, [], 2, { forceRefresh: true });
    await service.startAnalysis(7, [], 2, { forceRefresh: true });

    expect(jobQueueService.addCodingAnalysisJob).toHaveBeenCalledTimes(1);
    expect(jobQueueService.addCodingAnalysisJob).toHaveBeenCalledWith(expect.objectContaining({ cacheKey, runId: marker }));
    expect(marker).not.toBe('previous-run');
    await expect(service.getResponseAnalysis(7)).resolves.toMatchObject({
      isCalculating: true, isQueued: true, progress: 0
    });
  });

  it('reports a missing analysis from a status read without starting a job', async () => {
    const { service, jobQueueService } = createService();
    await expect(service.getResponseAnalysis(7)).resolves.toMatchObject({
      isCalculating: false,
      needsCalculation: true
    });
    expect(jobQueueService.addCodingAnalysisJob).not.toHaveBeenCalled();
  });

  it('returns the result when a job publishes it while the queue is being checked', async () => {
    const { service, cacheService, jobQueueService } = createService();
    jobQueueService.getActiveCodingAnalysisJob.mockImplementationOnce(async () => {
      cacheService.get.mockResolvedValue({
        storage: 'paged',
        listPrefix: 'completed-analysis',
        emptyResponses: { total: 1, totalUncoded: 1 },
        duplicateValues: { total: 0, totalResponses: 0 },
        aggregationSummary: { rawCases: 1 },
        matchingFlags: [],
        analysisTimestamp: '2026-11-23T09:00:00Z'
      });
      return null;
    });
    cacheService.getListItems.mockResolvedValueOnce([{ responseId: 42 }]);

    const result = await service.getResponseAnalysis(7);

    expect(result).toMatchObject({
      isCalculating: false,
      aggregationSummary: { rawCases: 1 },
      emptyResponses: { items: [{ responseId: 42 }] }
    });
    expect(result.needsCalculation).toBeUndefined();
  });

  it('still pages a legacy cached result created before lists were used', async () => {
    const { service, cacheService } = createService();
    cacheService.get.mockResolvedValue({
      emptyResponses: { total: 2, totalUncoded: 2, items: [{ responseId: 1 }, { responseId: 2 }] },
      duplicateValues: { total: 0, totalResponses: 0, groups: [] },
      aggregationSummary: {},
      matchingFlags: [],
      analysisTimestamp: '2026-11-23T09:00:00Z'
    });
    await expect(service.getResponseAnalysis(7, 2, 2, 1)).resolves.toMatchObject({
      emptyResponses: { total: 2, items: [{ responseId: 2 }] }
    });
    expect(cacheService.getListItems).not.toHaveBeenCalled();
  });

  it('reads only the requested slices of a stored analysis', async () => {
    const { service, cacheService } = createService();
    cacheService.get.mockResolvedValue({
      storage: 'paged',
      listPrefix: 'analysis-results',
      emptyResponses: { total: 5, totalUncoded: 5 },
      duplicateValues: { total: 8, totalResponses: 16, isAggregationApplied: false },
      aggregationSummary: {},
      matchingFlags: [],
      analysisTimestamp: '2026-11-23T09:00:00Z'
    });
    cacheService.getListItems.mockResolvedValueOnce([{ responseId: 5 }]).mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    await expect(service.getResponseAnalysis(7, 2, 3, 2, 2, 2)).resolves.toMatchObject({
      emptyResponses: { total: 5, items: [{ responseId: 5 }] },
      duplicateValues: { total: 8 }
    });
    expect(cacheService.getListItems).toHaveBeenCalledWith('analysis-results:empty', 4, 1);
    expect(cacheService.getListItems).toHaveBeenCalledWith('analysis-results:duplicates', 2, 2);
  });
  it('reads paged and complete occurrences from the result file and recovers from an expired file', async () => {
    const { service, cacheService } = createService();
    const writer = await CodingAnalysisResultWriter.create(7);
    const rows = Array.from({ length: 12 }, (_, index) => ({ responseId: index + 1 }));
    try {
      await writer.appendItems('occurrences', rows);
      await writer.appendItems('duplicates', [{ occurrences: rows.slice(0, 5), occurrenceStart: 0, occurrenceCount: 12 }]);
      await writer.finish();
      cacheService.get.mockResolvedValue({
        storage: 'file',
        resultId: writer.resultId,
        emptyResponses: { total: 0, totalUncoded: 0 },
        duplicateValues: { total: 1, totalResponses: rows.length },
        aggregationSummary: {},
        matchingFlags: []
      });
      await expect(service.getResponseAnalysis(7, 2, 1, 50, 1, 50, { page: 3, limit: 5 })).resolves.toMatchObject({
        duplicateValues: { groups: [{ occurrences: rows.slice(10), occurrenceCount: 12 }] }
      });
      const complete = await service.getResponseAnalysis(7);
      expect(complete.duplicateValues.groups).toEqual([{ occurrences: rows }]);
      expect(cacheService.getListItems).not.toHaveBeenCalled();
    } finally {
      await writer.discard();
    }
    await expect(service.getResponseAnalysis(7)).resolves.toMatchObject({ needsCalculation: true });
  });

  it('uses the stored preview and can read later occurrences from the same group', async () => {
    const { service, cacheService } = createService();
    const rows = Array.from({ length: 12 }, (_, index) => ({ responseId: index + 1 }));
    const storedGroup = { occurrences: rows.slice(0, 5), occurrenceStart: 30, occurrenceCount: 12 };
    cacheService.get.mockResolvedValue({
      storage: 'paged',
      listPrefix: 'analysis-results',
      emptyResponses: { total: 0, totalUncoded: 0 },
      duplicateValues: { total: 1, totalResponses: rows.length },
      aggregationSummary: {},
      matchingFlags: []
    });
    const read = cacheService.getListItems.mockImplementation(async (key, start: number, limit: number) => {
      if (key === 'analysis-results:duplicates') return [storedGroup];
      return key === 'analysis-results:occurrences' ? rows.slice(start - 30, start - 30 + limit) : [];
    });

    const preview = await service.getResponseAnalysis(7, 2, 1, 50, 1, 50, { page: 1, limit: 5 });
    expect(preview.duplicateValues.groups).toEqual([{ occurrences: rows.slice(0, 5), occurrenceCount: 12 }]);
    expect(read).not.toHaveBeenCalledWith('analysis-results:occurrences', expect.any(Number), expect.any(Number));

    const later = await service.getResponseAnalysis(7, 2, 1, 50, 1, 50, { page: 3, limit: 5 });
    expect(later.duplicateValues.groups).toEqual([{ occurrences: rows.slice(10), occurrenceCount: 12 }]);
    expect(read).toHaveBeenCalledWith('analysis-results:occurrences', 40, 2);

    const legacy = await service.getResponseAnalysis(7);
    expect(legacy.duplicateValues.groups).toEqual([{ occurrences: rows }]);
  });
});
