import { Repository } from 'typeorm';
import { CodingAnalysisService } from './coding-analysis.service';
import { ResponseMatchingFlag } from './coding-job.service';
import { ResponseEntity } from '../../entities/response.entity';
import Persons from '../../entities/persons.entity';
import { Unit } from '../../entities/unit.entity';
import { Booklet } from '../../entities/booklet.entity';
import {
  createDuplicateValuePageCache,
  createEmptyResponseChunkCaches,
  createDuplicateValueChunkCaches,
  RESPONSE_ANALYSIS_OCCURRENCE_PREVIEW_LIMIT
} from './response-analysis-page-cache.util';

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
      query: jest.fn().mockResolvedValue([{ revision: 11 }])
    } as unknown as Repository<ResponseEntity>;
    const codingJobService = {
      getAggregationThreshold: jest.fn().mockResolvedValue(2),
      getResponseMatchingMode: jest.fn().mockResolvedValue([]),
      setAggregationThreshold: jest.fn().mockResolvedValue(undefined),
      setResponseMatchingMode: jest
        .fn()
        .mockImplementation((_workspaceId, flags) => Promise.resolve(flags)),
      normalizeResponseMatchingFlags: jest
        .fn()
        .mockImplementation(flags => (flags?.includes(ResponseMatchingFlag.NO_AGGREGATION) ?
          [ResponseMatchingFlag.NO_AGGREGATION] :
          Array.from(new Set(flags ?? [])))
        )
    };
    const codingValidationService = {
      invalidateIncompleteVariablesCache: jest.fn().mockResolvedValue(undefined)
    };
    const codingStatisticsService = {
      invalidateCache: jest.fn().mockResolvedValue(undefined)
    };
    const cacheService = {
      get: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(true),
      deleteByPattern: jest.fn().mockResolvedValue(undefined)
    };
    const jobQueueService = {
      getActiveCodingAnalysisJob: jest.fn().mockResolvedValue(null),
      getCodingAnalysisJobForCacheKey: jest.fn().mockResolvedValue(null),
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
      cacheService
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
      100
    );
    expect(codingJobService.setResponseMatchingMode).toHaveBeenCalledWith(7, [
      ResponseMatchingFlag.IGNORE_CASE
    ]);
    expect(responseRepository.update).toHaveBeenCalledWith(
      { id: expect.anything() },
      { code_v2: null, score_v2: null, status_v2: null }
    );
    expect(cacheService.deleteByPattern).toHaveBeenCalledWith(
      'response-analysis:7_*'
    );
    expect(
      codingValidationService.invalidateIncompleteVariablesCache
    ).toHaveBeenCalledWith(7);
    expect(codingStatisticsService.invalidateCache).toHaveBeenCalledWith(7);
  });

  it('keeps no aggregation exclusive when saving settings', async () => {
    const { service, codingJobService } = createService();

    const result = await service.saveAggregationSettings(7, 2, [
      ResponseMatchingFlag.NO_AGGREGATION,
      ResponseMatchingFlag.IGNORE_CASE
    ]);

    expect(result.flags).toEqual([ResponseMatchingFlag.NO_AGGREGATION]);
    expect(result.aggregationActive).toBe(false);
    expect(codingJobService.setResponseMatchingMode).toHaveBeenCalledWith(7, [
      ResponseMatchingFlag.NO_AGGREGATION
    ]);
  });

  it('clears the selected analysis cache before a forced restart', async () => {
    const { service, cacheService, jobQueueService } = createService();

    await service.startAnalysis(7, [ResponseMatchingFlag.IGNORE_CASE], 4, {
      forceRefresh: true
    });

    expect(cacheService.delete).toHaveBeenCalledWith(
      'response-analysis:7_IGNORE_CASE_t4'
    );
    expect(cacheService.deleteByPattern).toHaveBeenCalledWith(
      'response-analysis:7_IGNORE_CASE_t4:*'
    );
    expect(cacheService.set).toHaveBeenCalledWith(
      'response-analysis:7_IGNORE_CASE_t4:run',
      expect.any(String),
      0
    );
    expect(jobQueueService.addCodingAnalysisJob).toHaveBeenCalledWith({
      workspaceId: 7,
      matchingFlags: [ResponseMatchingFlag.IGNORE_CASE],
      threshold: 4,
      cacheKey: 'response-analysis:7_IGNORE_CASE_t4',
      runId: expect.any(String),
      sourceRevision: 11
    });
  });

  it('queues a superseding forced restart even when an older workspace analysis is active', async () => {
    const { service, jobQueueService } = createService();
    jobQueueService.getActiveCodingAnalysisJob.mockResolvedValue({
      id: 'old-job',
      data: {
        workspaceId: 7,
        matchingFlags: [],
        threshold: 2,
        cacheKey: 'response-analysis:7__t2',
        runId: 'old-run'
      }
    });

    await service.startAnalysis(7, [ResponseMatchingFlag.IGNORE_CASE], 4, {
      forceRefresh: true
    });

    expect(jobQueueService.addCodingAnalysisJob).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 7,
        cacheKey: 'response-analysis:7_IGNORE_CASE_t4',
        runId: expect.any(String)
      })
    );
  });

  it('reuses an existing matching response analysis job without resetting its run marker', async () => {
    const { service, cacheService, jobQueueService } = createService();
    jobQueueService.getCodingAnalysisJobForCacheKey.mockResolvedValue({
      id: 'queued-job',
      data: {
        workspaceId: 7,
        matchingFlags: [ResponseMatchingFlag.IGNORE_CASE],
        threshold: 4,
        cacheKey: 'response-analysis:7_IGNORE_CASE_t4',
        runId: 'existing-run'
      }
    });

    await service.startAnalysis(7, [ResponseMatchingFlag.IGNORE_CASE], 4);

    expect(jobQueueService.addCodingAnalysisJob).not.toHaveBeenCalled();
    expect(cacheService.set).not.toHaveBeenCalledWith(
      'response-analysis:7_IGNORE_CASE_t4:run',
      expect.any(String),
      0
    );
  });

  it('serves response analysis from lightweight page caches without reading the full payload', async () => {
    const { service, cacheService, jobQueueService } = createService();
    cacheService.get.mockImplementation((key: string) => {
      if (key === 'response-analysis:7__t2:summary') {
        return Promise.resolve({
          emptyResponses: { total: 12, totalUncoded: 9 },
          duplicateValues: {
            total: 3,
            totalResponses: 8,
            isAggregationApplied: false
          },
          aggregationSummary: {
            duplicateGroups: 3,
            duplicateResponses: 8,
            collapsedCases: 5,
            rawCases: 8,
            effectiveCases: 3,
            threshold: 2,
            aggregationActive: true
          },
          matchingFlags: [],
          analysisTimestamp: '2026-05-22T00:00:00.000Z',
          sourceRevision: 11
        });
      }
      if (key === 'response-analysis:7__t2:empty:p2:l5') {
        return Promise.resolve({
          items: [
            {
              responseId: 101,
              unitName: 'u',
              unitAlias: null,
              variableId: 'v',
              personLogin: 'p',
              personCode: 'c',
              personGroup: 'g',
              bookletName: 'b',
              value: null
            }
          ],
          page: 2,
          pageSize: 5
        });
      }
      if (key === 'response-analysis:7__t2:duplicate:p3:l10') {
        return Promise.resolve({
          groups: [],
          page: 3,
          pageSize: 10
        });
      }
      return Promise.resolve(null);
    });

    const result = await service.getResponseAnalysis(7, 2, 2, 5, 3, 10);

    expect(result.emptyResponses.total).toBe(12);
    expect(result.emptyResponses.page).toBe(2);
    expect(result.emptyResponses.items).toHaveLength(1);
    expect(result.duplicateValues.totalResponses).toBe(8);
    expect(result.currentSourceRevision).toBe(11);
    expect(result.isCalculating).toBe(false);
    expect(cacheService.get).not.toHaveBeenCalledWith(
      'response-analysis:7__t2'
    );
    expect(jobQueueService.addCodingAnalysisJob).not.toHaveBeenCalled();
  });

  it('serves response analysis pages from chunk caches without reading the full payload', async () => {
    const { service, cacheService, jobQueueService } = createService();
    const analysis = {
      emptyResponses: {
        total: 2,
        totalUncoded: 2,
        items: [
          {
            responseId: 101,
            unitName: 'u1',
            unitAlias: null,
            variableId: 'v',
            personLogin: 'p1',
            personCode: 'c1',
            personGroup: 'g',
            bookletName: 'b',
            value: null
          },
          {
            responseId: 102,
            unitName: 'u2',
            unitAlias: null,
            variableId: 'v',
            personLogin: 'p2',
            personCode: 'c2',
            personGroup: 'g',
            bookletName: 'b',
            value: null
          }
        ]
      },
      duplicateValues: {
        total: 1,
        totalResponses: 6,
        groups: [
          {
            unitName: 'u',
            unitAlias: null,
            variableId: 'v',
            normalizedValue: 'same',
            originalValue: 'same',
            occurrences: Array.from({ length: 6 }, (_, index) => ({
              personLogin: `p${index}`,
              personCode: `${index}`,
              bookletName: 'b',
              responseId: index,
              value: 'same'
            }))
          }
        ],
        isAggregationApplied: false
      },
      aggregationSummary: {
        duplicateGroups: 1,
        duplicateResponses: 6,
        collapsedCases: 5,
        rawCases: 8,
        effectiveCases: 3,
        threshold: 2,
        aggregationActive: true
      },
      matchingFlags: [],
      analysisTimestamp: '2026-05-22T00:00:00.000Z',
      sourceRevision: 11
    };
    const emptyChunks = createEmptyResponseChunkCaches(analysis);
    const duplicateChunks = createDuplicateValueChunkCaches(analysis);
    cacheService.get.mockImplementation((key: string) => {
      if (key === 'response-analysis:7__t2:summary') {
        return Promise.resolve({
          emptyResponses: { total: 2, totalUncoded: 2 },
          duplicateValues: {
            total: 1,
            totalResponses: 6,
            isAggregationApplied: false
          },
          aggregationSummary: analysis.aggregationSummary,
          matchingFlags: [],
          analysisTimestamp: analysis.analysisTimestamp,
          sourceRevision: 11
        });
      }
      if (key === 'response-analysis:7__t2:empty-chunk:0') {
        return Promise.resolve(emptyChunks[0]);
      }
      if (key === 'response-analysis:7__t2:duplicate-chunk:0') {
        return Promise.resolve(duplicateChunks[0]);
      }
      return Promise.resolve(null);
    });

    const result = await service.getResponseAnalysis(7, 2, 1, 1, 1, 1);

    expect(result.emptyResponses.items).toHaveLength(1);
    expect(result.emptyResponses.items[0].responseId).toBe(101);
    expect(result.duplicateValues.groups).toHaveLength(1);
    expect(result.duplicateValues.groups[0].occurrences).toHaveLength(
      RESPONSE_ANALYSIS_OCCURRENCE_PREVIEW_LIMIT
    );
    expect(result.currentSourceRevision).toBe(11);
    expect(result.isCalculating).toBe(false);
    expect(cacheService.get).not.toHaveBeenCalledWith(
      'response-analysis:7__t2'
    );
    expect(jobQueueService.addCodingAnalysisJob).not.toHaveBeenCalled();
  });

  it('serves out-of-range response analysis pages from summary cache without recalculating', async () => {
    const { service, cacheService, jobQueueService } = createService();
    cacheService.get.mockImplementation((key: string) => {
      if (key === 'response-analysis:7__t2:summary') {
        return Promise.resolve({
          emptyResponses: { total: 2, totalUncoded: 2 },
          duplicateValues: {
            total: 1,
            totalResponses: 6,
            isAggregationApplied: false
          },
          aggregationSummary: {
            duplicateGroups: 1,
            duplicateResponses: 6,
            collapsedCases: 5,
            rawCases: 8,
            effectiveCases: 3,
            threshold: 2,
            aggregationActive: true
          },
          matchingFlags: [],
          analysisTimestamp: '2026-05-22T00:00:00.000Z',
          sourceRevision: 11
        });
      }
      return Promise.resolve(null);
    });

    const result = await service.getResponseAnalysis(7, 2, 99, 50, 42, 50);

    expect(result.emptyResponses.total).toBe(2);
    expect(result.emptyResponses.page).toBe(99);
    expect(result.emptyResponses.items).toEqual([]);
    expect(result.duplicateValues.total).toBe(1);
    expect(result.duplicateValues.page).toBe(42);
    expect(result.duplicateValues.groups).toEqual([]);
    expect(cacheService.get).not.toHaveBeenCalledWith(
      'response-analysis:7__t2'
    );
    expect(jobQueueService.addCodingAnalysisJob).not.toHaveBeenCalled();
  });

  it('marks cached response analysis stale when the test result revision changed', async () => {
    const { service, cacheService, jobQueueService } = createService();
    const cachedAnalysis = {
      emptyResponses: { total: 0, totalUncoded: 0, items: [] },
      duplicateValues: {
        total: 0,
        totalResponses: 0,
        groups: [],
        isAggregationApplied: false
      },
      aggregationSummary: {
        duplicateGroups: 0,
        duplicateResponses: 0,
        collapsedCases: 0,
        rawCases: 5,
        effectiveCases: 5,
        threshold: 2,
        aggregationActive: true
      },
      matchingFlags: [],
      analysisTimestamp: '2026-05-22T00:00:00.000Z',
      sourceRevision: 10
    };
    cacheService.get.mockImplementation((key: string) => Promise.resolve(key === 'response-analysis:7__t2' ? cachedAnalysis : null)
    );

    const result = await service.getResponseAnalysis(7);

    expect(result.sourceRevision).toBe(10);
    expect(result.currentSourceRevision).toBe(11);
    expect(result.isCalculating).toBe(true);
    expect(jobQueueService.addCodingAnalysisJob).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 7,
        cacheKey: 'response-analysis:7__t2',
        sourceRevision: 11
      })
    );
  });

  it('keeps legacy cached response analysis without revision usable', async () => {
    const { service, cacheService, jobQueueService } = createService();
    const cachedAnalysis = {
      emptyResponses: { total: 0, totalUncoded: 0, items: [] },
      duplicateValues: {
        total: 0,
        totalResponses: 0,
        groups: [],
        isAggregationApplied: false
      },
      aggregationSummary: {
        duplicateGroups: 0,
        duplicateResponses: 0,
        collapsedCases: 0,
        rawCases: 5,
        effectiveCases: 5,
        threshold: 2,
        aggregationActive: true
      },
      matchingFlags: [],
      analysisTimestamp: '2026-05-22T00:00:00.000Z'
    };
    cacheService.get.mockImplementation((key: string) => Promise.resolve(key === 'response-analysis:7__t2' ? cachedAnalysis : null)
    );

    const result = await service.getResponseAnalysis(7);

    expect(result.currentSourceRevision).toBe(11);
    expect(result.isCalculating).toBe(false);
    expect(jobQueueService.addCodingAnalysisJob).not.toHaveBeenCalled();
  });

  it('keeps only a duplicate occurrence preview in page caches', () => {
    const pageCache = createDuplicateValuePageCache(
      {
        emptyResponses: { total: 0, totalUncoded: 0, items: [] },
        duplicateValues: {
          total: 1,
          totalResponses: 12,
          isAggregationApplied: false,
          groups: [
            {
              unitName: 'u',
              unitAlias: null,
              variableId: 'v',
              normalizedValue: 'same',
              originalValue: 'same',
              occurrences: Array.from({ length: 12 }, (_, index) => ({
                personLogin: `person-${index}`,
                personCode: `${index}`,
                bookletName: 'booklet',
                responseId: index,
                value: 'same'
              }))
            }
          ]
        },
        aggregationSummary: {
          duplicateGroups: 1,
          duplicateResponses: 12,
          collapsedCases: 11,
          rawCases: 12,
          effectiveCases: 1,
          threshold: 2,
          aggregationActive: true
        },
        matchingFlags: [],
        analysisTimestamp: '2026-05-22T00:00:00.000Z'
      },
      1,
      10
    );

    expect(pageCache.groups[0].occurrenceCount).toBe(12);
    expect(pageCache.groups[0].occurrences).toHaveLength(
      RESPONSE_ANALYSIS_OCCURRENCE_PREVIEW_LIMIT
    );
  });
});
