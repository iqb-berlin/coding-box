import { Repository } from 'typeorm';
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

  it('clears the selected analysis cache before a forced restart', async () => {
    const {
      service,
      cacheService,
      jobQueueService
    } = createService();

    await service.startAnalysis(7, [ResponseMatchingFlag.IGNORE_CASE], 4, {
      forceRefresh: true
    });

    expect(cacheService.delete).toHaveBeenCalledWith('response-analysis:7_IGNORE_CASE_t4');
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
      runId: expect.any(String)
    });
  });

  it('queues a superseding forced restart even when an older workspace analysis is active', async () => {
    const {
      service,
      jobQueueService
    } = createService();
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

    expect(jobQueueService.addCodingAnalysisJob).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 7,
      cacheKey: 'response-analysis:7_IGNORE_CASE_t4',
      runId: expect.any(String)
    }));
  });
});
