import { Repository } from 'typeorm';
import { CodingResultsService } from './coding-results.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CacheService } from '../../../cache/cache.service';
import { CodingJobService, ResponseMatchingFlag } from './coding-job.service';
import { CodingStatisticsService } from './coding-statistics.service';
import { CodingAnalysisService } from './coding-analysis.service';
import { CodingFreshnessService } from './coding-freshness.service';

jest.mock('../workspace/workspace-files.service', () => ({
  WorkspaceFilesService: jest.fn()
}));

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
      query: jest.Mock;
      update: jest.Mock;
    };
  };
  let codingJobService: jest.Mocked<CodingJobService>;
  let codingStatisticsService: jest.Mocked<CodingStatisticsService>;
  let codingFreshnessService: jest.Mocked<Pick<CodingFreshnessService, 'markManualCodingCurrent'>>;

  const createQueryBuilderMock = (rows: unknown[]) => ({
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows)
  });

  beforeEach(() => {
    queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: {
        query: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({ affected: 1 })
      }
    };

    responseRepository = {
      createQueryBuilder: jest.fn(),
      manager: {
        query: jest.fn().mockResolvedValue([]),
        connection: {
          createQueryRunner: jest.fn(() => queryRunner)
        }
      }
    } as unknown as jest.Mocked<Repository<ResponseEntity>>;

    codingJobService = {
      getCodingJobById: jest.fn().mockResolvedValue({ id: 10, status: 'completed' }),
      getCodingJobByIdForWorkspace: jest.fn().mockResolvedValue({ id: 10, status: 'completed' }),
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
      getAggregationSettingsForCodingJob: jest.fn().mockResolvedValue({
        aggregationEnabled: false,
        aggregationThreshold: null,
        responseMatchingFlags: [ResponseMatchingFlag.NO_AGGREGATION],
        aggregationSettingsVersion: 1,
        fromJobSnapshot: true
      }),
      getDerivedVariableMapForAggregation: jest.fn().mockResolvedValue(new Map()),
      markCodingJobResultsApplied: jest.fn().mockResolvedValue({ id: 10, status: 'results_applied' })
    } as unknown as jest.Mocked<CodingJobService>;

    codingStatisticsService = {
      invalidateCache: jest.fn().mockResolvedValue(undefined)
    } as unknown as jest.Mocked<CodingStatisticsService>;

    codingFreshnessService = {
      markManualCodingCurrent: jest.fn().mockResolvedValue(undefined)
    };

    service = new CodingResultsService(
      responseRepository,
      { delete: jest.fn().mockResolvedValue(undefined) } as unknown as CacheService,
      codingStatisticsService,
      codingJobService,
      {} as CodingAnalysisService,
      codingFreshnessService as unknown as CodingFreshnessService
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
    expect(codingJobService.markCodingJobResultsApplied).toHaveBeenCalledWith(
      10,
      17,
      queryRunner.manager
    );
    expect(codingFreshnessService.markManualCodingCurrent).toHaveBeenCalledWith(
      17,
      [99],
      { codingJobId: 10, manager: queryRunner.manager }
    );
    expect(codingStatisticsService.invalidateCache).toHaveBeenCalledWith(17);
  });

  it('rolls back response updates when manual freshness cannot be finalized', async () => {
    codingFreshnessService.markManualCodingCurrent.mockRejectedValueOnce(new Error('freshness failed'));

    await expect(service.applyCodingResults(17, 10))
      .rejects.toThrow('freshness failed');

    expect(queryRunner.manager.update).toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(codingJobService.markCodingJobResultsApplied).not.toHaveBeenCalled();
    expect(codingStatisticsService.invalidateCache).not.toHaveBeenCalled();
  });

  it('blocks applying a completed coding job when its source freshness is stale', async () => {
    codingJobService.getCodingJobById.mockResolvedValueOnce({
      id: 10,
      status: 'completed',
      freshness_status: 'stale_source',
      freshness_affected_units: 2,
      freshness_affected_responses: 3
    } as never);

    const result = await service.applyCodingResults(17, 10);

    expect(result).toEqual({
      success: false,
      updatedResponsesCount: 0,
      skippedReviewCount: 0,
      skippedAlreadyCodedCount: 0,
      overwrittenExistingCount: 0,
      messageKey: 'coding-results.apply.error.freshness-review-required',
      messageParams: {
        status: 'stale_source',
        affectedUnits: 2,
        affectedResponses: 3
      }
    });
    expect(codingJobService.getCodingJobUnits).not.toHaveBeenCalled();
    expect(queryRunner.manager.update).not.toHaveBeenCalled();
    expect(codingFreshnessService.markManualCodingCurrent).not.toHaveBeenCalled();
  });

  it('blocks applying when freshness becomes stale after the initial check', async () => {
    codingJobService.getCodingJobByIdForWorkspace.mockResolvedValueOnce({
      id: 10,
      status: 'completed',
      freshness_status: 'stale_source',
      freshness_affected_units: 4,
      freshness_affected_responses: 7
    } as never);

    const result = await service.applyCodingResults(17, 10);

    expect(result).toEqual({
      success: false,
      updatedResponsesCount: 0,
      skippedReviewCount: 0,
      skippedAlreadyCodedCount: 0,
      overwrittenExistingCount: 0,
      messageKey: 'coding-results.apply.error.freshness-review-required',
      messageParams: {
        status: 'stale_source',
        affectedUnits: 4,
        affectedResponses: 7
      }
    });
    expect(queryRunner.manager.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      [expect.any(Number), 17]
    );
    expect(queryRunner.manager.update).not.toHaveBeenCalled();
    expect(codingFreshnessService.markManualCodingCurrent).not.toHaveBeenCalled();
    expect(codingJobService.markCodingJobResultsApplied).not.toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
  });

  it('allows applying a completed coding job when its freshness requires manual review', async () => {
    codingJobService.getCodingJobById.mockResolvedValueOnce({
      id: 10,
      status: 'completed',
      freshness_status: 'review_required'
    } as never);

    const result = await service.applyCodingResults(17, 10);

    expect(result.success).toBe(true);
    expect(queryRunner.manager.update).toHaveBeenCalledWith(
      ResponseEntity,
      99,
      {
        code_v2: 0,
        score_v2: 0,
        status_v2: 5
      }
    );
    expect(codingFreshnessService.markManualCodingCurrent).toHaveBeenCalledWith(
      17,
      [99],
      { codingJobId: 10, manager: queryRunner.manager }
    );
    expect(codingJobService.markCodingJobResultsApplied).toHaveBeenCalledWith(
      10,
      17,
      queryRunner.manager
    );
  });

  it('blocks applying unresolved double-coding conflicts', async () => {
    (responseRepository.manager.query as jest.Mock)
      .mockResolvedValueOnce([{ id: 99, statusV2: null }])
      .mockResolvedValueOnce([{ responseId: 99, statusV2: null }]);

    const result = await service.applyCodingResults(17, 10);

    expect(result.success).toBe(false);
    expect(result.updatedResponsesCount).toBe(0);
    expect(result.messageKey).toBe('coding-results.apply.error.double-coding-conflicts-present');
    expect(result.messageParams).toEqual({ count: 1 });
    expect(queryRunner.manager.update).not.toHaveBeenCalled();
    expect(codingJobService.markCodingJobResultsApplied).not.toHaveBeenCalled();
  });

  it('does not mark coding jobs as applied while coding issues still require review', async () => {
    codingJobService.getCodingProgress.mockResolvedValueOnce({
      'person@code@booklet::booklet::UNIT::VAR': {
        id: -2,
        score: null
      }
    });

    const result = await service.applyCodingResults(17, 10);

    expect(result.success).toBe(false);
    expect(result.updatedResponsesCount).toBe(0);
    expect(result.messageKey).toBe('coding-results.apply.error.uncertain-issues-present');
    expect(queryRunner.manager.update).not.toHaveBeenCalled();
    expect(codingJobService.markCodingJobResultsApplied).not.toHaveBeenCalled();
  });

  it('blocks applying coder training jobs to productive responses', async () => {
    codingJobService.getCodingJobById.mockResolvedValueOnce({
      id: 10,
      status: 'completed',
      training_id: 33
    } as never);

    const result = await service.applyCodingResults(17, 10);

    expect(result.success).toBe(false);
    expect(result.updatedResponsesCount).toBe(0);
    expect(result.messageKey).toBe('coding-results.apply.error.training-job');
    expect(codingJobService.getCodingJobUnits).not.toHaveBeenCalled();
    expect(queryRunner.manager.update).not.toHaveBeenCalled();
  });

  it('marks resolved double-coding results as applied when no response updates are needed', async () => {
    (responseRepository.manager.query as jest.Mock)
      .mockResolvedValueOnce([{ id: 99, statusV2: 5 }])
      .mockResolvedValueOnce([{ responseId: 99, statusV2: 5 }]);

    const result = await service.applyCodingResults(17, 10);

    expect(result.success).toBe(true);
    expect(result.updatedResponsesCount).toBe(0);
    expect(result.skippedAlreadyCodedCount).toBe(1);
    expect(queryRunner.manager.update).not.toHaveBeenCalled();
    expect(codingJobService.markCodingJobResultsApplied).toHaveBeenCalledWith(
      10,
      17,
      queryRunner.manager
    );
    expect(codingStatisticsService.invalidateCache).toHaveBeenCalledWith(17);
  });

  it('does not propagate matching sibling responses when aggregation is disabled', async () => {
    codingJobService.getAggregationSettingsForCodingJob.mockResolvedValue({
      aggregationEnabled: false,
      aggregationThreshold: 2,
      responseMatchingFlags: [ResponseMatchingFlag.NO_AGGREGATION],
      aggregationSettingsVersion: 1,
      fromJobSnapshot: true
    });

    const result = await service.applyCodingResults(17, 10);

    expect(result.success).toBe(true);
    expect(result.updatedResponsesCount).toBe(1);
    expect(codingJobService.getAggregationSettingsForCodingJob).toHaveBeenCalled();
    expect(queryRunner.manager.update).toHaveBeenCalledTimes(1);
    expect(queryRunner.manager.update).toHaveBeenCalledWith(
      ResponseEntity,
      99,
      {
        code_v2: 0,
        score_v2: 0,
        status_v2: 5
      }
    );
  });

  it('propagates aggregated results only to matching uncoded siblings by default', async () => {
    codingJobService.getAggregationSettingsForCodingJob.mockResolvedValue({
      aggregationEnabled: true,
      aggregationThreshold: 2,
      responseMatchingFlags: [
        ResponseMatchingFlag.IGNORE_CASE,
        ResponseMatchingFlag.IGNORE_WHITESPACE
      ],
      aggregationSettingsVersion: 1,
      fromJobSnapshot: true
    });

    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(createQueryBuilderMock([
        {
          id: 99,
          value: ' A ',
          variableid: 'VAR',
          status_v2: 3,
          unit: { id: 1, name: 'UNIT' }
        }
      ]))
      .mockReturnValueOnce(createQueryBuilderMock([
        {
          id: 99,
          value: ' A ',
          variableid: 'VAR',
          status_v2: 3,
          unit: { id: 1, name: 'UNIT' }
        },
        {
          id: 100,
          value: 'a',
          variableid: 'VAR',
          status_v2: null,
          unit: { id: 2, name: 'UNIT' }
        },
        {
          id: 101,
          value: 'A',
          variableid: 'VAR',
          status_v2: 5,
          unit: { id: 3, name: 'UNIT' }
        }
      ]));

    const result = await service.applyCodingResults(17, 10);

    expect(result.success).toBe(true);
    expect(result.updatedResponsesCount).toBe(2);
    expect(result.skippedAlreadyCodedCount).toBe(1);
    expect(result.overwrittenExistingCount).toBe(0);
    expect(queryRunner.manager.update).toHaveBeenCalledWith(
      ResponseEntity,
      100,
      {
        code_v2: 0,
        score_v2: 0,
        status_v2: 5
      }
    );
    expect(queryRunner.manager.update).not.toHaveBeenCalledWith(
      ResponseEntity,
      101,
      expect.any(Object)
    );
  });

  it('overwrites matching already coded siblings only when explicitly requested', async () => {
    codingJobService.getAggregationSettingsForCodingJob.mockResolvedValue({
      aggregationEnabled: true,
      aggregationThreshold: 2,
      responseMatchingFlags: [
        ResponseMatchingFlag.IGNORE_CASE,
        ResponseMatchingFlag.IGNORE_WHITESPACE
      ],
      aggregationSettingsVersion: 1,
      fromJobSnapshot: true
    });

    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(createQueryBuilderMock([
        {
          id: 99,
          value: ' A ',
          variableid: 'VAR',
          status_v2: 3,
          unit: { id: 1, name: 'UNIT' }
        }
      ]))
      .mockReturnValueOnce(createQueryBuilderMock([
        {
          id: 99,
          value: ' A ',
          variableid: 'VAR',
          status_v2: 3,
          unit: { id: 1, name: 'UNIT' }
        },
        {
          id: 100,
          value: 'a',
          variableid: 'VAR',
          status_v2: 5,
          unit: { id: 2, name: 'UNIT' }
        }
      ]));

    const result = await service.applyCodingResults(17, 10, { overwriteExisting: true });

    expect(result.success).toBe(true);
    expect(result.updatedResponsesCount).toBe(2);
    expect(result.skippedAlreadyCodedCount).toBe(0);
    expect(result.overwrittenExistingCount).toBe(1);
    expect(queryRunner.manager.update).toHaveBeenCalledWith(
      ResponseEntity,
      100,
      {
        code_v2: 0,
        score_v2: 0,
        status_v2: 5
      }
    );
  });

  it('does not propagate aggregated results when the saved threshold is not reached', async () => {
    codingJobService.getAggregationSettingsForCodingJob.mockResolvedValue({
      aggregationEnabled: true,
      aggregationThreshold: 3,
      responseMatchingFlags: [
        ResponseMatchingFlag.IGNORE_CASE,
        ResponseMatchingFlag.IGNORE_WHITESPACE
      ],
      aggregationSettingsVersion: 1,
      fromJobSnapshot: true
    });

    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(createQueryBuilderMock([
        {
          id: 99,
          value: ' A ',
          variableid: 'VAR',
          status_v2: 3,
          unit: { id: 1, name: 'UNIT' }
        }
      ]))
      .mockReturnValueOnce(createQueryBuilderMock([
        {
          id: 99,
          value: ' A ',
          variableid: 'VAR',
          status_v2: 3,
          unit: { id: 1, name: 'UNIT' }
        },
        {
          id: 100,
          value: 'a',
          variableid: 'VAR',
          status_v2: null,
          unit: { id: 2, name: 'UNIT' }
        }
      ]));

    const result = await service.applyCodingResults(17, 10);

    expect(result.success).toBe(true);
    expect(result.updatedResponsesCount).toBe(1);
    expect(queryRunner.manager.update).toHaveBeenCalledTimes(1);
    expect(queryRunner.manager.update).not.toHaveBeenCalledWith(
      ResponseEntity,
      100,
      expect.any(Object)
    );
  });

  it('does not propagate aggregated results for derived variables', async () => {
    codingJobService.getAggregationSettingsForCodingJob.mockResolvedValue({
      aggregationEnabled: true,
      aggregationThreshold: 2,
      responseMatchingFlags: [
        ResponseMatchingFlag.IGNORE_CASE,
        ResponseMatchingFlag.IGNORE_WHITESPACE
      ],
      aggregationSettingsVersion: 1,
      fromJobSnapshot: true
    });
    codingJobService.getDerivedVariableMapForAggregation.mockResolvedValue(
      new Map([['UNIT', new Set(['VAR'])]])
    );

    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(createQueryBuilderMock([
        {
          id: 99,
          value: ' A ',
          variableid: 'VAR',
          status_v2: 3,
          unit: { id: 1, name: 'UNIT' }
        }
      ]))
      .mockReturnValueOnce(createQueryBuilderMock([
        {
          id: 99,
          value: ' A ',
          variableid: 'VAR',
          status_v2: 3,
          unit: { id: 1, name: 'UNIT' }
        },
        {
          id: 100,
          value: 'a',
          variableid: 'VAR',
          status_v2: null,
          unit: { id: 2, name: 'UNIT' }
        }
      ]));

    const result = await service.applyCodingResults(17, 10);

    expect(result.success).toBe(true);
    expect(result.updatedResponsesCount).toBe(1);
    expect(queryRunner.manager.update).toHaveBeenCalledTimes(1);
    expect(queryRunner.manager.update).not.toHaveBeenCalledWith(
      ResponseEntity,
      100,
      expect.any(Object)
    );
  });
});
