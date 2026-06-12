import { Repository } from 'typeorm';
import { CodingResultsService } from './coding-results.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJobService, ResponseMatchingFlag } from './coding-job.service';
import { CodingStatisticsService } from './coding-statistics.service';
import { CodingAnalysisService } from './coding-analysis.service';
import { CodingFreshnessService } from './coding-freshness.service';
import { CodingValidationService } from './coding-validation.service';
import { MissingsProfilesService } from './missings-profiles.service';
import { statusStringToNumber } from '../../utils/response-status-converter';

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
  let codingValidationService: jest.Mocked<Pick<CodingValidationService, 'invalidateIncompleteVariablesCache'>>;
  let codingAnalysisService: jest.Mocked<Pick<CodingAnalysisService, 'invalidateCache'>>;
  let missingsProfilesService: jest.Mocked<Pick<MissingsProfilesService, 'getMissingByIdForProfileOrDefault'>>;
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
      getResolvedCodingIssueReviewResponseIds: jest.fn().mockResolvedValue([]),
      getOpenCodingIssueReviewResponseIds: jest.fn().mockResolvedValue([]),
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

    codingValidationService = {
      invalidateIncompleteVariablesCache: jest.fn().mockResolvedValue(undefined)
    };

    codingAnalysisService = {
      invalidateCache: jest.fn().mockResolvedValue(undefined)
    };

    missingsProfilesService = {
      getMissingByIdForProfileOrDefault: jest.fn(async (_workspaceId, _profileId, missingId) => {
        if (missingId === 'mci') {
          return {
            id: 'mci', label: 'missing coding impossible', code: -97, score: 0
          };
        }
        return {
          id: 'mir', label: 'missing invalid response', code: -98, score: 0
        };
      })
    };

    codingFreshnessService = {
      markManualCodingCurrent: jest.fn().mockResolvedValue(undefined)
    };

    service = new CodingResultsService(
      responseRepository,
      codingStatisticsService,
      codingJobService,
      codingValidationService as unknown as CodingValidationService,
      codingAnalysisService as unknown as CodingAnalysisService,
      missingsProfilesService as unknown as MissingsProfilesService,
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
    const updateData = queryRunner.manager.update.mock.calls[0][2] as Partial<ResponseEntity>;
    expect(updateData).not.toHaveProperty('status_v1');
    expect(updateData).not.toHaveProperty('code_v1');
    expect(updateData).not.toHaveProperty('score_v1');
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
    expect(codingAnalysisService.invalidateCache).toHaveBeenCalledWith(17);
  });

  it('applies a coding job submitted for review', async () => {
    codingJobService.getCodingJobById.mockResolvedValueOnce({
      id: 10,
      status: 'review'
    } as never);
    codingJobService.getCodingJobByIdForWorkspace.mockResolvedValueOnce({
      id: 10,
      status: 'review'
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
    expect(codingJobService.markCodingJobResultsApplied).toHaveBeenCalledWith(
      10,
      17,
      queryRunner.manager
    );
  });

  it('resolves manually selected MIR missing from the coding job profile', async () => {
    codingJobService.getCodingJobById.mockResolvedValueOnce({
      id: 10,
      status: 'completed',
      missings_profile_id: 77
    } as never);
    codingJobService.getCodingProgress.mockResolvedValueOnce({
      'person@code@booklet::booklet::UNIT::VAR': {
        id: -3
      }
    });

    const result = await service.applyCodingResults(17, 10);

    expect(result.success).toBe(true);
    expect(missingsProfilesService.getMissingByIdForProfileOrDefault).toHaveBeenCalledWith(
      17,
      77,
      'mir'
    );
    expect(queryRunner.manager.update).toHaveBeenCalledWith(
      ResponseEntity,
      99,
      {
        code_v2: -98,
        score_v2: 0,
        status_v2: 5
      }
    );
  });

  it('resolves manually selected MCI missing from the coding job profile', async () => {
    codingJobService.getCodingJobById.mockResolvedValueOnce({
      id: 10,
      status: 'completed',
      missings_profile_id: 77
    } as never);
    codingJobService.getCodingProgress.mockResolvedValueOnce({
      'person@code@booklet::booklet::UNIT::VAR': {
        id: -4
      }
    });

    const result = await service.applyCodingResults(17, 10);

    expect(result.success).toBe(true);
    expect(missingsProfilesService.getMissingByIdForProfileOrDefault).toHaveBeenCalledWith(
      17,
      77,
      'mci'
    );
    expect(queryRunner.manager.update).toHaveBeenCalledWith(
      ResponseEntity,
      99,
      {
        code_v2: -97,
        score_v2: 0,
        status_v2: 5
      }
    );
  });

  it('does not silently apply a manual missing when its profile score is absent', async () => {
    codingJobService.getCodingJobById.mockResolvedValueOnce({
      id: 10,
      status: 'completed',
      missings_profile_id: 77
    } as never);
    codingJobService.getCodingProgress.mockResolvedValueOnce({
      'person@code@booklet::booklet::UNIT::VAR': {
        id: -3
      }
    });
    missingsProfilesService.getMissingByIdForProfileOrDefault.mockRejectedValueOnce(
      new Error("Missing 'mir' must define a score")
    );

    await expect(service.applyCodingResults(17, 10)).rejects.toThrow('score');
    expect(queryRunner.manager.update).not.toHaveBeenCalled();
    expect(codingJobService.markCodingJobResultsApplied).not.toHaveBeenCalled();
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
    expect(codingAnalysisService.invalidateCache).not.toHaveBeenCalled();
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

  it('does not block resolved coding issue reviews as double-coding conflicts', async () => {
    codingJobService.getResolvedCodingIssueReviewResponseIds
      .mockResolvedValueOnce([99]);
    (responseRepository.manager.query as jest.Mock)
      .mockResolvedValueOnce([{ id: 99, statusV2: null }]);

    const result = await service.applyCodingResults(17, 10);

    expect(result.success).toBe(true);
    expect(responseRepository.manager.query).toHaveBeenCalledTimes(1);
    expect(queryRunner.manager.update).toHaveBeenCalledWith(
      ResponseEntity,
      99,
      {
        code_v2: 0,
        score_v2: 0,
        status_v2: 5
      }
    );
    expect(codingJobService.markCodingJobResultsApplied).toHaveBeenCalled();
  });

  it('does not mark coding jobs as applied when only coding issues still require review', async () => {
    codingJobService.getCodingProgress.mockResolvedValueOnce({
      'person@code@booklet::booklet::UNIT::VAR': {
        id: -2,
        score: null
      }
    });

    const result = await service.applyCodingResults(17, 10);

    expect(result.success).toBe(true);
    expect(result.updatedResponsesCount).toBe(0);
    expect(result.skippedReviewCount).toBe(1);
    expect(result.messageKey).toBe('coding-results.apply.success.no-responses');
    expect(queryRunner.manager.update).not.toHaveBeenCalled();
    expect(codingJobService.markCodingJobResultsApplied).not.toHaveBeenCalled();
  });

  it('does not apply coding issue review units that are still open', async () => {
    codingJobService.getCodingProgress.mockResolvedValueOnce({
      'person@code@booklet::booklet::UNIT::VAR:open': {
        id: -1,
        code: '',
        label: 'OPEN'
      }
    });
    codingJobService.getOpenCodingIssueReviewResponseIds
      .mockResolvedValueOnce([99]);

    const result = await service.applyCodingResults(17, 10);

    expect(result.success).toBe(true);
    expect(result.updatedResponsesCount).toBe(0);
    expect(result.skippedReviewCount).toBe(1);
    expect(result.messageKey).toBe('coding-results.apply.success.no-responses');
    expect(queryRunner.manager.update).not.toHaveBeenCalled();
    expect(codingFreshnessService.markManualCodingCurrent).not.toHaveBeenCalled();
    expect(codingJobService.markCodingJobResultsApplied).not.toHaveBeenCalled();
  });

  it('keeps coding issues open even when the response already has completed v2 status', async () => {
    (responseRepository.manager.query as jest.Mock).mockResolvedValueOnce([{
      id: 99,
      statusV2: statusStringToNumber('CODING_COMPLETE')
    }]);
    codingJobService.getCodingProgress.mockResolvedValueOnce({
      'person@code@booklet::booklet::UNIT::VAR': {
        id: -2,
        score: null
      }
    });

    const result = await service.applyCodingResults(17, 10);

    expect(result.success).toBe(true);
    expect(result.updatedResponsesCount).toBe(0);
    expect(result.skippedReviewCount).toBe(1);
    expect(result.skippedAlreadyCodedCount).toBe(0);
    expect(queryRunner.manager.update).not.toHaveBeenCalled();
    expect(codingFreshnessService.markManualCodingCurrent).not.toHaveBeenCalled();
    expect(codingJobService.markCodingJobResultsApplied).not.toHaveBeenCalled();
  });

  it('applies valid results while skipping coding issues that still require review', async () => {
    codingJobService.getCodingJobUnits.mockResolvedValueOnce([
      {
        responseId: 99,
        personLogin: 'person',
        personCode: 'code',
        bookletName: 'booklet',
        unitName: 'UNIT',
        variableId: 'VAR'
      },
      {
        responseId: 100,
        personLogin: 'person',
        personCode: 'code',
        bookletName: 'booklet',
        unitName: 'UNIT',
        variableId: 'VAR2'
      }
    ] as never);
    codingJobService.getCodingProgress.mockResolvedValueOnce({
      'person@code@booklet::booklet::UNIT::VAR': {
        id: 0,
        score: 0
      },
      'person@code@booklet::booklet::UNIT::VAR2': {
        id: -2,
        score: null
      }
    });

    const result = await service.applyCodingResults(17, 10);

    expect(result.success).toBe(true);
    expect(result.updatedResponsesCount).toBe(1);
    expect(result.skippedReviewCount).toBe(1);
    expect(responseRepository.manager.query).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      [17, [99]]
    );
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
    expect(codingAnalysisService.invalidateCache).toHaveBeenCalledWith(17);
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

  it('does not propagate aggregated results to coding issues that still require review', async () => {
    codingJobService.getCodingJobUnits.mockResolvedValueOnce([
      {
        responseId: 99,
        personLogin: 'person',
        personCode: 'code',
        bookletName: 'booklet',
        unitName: 'UNIT',
        variableId: 'VAR'
      },
      {
        responseId: 100,
        personLogin: 'other',
        personCode: 'code',
        bookletName: 'booklet',
        unitName: 'UNIT',
        variableId: 'VAR'
      }
    ] as never);
    codingJobService.getCodingProgress.mockResolvedValueOnce({
      'person@code@booklet::booklet::UNIT::VAR': {
        id: 0,
        score: 0
      },
      'other@code@booklet::booklet::UNIT::VAR': {
        id: -2,
        score: null
      }
    });
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
        }
      ]));

    const result = await service.applyCodingResults(17, 10);

    expect(result.success).toBe(true);
    expect(result.updatedResponsesCount).toBe(1);
    expect(result.skippedReviewCount).toBe(1);
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
    expect(queryRunner.manager.update).not.toHaveBeenCalledWith(
      ResponseEntity,
      100,
      expect.any(Object)
    );
    expect(codingJobService.markCodingJobResultsApplied).not.toHaveBeenCalled();
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

  it('applies empty response coding and invalidates dependent caches', async () => {
    const rows = [
      { id: 1 },
      { id: 2 }
    ] as ResponseEntity[];
    const queryBuilder = createQueryBuilderMock(rows);
    responseRepository.createQueryBuilder = jest.fn(() => queryBuilder) as never;

    const result = await service.applyEmptyResponseCoding(17);

    expect(result).toEqual({
      success: true,
      updatedCount: 2,
      message: '2 leere Antworten erfolgreich kodiert'
    });
    expect(queryRunner.manager.update).toHaveBeenCalledTimes(2);
    expect(queryRunner.manager.update).toHaveBeenCalledWith(
      ResponseEntity,
      1,
      {
        code_v2: -98,
        score_v2: 0,
        status_v2: 5
      }
    );
    expect(missingsProfilesService.getMissingByIdForProfileOrDefault).toHaveBeenCalledWith(
      17,
      null,
      'mir'
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'response.status_v1 IN (:...statuses)',
      {
        statuses: [
          statusStringToNumber('CODING_INCOMPLETE'),
          statusStringToNumber('INTENDED_INCOMPLETE')
        ]
      }
    );
    const statusFilterCall = queryBuilder.andWhere.mock.calls.find(call => (
      call[0] === 'response.status_v1 IN (:...statuses)'
    ));
    expect(statusFilterCall?.[1].statuses).not.toContain(statusStringToNumber('DERIVE_ERROR'));
    expect(codingValidationService.invalidateIncompleteVariablesCache).toHaveBeenCalledWith(17);
    expect(codingStatisticsService.invalidateCache).toHaveBeenCalledWith(17);
    expect(codingAnalysisService.invalidateCache).toHaveBeenCalledWith(17);
  });
});
