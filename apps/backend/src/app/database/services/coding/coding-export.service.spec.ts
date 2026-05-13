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

function createServiceWithDetailedMocks(
  codingIssueOption: number,
  overrides: {
    unit?: Record<string, unknown>,
    discussionResults?: Record<string, unknown>[],
    users?: Record<string, unknown>[]
  } = {}
) {
  const totalCountQueryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(1)
  };

  const defaultUnit = {
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
  };

  const unitsBatchQueryBuilder = {
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([overrides.unit || defaultUnit])
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

  const discussionResultRepository = {
    find: jest.fn().mockResolvedValue(overrides.discussionResults || [])
  };
  const userRepository = {
    findBy: jest.fn().mockResolvedValue(overrides.users || [])
  };

  const service = new CodingExportService(
    {} as Repository<ResponseEntity>,
    {} as Repository<CodingJob>,
    {} as Repository<CodingJobVariable>,
    codingJobUnitRepository as unknown as Repository<CodingJobUnit>,
    discussionResultRepository as unknown as Repository<CoderTrainingDiscussionResult>,
    userRepository as unknown as Repository<User>,
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

  it('emits detailed discussion rows even when the coder unit has no code', async () => {
    const { service } = createServiceWithDetailedMocks(0, {
      unit: {
        code: null,
        coding_issue_option: null,
        notes: '',
        updated_at: new Date('2026-04-14T10:00:00.000Z'),
        response_id: 123,
        unit_name: 'U1',
        variable_id: 'V1',
        coding_job: {
          training_id: 5,
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
      },
      discussionResults: [{
        training_id: 5,
        response_id: 123,
        code: 4,
        manager_user_id: 2,
        manager_name: 'stored-manager',
        updated_at: new Date('2026-04-14T11:00:00.000Z')
      }],
      users: [{ id: 2, username: 'manager1' }]
    });

    const buffer = await service.exportCodingResultsDetailed(
      1,
      false,
      false,
      false,
      false,
      '',
      undefined,
      false,
      undefined,
      undefined,
      [5]
    );
    const csv = buffer.toString('utf-8');

    expect(csv).not.toContain('"coder1";"U1";"V1"');
    expect(csv).toContain('"p-login";"p-code";"G1";"manager1";"U1";"V1";"";');
    expect(csv).toContain(';"4";""');
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

  it('keeps stored discussion manager names when manager users cannot be resolved', async () => {
    const discussionResult = {
      training_id: 5,
      response_id: 100,
      code: 2,
      manager_user_id: 12,
      manager_name: 'Stored Manager',
      updated_at: new Date('2026-04-14T11:00:00.000Z')
    };
    const discussionResultRepository = {
      find: jest.fn().mockResolvedValue([discussionResult])
    };
    const userRepository = {
      findBy: jest.fn().mockResolvedValue([])
    };

    const service = new CodingExportService(
      {} as Repository<ResponseEntity>,
      {} as Repository<CodingJob>,
      {} as Repository<CodingJobVariable>,
      {} as Repository<CodingJobUnit>,
      discussionResultRepository as unknown as Repository<CoderTrainingDiscussionResult>,
      userRepository as unknown as Repository<User>,
      {} as CodingListService,
      {} as WorkspaceCoreService,
      {} as WorkspaceExclusionService
    );

    const discussionResults = await (service as unknown as {
      getTrainingDiscussionResultsMap: (
        workspaceId: number,
        trainingIds?: number[],
        responseIds?: number[]
      ) => Promise<Map<string, { code: number | null; managerUsername: string | null; updatedAt: Date }>>
    }).getTrainingDiscussionResultsMap(7, [5], [100]);

    expect(discussionResults.get('5|100')).toMatchObject({
      code: 2,
      managerUsername: 'Stored Manager',
      updatedAt: discussionResult.updated_at
    });
    expect(userRepository.findBy).toHaveBeenCalledTimes(1);
  });

  it('scopes variable export helper queries to the current workspace', async () => {
    const createQueryBuilder = (rawRows: unknown[] = []) => {
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rawRows)
      };
      return qb;
    };

    const combinationsQuery = createQueryBuilder([{
      unitName: 'UNIT',
      variableId: 'VAR',
      bookletName: 'BOOKLET-A'
    }]);
    const personIdsQuery = createQueryBuilder([{ pId: 10 }]);
    const managerCasesQuery = createQueryBuilder([]);
    const dataQuery = createQueryBuilder([{
      login: 'login-a',
      code: 'code-a',
      group: 'group-a',
      bookletName: 'BOOKLET-A',
      cju_code: '1',
      coding_issue_option: null,
      code_v1: '1',
      code_v2: null,
      code_v3: null,
      status_v1: 8,
      username: 'Coder A',
      notes: null,
      pId: '10',
      trainingId: '5',
      responseId: '100'
    }]);
    const responseRepository = {
      createQueryBuilder: jest.fn()
        .mockReturnValueOnce(combinationsQuery)
        .mockReturnValueOnce(personIdsQuery)
        .mockReturnValueOnce(managerCasesQuery)
        .mockReturnValueOnce(dataQuery)
    };
    const coderQuery = createQueryBuilder([{ username: 'Coder A' }]);
    const codingJobUnitRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(coderQuery)
    };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };

    const service = new CodingExportService(
      responseRepository as unknown as Repository<ResponseEntity>,
      {} as Repository<CodingJob>,
      {} as Repository<CodingJobVariable>,
      codingJobUnitRepository as unknown as Repository<CodingJobUnit>,
      { find: jest.fn() } as unknown as Repository<CoderTrainingDiscussionResult>,
      { findBy: jest.fn() } as unknown as Repository<User>,
      {} as CodingListService,
      {} as WorkspaceCoreService,
      workspaceExclusionService as unknown as WorkspaceExclusionService
    );

    await service.exportCodingResultsByVariable(
      7,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      '',
      undefined,
      false,
      undefined,
      undefined,
      [5]
    );

    expect(personIdsQuery.innerJoin).toHaveBeenCalledWith('booklet.bookletinfo', 'bookletinfo');
    expect(personIdsQuery.andWhere).toHaveBeenCalledWith('person.workspace_id = :workspaceId', { workspaceId: 7 });
    expect(personIdsQuery.andWhere).toHaveBeenCalledWith('person.consider = :consider', { consider: true });

    expect(managerCasesQuery.innerJoin).toHaveBeenCalledWith('booklet.bookletinfo', 'bookletinfo');
    expect(managerCasesQuery.andWhere).toHaveBeenCalledWith('person.workspace_id = :workspaceId', { workspaceId: 7 });
    expect(managerCasesQuery.andWhere).toHaveBeenCalledWith('person.consider = :consider', { consider: true });

    expect(dataQuery.andWhere).toHaveBeenCalledWith('person.workspace_id = :workspaceId', { workspaceId: 7 });
    expect(dataQuery.andWhere).toHaveBeenCalledWith('person.consider = :consider', { consider: true });
    expect(dataQuery.andWhere).toHaveBeenCalledWith('cj.workspace_id = :workspaceId', { workspaceId: 7 });
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
