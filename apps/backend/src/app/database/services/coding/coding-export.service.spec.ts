import { Repository } from 'typeorm';
import { CodingExportService } from './coding-export.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobVariable } from '../../entities/coding-job-variable.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CoderTrainingDiscussionResult } from '../../entities/coder-training-discussion-result.entity';
import User from '../../entities/user.entity';
import { CodingListService } from './coding-list.service';
import { WorkspaceCoreService } from '../workspace/workspace-core.service';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';

type MockedRepo<T> = Partial<Record<keyof Repository<T>, jest.Mock>>;

function createServiceWithDetailedMocks(codingIssueOption: number) {
  const totalCountQueryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(1)
  };

  const unitsBatchQueryBuilder = {
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([{
      code: 7,
      coding_issue_option: codingIssueOption,
      notes: '',
      updated_at: new Date('2026-04-14T10:00:00.000Z'),
      response_id: 123,
      unit_name: 'U1',
      variable_id: 'V1',
      coding_job: {
        training_id: null,
        codingJobCoders: [{ user: { username: 'coder1' } }]
      },
      response: {
        unit: {
          name: 'U1',
          booklet: {
            person: {
              login: 'p-login',
              code: 'p-code',
              group: 'G1'
            },
            bookletinfo: {
              name: 'B1'
            }
          }
        }
      }
    }])
  };

  const codingJobUnitRepository: MockedRepo<CodingJobUnit> = {
    createQueryBuilder: jest
      .fn()
      .mockReturnValueOnce(totalCountQueryBuilder)
      .mockReturnValueOnce(unitsBatchQueryBuilder)
  };

  const workspaceExclusionService = {
    resolveExclusionsForQueries: jest.fn().mockResolvedValue({
      globalIgnoredUnits: [],
      ignoredBooklets: [],
      testletIgnoredUnits: []
    })
  } as unknown as WorkspaceExclusionService;

  const service = new CodingExportService(
    {} as Repository<ResponseEntity>,
    {} as Repository<CodingJob>,
    {} as Repository<CodingJobVariable>,
    codingJobUnitRepository as unknown as Repository<CodingJobUnit>,
    {} as Repository<CoderTrainingDiscussionResult>,
    {} as Repository<User>,
    {} as CodingListService,
    {} as WorkspaceCoreService,
    workspaceExclusionService
  );

  return { service, totalCountQueryBuilder, unitsBatchQueryBuilder };
}

describe('CodingExportService (WS-Admin export smoke)', () => {
  it('keeps code value and writes code hint when coding_issue_option is set', async () => {
    const { service } = createServiceWithDetailedMocks(1);

    const buffer = await service.exportCodingResultsDetailed(1, false, false, false, false);
    const csv = buffer.toString('utf-8');

    expect(csv).toContain('"Code";"Code-Hinweis"');
    expect(csv).toContain('"7";"Code-Vergabe unsicher"');
  });

  it('normalizes negative coding_issue_option values in detailed export', async () => {
    const { service } = createServiceWithDetailedMocks(-1);

    const buffer = await service.exportCodingResultsDetailed(1, false, false, false, false);
    const csv = buffer.toString('utf-8');

    expect(csv).toContain('"7";"Code-Vergabe unsicher"');
  });

  it('ignores invalid job/training/coder filter ids', () => {
    const { service } = createServiceWithDetailedMocks(1);
    const queryBuilder = {
      andWhere: jest.fn().mockReturnThis()
    };

    (service as unknown as { applyJobFilters: (query: unknown, jobDefinitionIds?: number[], coderTrainingIds?: number[], coderIds?: number[]) => void }).applyJobFilters(
      queryBuilder,
      [Number.NaN, -2, 0],
      [Number.NaN, -1],
      [0, -3]
    );

    expect(queryBuilder.andWhere).not.toHaveBeenCalled();
  });

  it('applies normalized scoped filters for job/training/coder ids', () => {
    const { service } = createServiceWithDetailedMocks(1);
    const queryBuilder = {
      andWhere: jest.fn().mockReturnThis()
    };

    (service as unknown as { applyJobFilters: (query: unknown, jobDefinitionIds?: number[], coderTrainingIds?: number[], coderIds?: number[]) => void }).applyJobFilters(
      queryBuilder,
      [1, 1, Number.NaN, -1],
      [3, 3, 0],
      [7, 7, Number.NaN]
    );

    expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(
      1,
      '(cj.job_definition_id IN (:...jobDefinitionIds) OR cj.training_id IN (:...coderTrainingIds))',
      { jobDefinitionIds: [1], coderTrainingIds: [3] }
    );
    expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('EXISTS'),
      { coderIds: [7] }
    );
  });

  it('applies only job-definition filter when only job ids are selected', () => {
    const { service } = createServiceWithDetailedMocks(1);
    const queryBuilder = {
      andWhere: jest.fn().mockReturnThis()
    };

    (service as unknown as {
      applyJobFilters: (query: unknown, jobDefinitionIds?: number[], coderTrainingIds?: number[], coderIds?: number[]) => void
    }).applyJobFilters(queryBuilder, [11], undefined, undefined);

    expect(queryBuilder.andWhere).toHaveBeenCalledTimes(1);
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '(cj.job_definition_id IN (:...jobDefinitionIds))',
      { jobDefinitionIds: [11] }
    );
  });

  it('applies only training filter when only training ids are selected', () => {
    const { service } = createServiceWithDetailedMocks(1);
    const queryBuilder = {
      andWhere: jest.fn().mockReturnThis()
    };

    (service as unknown as {
      applyJobFilters: (query: unknown, jobDefinitionIds?: number[], coderTrainingIds?: number[], coderIds?: number[]) => void
    }).applyJobFilters(queryBuilder, undefined, [22], undefined);

    expect(queryBuilder.andWhere).toHaveBeenCalledTimes(1);
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '(cj.training_id IN (:...coderTrainingIds))',
      { coderTrainingIds: [22] }
    );
  });

  it('applies only coder filter when only coder ids are selected', () => {
    const { service } = createServiceWithDetailedMocks(1);
    const queryBuilder = {
      andWhere: jest.fn().mockReturnThis()
    };

    (service as unknown as {
      applyJobFilters: (query: unknown, jobDefinitionIds?: number[], coderTrainingIds?: number[], coderIds?: number[]) => void
    }).applyJobFilters(queryBuilder, undefined, undefined, [33]);

    expect(queryBuilder.andWhere).toHaveBeenCalledTimes(1);
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('EXISTS'),
      { coderIds: [33] }
    );
  });

  it('combines job/training scope with coder filter when all are selected', () => {
    const { service } = createServiceWithDetailedMocks(1);
    const queryBuilder = {
      andWhere: jest.fn().mockReturnThis()
    };

    (service as unknown as {
      applyJobFilters: (query: unknown, jobDefinitionIds?: number[], coderTrainingIds?: number[], coderIds?: number[]) => void
    }).applyJobFilters(queryBuilder, [44], [55], [66]);

    expect(queryBuilder.andWhere).toHaveBeenCalledTimes(2);
    expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(
      1,
      '(cj.job_definition_id IN (:...jobDefinitionIds) OR cj.training_id IN (:...coderTrainingIds))',
      { jobDefinitionIds: [44], coderTrainingIds: [55] }
    );
    expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('EXISTS'),
      { coderIds: [66] }
    );
  });
});
