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
  const emptyExclusions = {
    globalIgnoredUnits: [],
    ignoredBooklets: [],
    testletIgnoredUnits: []
  };

  let queryBuilder: {
    leftJoin: jest.Mock;
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
    expect(queryBuilder.andHaving).toHaveBeenCalledWith('COUNT(DISTINCT cju.code) > 1');
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
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
          { coderId: 2, jobId: 101, code: 2 }
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

    expect(queryBuilder.andHaving).toHaveBeenCalledWith('COUNT(DISTINCT cju.code) <= 1');
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
    expect(queryBuilder.andHaving).toHaveBeenCalledWith('COUNT(DISTINCT cju.code) > 1');
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '(resp.status_v2 IS NULL OR resp.status_v2 != :completeStatus)',
      { completeStatus: 5 }
    );
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
