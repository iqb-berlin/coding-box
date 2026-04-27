import { Repository } from 'typeorm';
import { CodingResultsService } from './coding-results.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CacheService } from '../../../cache/cache.service';
import { CodingJobService } from './coding-job.service';
import { CodingStatisticsService } from './coding-statistics.service';
import { CodingAnalysisService } from './coding-analysis.service';

describe('CodingResultsService', () => {
  let service: CodingResultsService;
  let responseRepository: jest.Mocked<Repository<ResponseEntity>>;
  let queryRunner: {
    connect: jest.Mock;
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
    manager: {
      update: jest.Mock;
    };
  };
  let codingJobService: jest.Mocked<CodingJobService>;
  let codingStatisticsService: jest.Mocked<CodingStatisticsService>;

  beforeEach(() => {
    queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: {
        update: jest.fn().mockResolvedValue({ affected: 1 })
      }
    };

    responseRepository = {
      manager: {
        connection: {
          createQueryRunner: jest.fn(() => queryRunner)
        }
      }
    } as unknown as jest.Mocked<Repository<ResponseEntity>>;

    codingJobService = {
      getCodingJobById: jest.fn().mockResolvedValue({ id: 10, status: 'completed' }),
      getCodingJobUnits: jest.fn().mockResolvedValue([
        {
          responseId: 99,
          personLogin: 'person',
          personCode: 'code',
          bookletName: 'booklet',
          unitName: 'UNIT',
          variableId: 'VAR'
        }
      ]),
      getCodingProgress: jest.fn().mockResolvedValue({
        'person@code@booklet::booklet::UNIT::VAR': {
          id: 0,
          score: 0
        }
      }),
      getAggregationThreshold: jest.fn().mockResolvedValue(null),
      updateCodingJob: jest.fn().mockResolvedValue({ id: 10, status: 'results_applied' })
    } as unknown as jest.Mocked<CodingJobService>;

    codingStatisticsService = {
      invalidateCache: jest.fn().mockResolvedValue(undefined)
    } as unknown as jest.Mocked<CodingStatisticsService>;

    service = new CodingResultsService(
      responseRepository,
      { delete: jest.fn().mockResolvedValue(undefined) } as unknown as CacheService,
      codingStatisticsService,
      codingJobService,
      {} as CodingAnalysisService
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('applies code 0 as a completed coding result', async () => {
    const result = await service.applyCodingResults(17, 10);

    expect(result.success).toBe(true);
    expect(result.updatedResponsesCount).toBe(1);
    expect(queryRunner.manager.update).toHaveBeenCalledWith(
      ResponseEntity,
      99,
      {
        code_v2: 0,
        score_v2: 0,
        status_v2: 5
      }
    );
    expect(codingJobService.updateCodingJob).toHaveBeenCalledWith(10, 17, {
      status: 'results_applied'
    });
    expect(codingStatisticsService.invalidateCache).toHaveBeenCalledWith(17);
  });
});
