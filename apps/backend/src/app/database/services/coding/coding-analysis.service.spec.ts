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
    const queryBuilder = {
      select: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([{ id: '11' }, { id: '12' }])
    };
    const responseRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      update: jest.fn().mockResolvedValue(undefined)
    } as unknown as Repository<ResponseEntity>;
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
    expect(codingJobService.setAggregationThreshold).toHaveBeenCalledWith(7, 100);
    expect(codingJobService.setResponseMatchingMode).toHaveBeenCalledWith(7, [ResponseMatchingFlag.IGNORE_CASE]);
    expect(responseRepository.update).toHaveBeenCalledWith(
      { id: expect.anything() },
      { code_v2: null, score_v2: null, status_v2: null }
    );
    expect(cacheService.deleteByPattern).toHaveBeenCalledWith('response-analysis:7_*');
    expect(codingValidationService.invalidateIncompleteVariablesCache).toHaveBeenCalledWith(7);
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
    const {
      service,
      cacheService,
      jobQueueService
    } = createService();

    await service.startAnalysis(7, [ResponseMatchingFlag.IGNORE_CASE], 4, {
      forceRefresh: true
    });

    expect(cacheService.delete).toHaveBeenCalledWith('response-analysis:7_IGNORE_CASE_t4');
    expect(jobQueueService.addCodingAnalysisJob).toHaveBeenCalledWith({
      workspaceId: 7,
      matchingFlags: [ResponseMatchingFlag.IGNORE_CASE],
      threshold: 4,
      cacheKey: 'response-analysis:7_IGNORE_CASE_t4'
    });
  });
});
