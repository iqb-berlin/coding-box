import { CodingReviewService } from './coding-review.service';

jest.mock('./coding-statistics.service', () => ({
  CodingStatisticsService: jest.fn()
}));

jest.mock('../workspace/workspace-exclusion.service', () => ({
  applyResolvedExclusionsToQuery: jest.fn(),
  isExcludedByResolvedExclusions: jest.fn().mockReturnValue(false),
  WorkspaceExclusionService: jest.fn()
}));

describe('CodingReviewService', () => {
  const workspaceId = 123;
  const codingResultSignatureSql = "COUNT(DISTINCT (cju.code::text || ':' || COALESCE(cju.score::text, 'NULL')))";
  const emptyExclusions = {
    globalIgnoredUnits: [],
    ignoredBooklets: [],
    testletIgnoredUnits: []
  };

  let queryBuilder: {
    leftJoin: jest.Mock;
    innerJoin: jest.Mock;
    select: jest.Mock;
    addSelect: jest.Mock;
    where: jest.Mock;
    groupBy: jest.Mock;
    addGroupBy: jest.Mock;
    having: jest.Mock;
    andHaving: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    offset: jest.Mock;
    limit: jest.Mock;
    getQueryAndParameters: jest.Mock;
    getRawMany: jest.Mock;
  };
  let codingJobUnitRepository: {
    createQueryBuilder: jest.Mock;
    query: jest.Mock;
    find: jest.Mock;
  };
  let service: CodingReviewService;

  const makeCodingJobUnit = (
    overrides: Record<string, unknown> = {}
  ): Record<string, unknown> => ({
    response_id: 10,
    variable_id: 'VAR_1',
    coding_job_id: 100,
    code: 1,
    score: 1,
    notes: null,
    supervisor_comment: null,
    created_at: new Date('2026-05-18T00:00:00.000Z'),
    booklet_name: 'BOOKLET_1',
    unit_name: 'UNIT_1',
    coding_job: {
      workspace_id: workspaceId,
      job_definition_id: 11,
      training_id: null,
      name: 'Job A',
      codingJobCoders: [{
        user_id: 1,
        user: { username: 'Coder 1' }
      }]
    },
    response: {
      value: 'answer',
      unit: {
        name: 'UNIT_1',
        booklet: {
          bookletinfo: { name: 'BOOKLET_1' },
          person: {
            login: 'person-1',
            code: 'P001'
          }
        }
      }
    },
    ...overrides
  });

  beforeEach(() => {
    queryBuilder = {
      leftJoin: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      having: jest.fn().mockReturnThis(),
      andHaving: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getQueryAndParameters: jest.fn().mockReturnValue(['SELECT response ids', []]),
      getRawMany: jest.fn().mockResolvedValue([{ responseId: 10, responseStatus: null }])
    };

    codingJobUnitRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      query: jest.fn().mockResolvedValue([{ total: '1' }]),
      find: jest.fn().mockResolvedValue([
        makeCodingJobUnit(),
        makeCodingJobUnit({
          coding_job_id: 101,
          code: 2,
          coding_job: {
            workspace_id: workspaceId,
            job_definition_id: 11,
            training_id: null,
            name: 'Job B',
            codingJobCoders: [{
              user_id: 2,
              user: { username: 'Coder 2' }
            }]
          }
        }),
        makeCodingJobUnit({
          coding_job_id: 102,
          coding_job: null
        }),
        makeCodingJobUnit({
          coding_job_id: 103,
          coding_job: {
            workspace_id: 999,
            job_definition_id: 11,
            training_id: null,
            name: 'Wrong workspace',
            codingJobCoders: [{
              user_id: 3,
              user: { username: 'Coder 3' }
            }]
          }
        }),
        makeCodingJobUnit({
          coding_job_id: 104,
          coding_job: {
            workspace_id: workspaceId,
            job_definition_id: 99,
            training_id: null,
            name: 'Out of scope',
            codingJobCoders: [{
              user_id: 4,
              user: { username: 'Coder 4' }
            }]
          }
        })
      ])
    };

    service = new CodingReviewService(
      {} as never,
      codingJobUnitRepository as never,
      {} as never,
      {
        resolveExclusionsForQueries: jest.fn().mockResolvedValue(emptyExclusions)
      } as never
    );
  });

  it('applies conflict filters and keeps only scoped double-coded rows', async () => {
    codingJobUnitRepository.find.mockResolvedValueOnce([
      makeCodingJobUnit({
        code: 1,
        score: 0
      }),
      makeCodingJobUnit({
        coding_job_id: 101,
        code: 1,
        score: 1,
        coding_job: {
          workspace_id: workspaceId,
          job_definition_id: 11,
          training_id: null,
          name: 'Job B',
          codingJobCoders: [{
            user_id: 2,
            user: { username: 'Coder 2' }
          }]
        }
      }),
      makeCodingJobUnit({
        coding_job_id: 102,
        coding_job: null
      }),
      makeCodingJobUnit({
        coding_job_id: 103,
        coding_job: {
          workspace_id: 999,
          job_definition_id: 11,
          training_id: null,
          name: 'Wrong workspace',
          codingJobCoders: [{
            user_id: 3,
            user: { username: 'Coder 3' }
          }]
        }
      }),
      makeCodingJobUnit({
        coding_job_id: 104,
        coding_job: {
          workspace_id: workspaceId,
          job_definition_id: 99,
          training_id: null,
          name: 'Out of scope',
          codingJobCoders: [{
            user_id: 4,
            user: { username: 'Coder 4' }
          }]
        }
      })
    ]);

    const result = await service.getDoubleCodedVariablesForReview(
      workspaceId,
      1,
      50,
      false,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      'differ',
      [11],
      undefined
    );

    expect(queryBuilder.andHaving).toHaveBeenCalledWith('COUNT(cju.code) > 1');
    expect(queryBuilder.andHaving).toHaveBeenCalledWith(`${codingResultSignatureSql} > 1`);
    expect(queryBuilder.andWhere).not.toHaveBeenCalledWith(
      '(resp.status_v2 IS NULL OR resp.status_v2 != :completeStatus)',
      { completeStatus: 5 }
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '(cj.job_definition_id IN (:...jobDefinitionIds))',
      { jobDefinitionIds: [11] }
    );
    expect(codingJobUnitRepository.find).toHaveBeenCalledWith({
      where: { response_id: expect.any(Object) },
      relations: [
        'coding_job',
        'coding_job.training',
        'coding_job.codingJobCoders',
        'coding_job.codingJobCoders.user',
        'response',
        'response.unit',
        'response.unit.booklet',
        'response.unit.booklet.person'
      ]
    });
    expect(result).toMatchObject({
      total: 1,
      page: 1,
      limit: 50,
      data: [{
        responseId: 10,
        variableId: 'VAR_1',
        coderResults: [
          { coderId: 1, jobId: 100, code: 1 },
          {
            coderId: 2, jobId: 101, code: 1, score: 1
          }
        ]
      }]
    });
  });

  it('applies the match agreement filter', async () => {
    await service.getDoubleCodedVariablesForReview(
      workspaceId,
      1,
      50,
      false,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      'match'
    );

    expect(queryBuilder.andHaving).toHaveBeenCalledWith(`${codingResultSignatureSql} <= 1`);
    expect(queryBuilder.andHaving).not.toHaveBeenCalledWith('COUNT(cju.code) > 1');
  });

  it('keeps legacy only-conflicts behavior for older clients', async () => {
    await service.getDoubleCodedVariablesForReview(
      workspaceId,
      1,
      50,
      true
    );

    expect(queryBuilder.andHaving).toHaveBeenCalledWith('COUNT(cju.code) > 1');
    expect(queryBuilder.andHaving).toHaveBeenCalledWith(`${codingResultSignatureSql} > 1`);
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '(resp.status_v2 IS NULL OR resp.status_v2 != :completeStatus)',
      { completeStatus: 5 }
    );
  });

  it('returns matching and differing double-coded rows when agreement is unfiltered', async () => {
    queryBuilder.getRawMany.mockResolvedValueOnce([
      { responseId: 10, responseStatus: null },
      { responseId: 11, responseStatus: 5 }
    ]);
    codingJobUnitRepository.query.mockResolvedValueOnce([{ total: '2' }]);
    codingJobUnitRepository.find.mockResolvedValueOnce([
      makeCodingJobUnit({
        response_id: 10,
        coding_job_id: 100,
        code: 1,
        score: 0,
        coding_job: {
          workspace_id: workspaceId,
          job_definition_id: 11,
          training_id: null,
          name: 'Conflict Job A',
          codingJobCoders: [{
            user_id: 1,
            user: { username: 'Coder 1' }
          }]
        }
      }),
      makeCodingJobUnit({
        response_id: 10,
        coding_job_id: 101,
        code: 2,
        score: 1,
        coding_job: {
          workspace_id: workspaceId,
          job_definition_id: 11,
          training_id: null,
          name: 'Conflict Job B',
          codingJobCoders: [{
            user_id: 2,
            user: { username: 'Coder 2' }
          }]
        }
      }),
      makeCodingJobUnit({
        response_id: 11,
        coding_job_id: 110,
        code: 3,
        score: 1,
        variable_id: 'VAR_2',
        response: {
          value: 'matching answer',
          unit: {
            name: 'UNIT_2',
            booklet: {
              bookletinfo: { name: 'BOOKLET_2' },
              person: {
                login: 'person-2',
                code: 'P002'
              }
            }
          }
        },
        coding_job: {
          workspace_id: workspaceId,
          job_definition_id: 11,
          training_id: null,
          name: 'Match Job A',
          codingJobCoders: [{
            user_id: 3,
            user: { username: 'Coder 3' }
          }]
        }
      }),
      makeCodingJobUnit({
        response_id: 11,
        coding_job_id: 111,
        code: 3,
        score: 1,
        variable_id: 'VAR_2',
        response: {
          value: 'matching answer',
          unit: {
            name: 'UNIT_2',
            booklet: {
              bookletinfo: { name: 'BOOKLET_2' },
              person: {
                login: 'person-2',
                code: 'P002'
              }
            }
          }
        },
        coding_job: {
          workspace_id: workspaceId,
          job_definition_id: 11,
          training_id: null,
          name: 'Match Job B',
          codingJobCoders: [{
            user_id: 4,
            user: { username: 'Coder 4' }
          }]
        }
      })
    ]);

    const result = await service.getDoubleCodedVariablesForReview(workspaceId);

    expect(result.total).toBe(2);
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({
      responseId: 10,
      isResolved: false,
      coderResults: [
        { coderId: 1, code: 1, score: 0 },
        { coderId: 2, code: 2, score: 1 }
      ]
    });
    expect(result.data[1]).toMatchObject({
      responseId: 11,
      variableId: 'VAR_2',
      isResolved: true,
      coderResults: [
        { coderId: 3, code: 3, score: 1 },
        { coderId: 4, code: 3, score: 1 }
      ]
    });
  });

  it('applies resolved and coding-status filters independently', async () => {
    await service.getDoubleCodedVariablesForReview(
      workspaceId,
      1,
      50,
      false,
      false,
      undefined,
      undefined,
      'done',
      'resolved'
    );

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'resp.status_v2 = :completeStatus',
      { completeStatus: 5 }
    );
    expect(queryBuilder.andHaving).toHaveBeenCalledWith('COUNT(cju.code) = COUNT(cju.coding_job_id)');
  });

  it('combines job-definition and coder-training scopes with OR', async () => {
    await service.getDoubleCodedVariablesForReview(
      workspaceId,
      1,
      50,
      false,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      'all',
      [11],
      [21]
    );

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '(cj.job_definition_id IN (:...jobDefinitionIds) OR cj.training_id IN (:...coderTrainingIds))',
      {
        jobDefinitionIds: [11],
        coderTrainingIds: [21]
      }
    );
  });

  it('returns an empty page without loading relations when no double-coded rows match', async () => {
    codingJobUnitRepository.query.mockResolvedValueOnce([{ total: '0' }]);

    const result = await service.getDoubleCodedVariablesForReview(workspaceId);

    expect(codingJobUnitRepository.find).not.toHaveBeenCalled();
    expect(result).toEqual({
      data: [],
      total: 0,
      page: 1,
      limit: 50
    });
  });
});
