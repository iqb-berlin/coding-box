import { Repository } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CoderTrainingResultsApplyService } from './coder-training-results-apply.service';
import { CoderTrainingService } from './coder-training.service';
import { CodingStatisticsService } from './coding-statistics.service';
import { CodingValidationService } from './coding-validation.service';
import { CodingAnalysisService } from './coding-analysis.service';
import { CodingFreshnessService } from './coding-freshness.service';

describe('CoderTrainingResultsApplyService', () => {
  let service: CoderTrainingResultsApplyService;
  let responseRepository: jest.Mocked<Repository<ResponseEntity>>;
  let coderTrainingService: jest.Mocked<Pick<CoderTrainingService, 'getWithinTrainingCodingComparison'>>;
  let codingStatisticsService: jest.Mocked<Pick<CodingStatisticsService, 'invalidateCache'>>;
  let codingValidationService: jest.Mocked<Pick<CodingValidationService, 'invalidateIncompleteVariablesCache'>>;
  let codingAnalysisService: jest.Mocked<Pick<CodingAnalysisService, 'invalidateCache'>>;
  let codingFreshnessService: jest.Mocked<Pick<CodingFreshnessService, 'markManualCodingCurrent'>>;
  let queryRunner: {
    isTransactionActive: boolean;
    connect: jest.Mock;
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
    manager: {
      query: jest.Mock;
      getRepository: jest.Mock;
      delete: jest.Mock;
      update: jest.Mock;
    };
  };
  let queryBuilder: {
    select: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    getRawMany: jest.Mock;
  };

  beforeEach(() => {
    queryBuilder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([])
    };
    queryRunner = {
      isTransactionActive: false,
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockImplementation(async () => {
        queryRunner.isTransactionActive = true;
      }),
      commitTransaction: jest.fn().mockImplementation(async () => {
        queryRunner.isTransactionActive = false;
      }),
      rollbackTransaction: jest.fn().mockImplementation(async () => {
        queryRunner.isTransactionActive = false;
      }),
      release: jest.fn().mockResolvedValue(undefined),
      manager: {
        query: jest.fn(),
        getRepository: jest.fn().mockReturnValue({
          createQueryBuilder: jest.fn().mockReturnValue(queryBuilder)
        }),
        delete: jest.fn().mockResolvedValue({ affected: 1 }),
        update: jest.fn().mockResolvedValue({ affected: 1 })
      }
    };
    responseRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      manager: {
        query: jest.fn(),
        connection: {
          createQueryRunner: jest.fn().mockReturnValue(queryRunner)
        }
      }
    } as unknown as jest.Mocked<Repository<ResponseEntity>>;
    coderTrainingService = {
      getWithinTrainingCodingComparison: jest.fn().mockResolvedValue([
        {
          responseId: 101,
          unitName: 'Unit',
          variableId: 'Var',
          discussionCode: 7,
          discussionScore: 2,
          discussionSource: 'manual'
        },
        {
          responseId: 102,
          unitName: 'Unit',
          variableId: 'Var',
          discussionCode: 8,
          discussionScore: null,
          discussionSource: 'manual'
        },
        {
          responseId: 103,
          unitName: 'Unit',
          variableId: 'Var',
          discussionCode: 7,
          discussionScore: 2,
          discussionSource: 'auto_agreement'
        }
      ])
    } as never;
    codingStatisticsService = {
      invalidateCache: jest.fn().mockResolvedValue(undefined)
    };
    codingValidationService = {
      invalidateIncompleteVariablesCache: jest.fn().mockResolvedValue(undefined)
    };
    codingAnalysisService = {
      invalidateCache: jest.fn().mockResolvedValue(undefined)
    };
    codingFreshnessService = {
      markManualCodingCurrent: jest.fn().mockResolvedValue(undefined)
    };

    service = new CoderTrainingResultsApplyService(
      responseRepository,
      coderTrainingService as unknown as CoderTrainingService,
      codingStatisticsService as unknown as CodingStatisticsService,
      codingValidationService as unknown as CodingValidationService,
      codingAnalysisService as unknown as CodingAnalysisService,
      codingFreshnessService as unknown as CodingFreshnessService
    );
  });

  function mockRawQueries(target: { query: jest.Mock }, conflicts: unknown[] = []): void {
    target.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM coding_job_unit')) {
        return conflicts;
      }
      if (sql.includes('FROM coding_job')) {
        return [{ count: '0' }];
      }
      return [];
    });
  }

  function expectProductiveConflictQueryIncludesOpenUnitCheck(
    target: { query: jest.Mock }
  ): void {
    const conflictQuery = target.query.mock.calls.find(([sql]) => (
      typeof sql === 'string' && sql.includes('FROM coding_job_unit')
    ))?.[0];

    expect(conflictQuery).toContain('cju.is_open = true');
  }

  it('rejects invalid preview sources', async () => {
    await expect(service.previewTrainingDiscussionResults(1, 5, 'invalid' as never))
      .rejects
      .toThrow('A valid training discussion result source is required.');
    expect(coderTrainingService.getWithinTrainingCodingComparison).not.toHaveBeenCalled();
  });

  it('previews manual discussion results with existing results and job conflicts', async () => {
    queryBuilder.getRawMany.mockResolvedValueOnce([{ id: 101 }]);
    mockRawQueries(responseRepository.manager as unknown as { query: jest.Mock }, [
      {
        jobUnitId: 500,
        responseId: 101,
        jobId: 700,
        jobDefinitionId: 900,
        jobDefinitionStatus: 'approved',
        hasCodingWork: false
      }
    ]);

    const preview = await service.previewTrainingDiscussionResults(1, 5, 'manual');

    expect(preview.totalTrainingResponses).toBe(3);
    expect(preview.sourceResultsCount).toBe(2);
    expect(preview.applicableResultsCount).toBe(1);
    expect(preview.missingResultsCount).toBe(1);
    expect(preview.missingScoreCount).toBe(1);
    expect(preview.existingFinalResultsCount).toBe(1);
    expect(preview.productiveJobConflictCount).toBe(1);
    expect(preview.removableProductiveJobUnitCount).toBe(1);
    expect(preview.approvedJobDefinitionConflictCount).toBe(1);
    expect(preview.affectedJobIds).toEqual([700]);
    expect(preview.affectedJobDefinitionIds).toEqual([900]);
  });

  it('treats open productive job units as coding work in the conflict query', async () => {
    mockRawQueries(responseRepository.manager as unknown as { query: jest.Mock });

    await service.previewTrainingDiscussionResults(1, 5, 'manual');

    expectProductiveConflictQueryIncludesOpenUnitCheck(
      responseRepository.manager as unknown as { query: jest.Mock }
    );
  });

  it('applies results transactionally and removes untouched productive job units', async () => {
    queryBuilder.getRawMany.mockResolvedValueOnce([]);
    mockRawQueries(queryRunner.manager, [
      {
        jobUnitId: 500,
        responseId: 101,
        jobId: 700,
        jobDefinitionId: null,
        jobDefinitionStatus: null,
        hasCodingWork: false
      }
    ]);

    const result = await service.applyTrainingDiscussionResults(1, 5, {
      source: 'manual',
      existingResultStrategy: 'overwrite',
      jobConflictStrategy: 'removeFromJobs'
    });

    expect(queryRunner.manager.delete).toHaveBeenCalledWith(
      CodingJobUnit,
      expect.objectContaining({ id: expect.anything() })
    );
    expect(queryRunner.manager.update).toHaveBeenCalledWith(
      ResponseEntity,
      101,
      {
        code_v2: 7,
        score_v2: 2,
        status_v2: 5
      }
    );
    expect(codingFreshnessService.markManualCodingCurrent).toHaveBeenCalledWith(
      1,
      [101],
      { manager: queryRunner.manager }
    );
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(codingValidationService.invalidateIncompleteVariablesCache).toHaveBeenCalledWith(1);
    expect(codingStatisticsService.invalidateCache).toHaveBeenCalledWith(1);
    expect(codingAnalysisService.invalidateCache).toHaveBeenCalledWith(1);
    expect(result.updatedResponsesCount).toBe(1);
    expect(result.removedJobUnitCount).toBe(1);
  });

  it('does not roll back committed changes when post-commit invalidation fails', async () => {
    queryBuilder.getRawMany.mockResolvedValueOnce([]);
    mockRawQueries(queryRunner.manager);
    codingStatisticsService.invalidateCache.mockRejectedValueOnce(new Error('cache failed'));

    await expect(service.applyTrainingDiscussionResults(1, 5, {
      source: 'manual',
      existingResultStrategy: 'overwrite',
      jobConflictStrategy: 'removeFromJobs'
    })).rejects.toThrow('cache failed');

    expect(queryRunner.manager.update).toHaveBeenCalledWith(
      ResponseEntity,
      101,
      {
        code_v2: 7,
        score_v2: 2,
        status_v2: 5
      }
    );
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
  });

  it('does not partially remove job units for responses with blocking coding work', async () => {
    queryBuilder.getRawMany.mockResolvedValueOnce([]);
    mockRawQueries(queryRunner.manager, [
      {
        jobUnitId: 500,
        responseId: 101,
        jobId: 700,
        jobDefinitionId: null,
        jobDefinitionStatus: null,
        hasCodingWork: false
      },
      {
        jobUnitId: 501,
        responseId: 101,
        jobId: 701,
        jobDefinitionId: null,
        jobDefinitionStatus: null,
        hasCodingWork: true
      }
    ]);

    const result = await service.applyTrainingDiscussionResults(1, 5, {
      source: 'manual',
      existingResultStrategy: 'overwrite',
      jobConflictStrategy: 'removeFromJobs'
    });

    expect(queryRunner.manager.delete).not.toHaveBeenCalled();
    expect(queryRunner.manager.update).not.toHaveBeenCalled();
    expect(codingFreshnessService.markManualCodingCurrent).not.toHaveBeenCalled();
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(result.updatedResponsesCount).toBe(0);
    expect(result.skippedJobConflictCount).toBe(1);
    expect(result.removedJobUnitCount).toBe(0);
    expect(result.removableProductiveJobUnitCount).toBe(0);
  });

  it('counts overwritten existing results only when they are actually updated', async () => {
    queryBuilder.getRawMany.mockResolvedValueOnce([{ id: 101 }]);
    mockRawQueries(queryRunner.manager, [
      {
        jobUnitId: 500,
        responseId: 101,
        jobId: 700,
        jobDefinitionId: null,
        jobDefinitionStatus: null,
        hasCodingWork: false
      }
    ]);

    const result = await service.applyTrainingDiscussionResults(1, 5, {
      source: 'manual',
      existingResultStrategy: 'overwrite',
      jobConflictStrategy: 'skip'
    });

    expect(queryRunner.manager.update).not.toHaveBeenCalled();
    expect(result.updatedResponsesCount).toBe(0);
    expect(result.skippedJobConflictCount).toBe(1);
    expect(result.overwrittenExistingResultsCount).toBe(0);
  });
});
