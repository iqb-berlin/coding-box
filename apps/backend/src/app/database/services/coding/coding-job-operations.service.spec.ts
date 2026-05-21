import { Repository } from 'typeorm';
import { CodingJobOperationsService } from './coding-job-operations.service';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingResultsService } from './coding-results.service';
import { CodingJobService } from './coding-job.service';
import { CodingValidationService } from './coding-validation.service';

jest.mock('../workspace/workspace-files.service', () => ({
  WorkspaceFilesService: jest.fn()
}));

describe('CodingJobOperationsService', () => {
  let service: CodingJobOperationsService;
  let codingJobRepository: jest.Mocked<Repository<CodingJob>>;
  let codingResultsService: jest.Mocked<CodingResultsService>;
  let codingJobService: jest.Mocked<CodingJobService>;
  let codingValidationService: jest.Mocked<CodingValidationService>;

  beforeEach(() => {
    codingJobRepository = {
      find: jest.fn()
    } as unknown as jest.Mocked<Repository<CodingJob>>;

    codingResultsService = {
      applyCodingResults: jest.fn()
    } as unknown as jest.Mocked<CodingResultsService>;

    codingJobService = {
      hasCodingIssues: jest.fn().mockResolvedValue(false)
    } as unknown as jest.Mocked<CodingJobService>;

    codingValidationService = {
      invalidateIncompleteVariablesCache: jest.fn().mockResolvedValue(undefined)
    } as unknown as jest.Mocked<CodingValidationService>;

    service = new CodingJobOperationsService(
      codingJobRepository,
      codingResultsService,
      codingJobService,
      codingValidationService
    );
  });

  it('bulk apply skips training and non-completed jobs before applying regular completed jobs', async () => {
    codingJobRepository.find.mockResolvedValue([
      {
        id: 1,
        name: 'Training job',
        status: 'completed',
        training_id: 21
      },
      {
        id: 2,
        name: 'Pending job',
        status: 'pending',
        training_id: null
      },
      {
        id: 3,
        name: 'Completed regular job',
        status: 'completed',
        training_id: null
      },
      {
        id: 4,
        name: 'Stale completed job',
        status: 'completed',
        training_id: null,
        freshness_status: 'stale_source'
      }
    ] as CodingJob[]);

    codingResultsService.applyCodingResults.mockResolvedValue({
      success: false,
      updatedResponsesCount: 0,
      skippedReviewCount: 0,
      skippedAlreadyCodedCount: 0,
      overwrittenExistingCount: 0,
      messageKey: 'coding-results.apply.error.double-coding-conflicts-present',
      messageParams: { count: 1 }
    });

    const result = await service.bulkApplyCodingResults(5);

    expect(codingJobRepository.find).toHaveBeenCalledWith({
      where: { workspace_id: 5 },
      select: ['id', 'name', 'status', 'training_id', 'freshness_status']
    });
    expect(codingResultsService.applyCodingResults).toHaveBeenCalledTimes(1);
    expect(codingResultsService.applyCodingResults).toHaveBeenCalledWith(5, 3, {});
    expect(result.jobsProcessed).toBe(0);
    expect(result.totalUpdatedResponses).toBe(0);
    expect(result.results).toEqual([
      {
        jobId: 1,
        jobName: 'Training job',
        hasIssues: false,
        skipped: true,
        skippedReason: 'training-job'
      },
      {
        jobId: 2,
        jobName: 'Pending job',
        hasIssues: false,
        skipped: true,
        skippedReason: 'not-completed'
      },
      {
        jobId: 3,
        jobName: 'Completed regular job',
        hasIssues: false,
        skipped: false,
        result: {
          success: false,
          updatedResponsesCount: 0,
          skippedReviewCount: 0,
          skippedAlreadyCodedCount: 0,
          overwrittenExistingCount: 0,
          message: 'coding-results.apply.error.double-coding-conflicts-present'
        }
      },
      {
        jobId: 4,
        jobName: 'Stale completed job',
        hasIssues: false,
        skipped: true,
        skippedReason: 'freshness-stale'
      }
    ]);
    expect(result.message).toContain('1 training jobs skipped');
    expect(result.message).toContain('1 jobs skipped because they are not completed');
    expect(result.message).toContain('1 jobs skipped because their source responses changed');
    expect(result.message).toContain('1 jobs could not be applied due to conflicts or errors');
  });
});
