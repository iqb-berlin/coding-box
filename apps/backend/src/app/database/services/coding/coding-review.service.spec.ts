import { CodingReviewService } from './coding-review.service';
import { CodingJobCoder } from '../../entities/coding-job-coder.entity';
import { applyResolvedExclusionsToQuery } from '../workspace/workspace-exclusion.service';

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
    innerJoin: jest.Mock;
    innerJoinAndSelect: jest.Mock;
    leftJoinAndSelect: jest.Mock;
    select: jest.Mock;
    addSelect: jest.Mock;
    where: jest.Mock;
    groupBy: jest.Mock;
    addGroupBy: jest.Mock;
    having: jest.Mock;
    andHaving: jest.Mock;
    andWhere: jest.Mock;
    setParameter: jest.Mock;
    orderBy: jest.Mock;
    addOrderBy: jest.Mock;
    offset: jest.Mock;
    limit: jest.Mock;
    getQueryAndParameters: jest.Mock;
    getRawMany: jest.Mock;
    getMany: jest.Mock;
  };
  let codingJobUnitRepository: {
    createQueryBuilder: jest.Mock;
    query: jest.Mock;
    find: jest.Mock;
  };
  let jobDefinitionRepository: {
    find: jest.Mock;
  };
  let variableBundleRepository: {
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
    updated_at: new Date('2026-05-18T00:00:00.000Z'),
    booklet_name: 'BOOKLET_1',
    unit_name: 'UNIT_1',
    person_login: 'person-1',
    person_code: 'P001',
    person_group: 'GROUP_1',
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
    jest.mocked(applyResolvedExclusionsToQuery).mockClear();
    queryBuilder = {
      leftJoin: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      having: jest.fn().mockReturnThis(),
      andHaving: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getQueryAndParameters: jest.fn().mockReturnValue(['SELECT response ids', []]),
      getRawMany: jest.fn().mockResolvedValue([{ responseId: 10, responseStatus: null }]),
      getMany: jest.fn().mockResolvedValue([])
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
    jobDefinitionRepository = {
      find: jest.fn().mockResolvedValue([])
    };
    variableBundleRepository = {
      find: jest.fn().mockResolvedValue([])
    };

    service = new CodingReviewService(
      {} as never,
      codingJobUnitRepository as never,
      jobDefinitionRepository as never,
      variableBundleRepository as never,
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

    expect(queryBuilder.andHaving).toHaveBeenCalledWith(expect.stringContaining('deduped_review_results.code IS NOT NULL'));
    expect(queryBuilder.andHaving).toHaveBeenCalledWith(expect.stringContaining('COUNT(DISTINCT deduped_review_results.signature)'));
    expect(queryBuilder.andWhere).not.toHaveBeenCalledWith(
      '(resp.status_v2 IS NULL OR resp.status_v2 != :completeStatus)',
      { completeStatus: 5 }
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '(cj.job_definition_id IN (:...jobDefinitionIds))',
      { jobDefinitionIds: [11] }
    );
    expect(queryBuilder.innerJoin).toHaveBeenCalledWith(
      expect.any(Function),
      'review_coder',
      'review_coder.coding_job_id = cj.id'
    );
    expect(queryBuilder.having).toHaveBeenCalledWith('COUNT(DISTINCT review_coder.user_id) > 1');
    expect(codingJobUnitRepository.find).toHaveBeenCalledWith({
      where: { response_id: expect.any(Object) },
      relations: [
        'coding_job',
        'coding_job.training',
        'coding_job.codingJobVariableBundles',
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

  it('builds the review scope from jobs with one distinct coder', async () => {
    await service.getDoubleCodedVariablesForReview(workspaceId);
    const singleCoderJoinFactory = queryBuilder.innerJoin.mock.calls[0][0] as (subQuery: {
      select: jest.Mock;
      addSelect: jest.Mock;
      from: jest.Mock;
      groupBy: jest.Mock;
      having: jest.Mock;
    }) => unknown;
    const singleCoderSubQuery = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      having: jest.fn().mockReturnThis()
    };

    singleCoderJoinFactory(singleCoderSubQuery);

    expect(singleCoderSubQuery.having).toHaveBeenCalledWith('COUNT(DISTINCT single_cjc.user_id) = 1');
  });

  it('resolves manual missing issue codes through the coding job profile for review results', async () => {
    const missingsProfilesService = {
      getMissingByIdForProfileOrDefault: jest.fn()
        .mockImplementation(async (_workspaceId: number, _profileId: number | null, missingId: string) => (
          missingId === 'mir' ?
            {
              id: 'mir', label: 'Missing interpreted response', code: -123, score: 0
            } :
            {
              id: 'mci', label: 'Missing coding impossible', code: -124, score: 0
            }
        ))
    };
    service = new CodingReviewService(
      {} as never,
      codingJobUnitRepository as never,
      jobDefinitionRepository as never,
      variableBundleRepository as never,
      {} as never,
      {
        resolveExclusionsForQueries: jest.fn().mockResolvedValue(emptyExclusions)
      } as never,
      missingsProfilesService as never
    );

    codingJobUnitRepository.find.mockResolvedValueOnce([
      makeCodingJobUnit({
        code: -3,
        score: null,
        coding_job: {
          workspace_id: workspaceId,
          missings_profile_id: 77,
          job_definition_id: 11,
          training_id: null,
          name: 'Job A',
          codingJobCoders: [{
            user_id: 1,
            user: { username: 'Coder 1' }
          }]
        }
      }),
      makeCodingJobUnit({
        coding_job_id: 101,
        code: -4,
        score: null,
        coding_job: {
          workspace_id: workspaceId,
          missings_profile_id: 77,
          job_definition_id: 11,
          training_id: null,
          name: 'Job B',
          codingJobCoders: [{
            user_id: 2,
            user: { username: 'Coder 2' }
          }]
        }
      })
    ]);

    const result = await service.getDoubleCodedVariablesForReview(workspaceId);

    expect(missingsProfilesService.getMissingByIdForProfileOrDefault).toHaveBeenCalledWith(workspaceId, 77, 'mir');
    expect(missingsProfilesService.getMissingByIdForProfileOrDefault).toHaveBeenCalledWith(workspaceId, 77, 'mci');
    expect(result.data[0].coderResults).toMatchObject([
      { coderId: 1, code: -123, score: 0 },
      { coderId: 2, code: -124, score: 0 }
    ]);
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

    expect(queryBuilder.andHaving).toHaveBeenCalledWith(expect.stringContaining('COUNT(DISTINCT deduped_review_results.signature)'));
    expect(queryBuilder.andHaving.mock.calls[0][0]).toContain('<= 1');
    expect(queryBuilder.andHaving.mock.calls[0][0]).not.toContain('COUNT(DISTINCT CASE WHEN cju.code IS NOT NULL THEN cjc.user_id END)');
  });

  it('keeps legacy only-conflicts behavior for older clients', async () => {
    await service.getDoubleCodedVariablesForReview(
      workspaceId,
      1,
      50,
      true
    );

    expect(queryBuilder.andHaving).toHaveBeenCalledWith(expect.stringContaining('deduped_review_results.code IS NOT NULL'));
    expect(queryBuilder.andHaving).toHaveBeenCalledWith(expect.stringContaining('COUNT(DISTINCT deduped_review_results.signature)'));
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
    expect(queryBuilder.andHaving).toHaveBeenCalledWith(expect.stringContaining('deduped_review_results.code IS NOT NULL'));
    const lastHavingCall = queryBuilder.andHaving.mock.calls[queryBuilder.andHaving.mock.calls.length - 1][0];
    expect(lastHavingCall).toContain(') = (SELECT COUNT(*) FROM');
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

  it('deduplicates multiple jobs for the same coder in one review row', async () => {
    codingJobUnitRepository.find.mockResolvedValueOnce([
      makeCodingJobUnit({
        coding_job_id: 100,
        code: 1,
        created_at: new Date('2026-05-18T00:00:00.000Z'),
        coding_job: {
          workspace_id: workspaceId,
          job_definition_id: null,
          training_id: 60,
          name: 'Training duplicate',
          codingJobCoders: [{
            user_id: 1,
            user: { username: 'Coder 1' }
          }]
        }
      }),
      makeCodingJobUnit({
        coding_job_id: 101,
        code: 2,
        created_at: new Date('2026-05-19T00:00:00.000Z'),
        coding_job: {
          workspace_id: workspaceId,
          job_definition_id: 11,
          training_id: null,
          name: 'Regular job',
          codingJobCoders: [{
            user_id: 1,
            user: { username: 'Coder 1' }
          }]
        }
      }),
      makeCodingJobUnit({
        coding_job_id: 102,
        code: 3,
        coding_job: {
          workspace_id: workspaceId,
          job_definition_id: 11,
          training_id: null,
          name: 'Other coder job',
          codingJobCoders: [{
            user_id: 2,
            user: { username: 'Coder 2' }
          }]
        }
      })
    ]);

    const result = await service.getDoubleCodedVariablesForReview(workspaceId);

    expect(result.data[0].coderResults).toEqual([
      expect.objectContaining({ coderId: 1, jobId: 101, code: 2 }),
      expect.objectContaining({ coderId: 2, jobId: 102, code: 3 })
    ]);
  });

  it('does not treat multiple coders on the same job as independent review decisions', async () => {
    codingJobUnitRepository.find.mockResolvedValueOnce([
      makeCodingJobUnit({
        coding_job_id: 100,
        code: 1,
        coding_job: {
          workspace_id: workspaceId,
          job_definition_id: 11,
          training_id: null,
          name: 'Shared multi-coder job',
          codingJobCoders: [
            {
              user_id: 1,
              user: { username: 'Coder 1' }
            },
            {
              user_id: 2,
              user: { username: 'Coder 2' }
            }
          ]
        }
      }),
      makeCodingJobUnit({
        coding_job_id: 101,
        code: 1,
        coding_job: {
          workspace_id: workspaceId,
          job_definition_id: 11,
          training_id: null,
          name: 'Single-coder job',
          codingJobCoders: [{
            user_id: 3,
            user: { username: 'Coder 3' }
          }]
        }
      })
    ]);

    const result = await service.getDoubleCodedVariablesForReview(workspaceId);

    expect(result.data).toEqual([]);
  });

  it('treats duplicate rows for the same coder on one job as one review decision', async () => {
    codingJobUnitRepository.find.mockResolvedValueOnce([
      makeCodingJobUnit({
        coding_job_id: 100,
        code: 1,
        coding_job: {
          workspace_id: workspaceId,
          job_definition_id: 11,
          training_id: null,
          name: 'Duplicated assignment job',
          codingJobCoders: [
            {
              user_id: 1,
              user: { username: 'Coder 1' }
            },
            {
              user_id: 1,
              user: { username: 'Coder 1 duplicate' }
            }
          ]
        }
      }),
      makeCodingJobUnit({
        coding_job_id: 101,
        code: 2,
        coding_job: {
          workspace_id: workspaceId,
          job_definition_id: 11,
          training_id: null,
          name: 'Other single-coder job',
          codingJobCoders: [{
            user_id: 2,
            user: { username: 'Coder 2' }
          }]
        }
      })
    ]);

    const result = await service.getDoubleCodedVariablesForReview(workspaceId);

    expect(result.data[0].coderResults).toEqual([
      expect.objectContaining({ coderId: 1, jobId: 100, code: 1 }),
      expect.objectContaining({ coderId: 2, jobId: 101, code: 2 })
    ]);
  });

  it('applies coder filters only through single-distinct-coder jobs', async () => {
    await service.getDoubleCodedVariablesForReview(
      workspaceId,
      1,
      50,
      false,
      false,
      undefined,
      1
    );

    const coderFilterFactory = queryBuilder.andWhere.mock.calls
      .map(([condition]) => condition)
      .find(condition => typeof condition === 'function') as (subQuery: {
      subQuery: jest.Mock;
      select: jest.Mock;
      from: jest.Mock;
      innerJoin: jest.Mock;
      where: jest.Mock;
      andWhere: jest.Mock;
      getQuery: jest.Mock;
    }) => string;
    const coderFilterSubQuery = {
      subQuery: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getQuery: jest.fn().mockReturnValue('(coder filter query)')
    };

    const condition = coderFilterFactory(coderFilterSubQuery);

    expect(condition).toBe('cju.response_id IN (coder filter query)');
    expect(coderFilterSubQuery.innerJoin).toHaveBeenCalledWith(
      CodingJobCoder,
      'cjc2',
      'cjc2.coding_job_id = cj2.id'
    );
    expect(coderFilterSubQuery.andWhere).toHaveBeenCalledWith(expect.stringContaining('COUNT(DISTINCT cjc2_distinct.user_id)'));
  });

  it('keeps legacy bundle jobs in job-definition scoped double-coding review rows', async () => {
    jobDefinitionRepository.find.mockResolvedValueOnce([{
      assigned_variable_bundles: [{
        id: 9,
        name: 'Bundle'
      }]
    }]);
    variableBundleRepository.find.mockResolvedValueOnce([{
      id: 9,
      variables: [{ unitName: 'UNIT_1', variableId: 'VAR_1' }]
    }]);
    codingJobUnitRepository.find.mockResolvedValueOnce([
      makeCodingJobUnit({
        coding_job_id: 100,
        coding_job: {
          workspace_id: workspaceId,
          job_definition_id: null,
          training_id: null,
          name: 'Legacy Bundle Job A',
          codingJobVariableBundles: [{ variable_bundle_id: 9 }],
          codingJobCoders: [{
            user_id: 1,
            user: { username: 'Coder 1' }
          }]
        }
      }),
      makeCodingJobUnit({
        coding_job_id: 101,
        code: 2,
        coding_job: {
          workspace_id: workspaceId,
          job_definition_id: null,
          training_id: null,
          name: 'Legacy Bundle Job B',
          codingJobVariableBundles: [{ variable_bundle_id: 9 }],
          codingJobCoders: [{
            user_id: 2,
            user: { username: 'Coder 2' }
          }]
        }
      }),
      makeCodingJobUnit({
        coding_job_id: 103,
        code: 4,
        variable_id: 'OTHER_VAR',
        coding_job: {
          workspace_id: workspaceId,
          job_definition_id: null,
          training_id: null,
          name: 'Same Bundle Other Variable',
          codingJobVariableBundles: [{ variable_bundle_id: 9 }],
          codingJobCoders: [{
            user_id: 4,
            user: { username: 'Coder 4' }
          }]
        }
      }),
      makeCodingJobUnit({
        coding_job_id: 102,
        code: 3,
        coding_job: {
          workspace_id: workspaceId,
          job_definition_id: null,
          training_id: null,
          name: 'Different Bundle Job',
          codingJobVariableBundles: [{ variable_bundle_id: 10 }],
          codingJobCoders: [{
            user_id: 3,
            user: { username: 'Coder 3' }
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
      'all',
      [11]
    );

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('scope_cjvb.variable_bundle_id IN (:...jobDefinitionBundleIds)'),
      { jobDefinitionIds: [11], jobDefinitionBundleIds: [9] }
    );
    expect(variableBundleRepository.find).toHaveBeenCalledWith({
      where: {
        id: expect.any(Object),
        workspace_id: workspaceId
      },
      select: ['id', 'variables']
    });
    expect(queryBuilder.andWhere.mock.calls[0][0]).toContain('variable_bundle scope_vb');
    expect(queryBuilder.andWhere.mock.calls[0][0]).toContain('scope_vb.variables');
    expect(queryBuilder.andWhere.mock.calls[0][0]).toContain('cju.unit_name');
    expect(result.data[0].coderResults).toEqual([
      expect.objectContaining({ coderId: 1, jobId: 100 }),
      expect.objectContaining({ coderId: 2, jobId: 101 })
    ]);
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

  it('loads coded variables for kappa with exclusions, training filter and coder deduplication', async () => {
    queryBuilder.getRawMany.mockResolvedValueOnce([
      {
        responseId: 10,
        unitName: 'UNIT_1',
        variableId: 'VAR_1',
        personLogin: 'person-1',
        personCode: 'P001',
        personGroup: 'GROUP_1',
        coderId: 1,
        coderName: 'Coder 1',
        jobId: 100,
        jobName: 'Training duplicate',
        jobDefinitionId: null,
        trainingId: 60,
        trainingLabel: 'Training A',
        code: 1,
        score: 1,
        notes: null,
        supervisorComment: null,
        codedAt: new Date('2026-05-18T00:00:00.000Z')
      },
      {
        responseId: 10,
        unitName: 'UNIT_1',
        variableId: 'VAR_1',
        personLogin: 'person-1',
        personCode: 'P001',
        personGroup: 'GROUP_1',
        coderId: 1,
        coderName: 'Coder 1',
        jobId: 101,
        jobName: 'Regular job',
        jobDefinitionId: 11,
        trainingId: null,
        trainingLabel: null,
        code: 2,
        score: 1,
        notes: null,
        supervisorComment: null,
        codedAt: new Date('2026-05-19T00:00:00.000Z')
      },
      {
        responseId: 10,
        unitName: 'UNIT_1',
        variableId: 'VAR_1',
        personLogin: 'person-1',
        personCode: 'P001',
        personGroup: 'GROUP_1',
        coderId: 2,
        coderName: 'Coder 2',
        jobId: 102,
        jobName: 'Other coder job',
        jobDefinitionId: 12,
        trainingId: null,
        trainingLabel: null,
        code: 3,
        score: 1,
        notes: null,
        supervisorComment: null,
        codedAt: new Date('2026-05-20T00:00:00.000Z')
      },
      {
        responseId: 11,
        unitName: 'UNIT:2',
        variableId: 'VAR:2',
        personLogin: 'person-2',
        personCode: 'P002',
        personGroup: 'GROUP_2',
        coderId: 3,
        coderName: 'Coder 3',
        jobId: 103,
        jobName: 'Single coded job',
        jobDefinitionId: 13,
        trainingId: null,
        trainingLabel: null,
        code: 4,
        score: 1,
        notes: null,
        supervisorComment: null,
        codedAt: new Date('2026-05-21T00:00:00.000Z')
      }
    ]);

    const result = await service.getCodedVariablesForKappa(workspaceId);

    expect(queryBuilder.innerJoin).toHaveBeenCalledWith('cju.coding_job', 'cj');
    expect(queryBuilder.innerJoin).toHaveBeenCalledWith(
      expect.any(Function),
      'single_coder_job',
      'single_coder_job.coding_job_id = cj.id'
    );
    expect(queryBuilder.innerJoin).toHaveBeenCalledWith('cj.codingJobCoders', 'cjc');
    expect(queryBuilder.leftJoin).toHaveBeenCalledWith('cj.training', 'training');
    expect(queryBuilder.select).toHaveBeenCalledWith('cju.response_id', 'responseId');
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('cju.code IS NOT NULL');
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('cj.training_id IS NULL');
    expect(queryBuilder.addOrderBy).toHaveBeenCalledWith('cju.id', 'ASC');
    expect(queryBuilder.addOrderBy).toHaveBeenCalledWith('cjc.id', 'ASC');
    expect(queryBuilder.offset).toHaveBeenCalledWith(0);
    expect(queryBuilder.limit).toHaveBeenCalledWith(5000);
    expect(applyResolvedExclusionsToQuery).toHaveBeenCalledWith(queryBuilder, emptyExclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix: 'kappaCodedVariables'
    });
    expect(result).toMatchObject([
      {
        responseId: 10,
        unitName: 'UNIT_1',
        variableId: 'VAR_1',
        personLogin: 'person-1',
        personCode: 'P001',
        personGroup: 'GROUP_1',
        coderResults: [
          {
            coderId: 1,
            jobId: 101,
            jobDefinitionId: 11,
            trainingId: null,
            code: 2
          },
          {
            coderId: 2,
            jobId: 102,
            code: 3
          }
        ]
      },
      {
        responseId: 11,
        unitName: 'UNIT:2',
        variableId: 'VAR:2',
        coderResults: [
          {
            coderId: 3,
            jobId: 103,
            code: 4
          }
        ]
      }
    ]);
  });

  it('keeps coder training rows in kappa data when trainings are included', async () => {
    queryBuilder.getRawMany.mockResolvedValueOnce([]);

    await service.getCodedVariablesForKappa(workspaceId, false);

    expect(queryBuilder.andWhere).toHaveBeenCalledWith('cju.code IS NOT NULL');
    expect(queryBuilder.andWhere).not.toHaveBeenCalledWith('cj.training_id IS NULL');
  });

  it('applies job definition, coder training and coder scopes to kappa data', async () => {
    queryBuilder.getRawMany.mockResolvedValueOnce([]);

    await service.getCodedVariablesForKappa(workspaceId, false, [11], [21], [31]);

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '(cj.job_definition_id IN (:...kappaJobDefinitionIds) OR cj.training_id IN (:...kappaCoderTrainingIds))'
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'cjc.user_id IN (:...kappaCoderIds)',
      { kappaCoderIds: [31] }
    );
    expect(queryBuilder.setParameter).toHaveBeenCalledWith('kappaJobDefinitionIds', [11]);
    expect(queryBuilder.setParameter).toHaveBeenCalledWith('kappaCoderTrainingIds', [21]);
  });

  it('returns an empty workspace kappa summary for a single selected coder', async () => {
    const getDoubleCodedVariablesForReviewSpy = jest.spyOn(
      service,
      'getDoubleCodedVariablesForReview'
    );

    const result = await service.getWorkspaceCohensKappaSummary(
      workspaceId,
      true,
      true,
      [],
      [],
      [31]
    );

    expect(getDoubleCodedVariablesForReviewSpy).not.toHaveBeenCalled();
    expect(result).toEqual({
      coderPairs: [],
      workspaceSummary: {
        totalDoubleCodedResponses: 0,
        totalCoderPairs: 0,
        averageKappa: null,
        variablesIncluded: 0,
        codersIncluded: 0,
        weightingMethod: 'weighted'
      }
    });
  });

  it('keeps workspace kappa summary pairs within the selected coder scope', async () => {
    const codingStatisticsService = {
      calculateCohensKappa: jest.fn().mockReturnValue([
        {
          coder1Id: 31,
          coder1Name: 'Coder 31',
          coder2Id: 32,
          coder2Name: 'Coder 32',
          kappa: 1,
          agreement: 1,
          totalSharedResponses: 1,
          validPairs: 1,
          interpretation: 'Sehr gut'
        }
      ])
    };
    service = new CodingReviewService(
      {} as never,
      codingJobUnitRepository as never,
      jobDefinitionRepository as never,
      variableBundleRepository as never,
      codingStatisticsService as never,
      {
        resolveExclusionsForQueries: jest.fn().mockResolvedValue(emptyExclusions)
      } as never
    );
    const getDoubleCodedVariablesForReviewSpy = jest
      .spyOn(service, 'getDoubleCodedVariablesForReview')
      .mockResolvedValueOnce({
        data: [
          {
            responseId: 10,
            unitName: 'UNIT_1',
            variableId: 'VAR_1',
            personLogin: 'person-1',
            personCode: 'P001',
            personGroup: 'GROUP_1',
            bookletName: 'BOOKLET_1',
            givenAnswer: 'answer',
            isResolved: false,
            coderResults: [
              {
                coderId: 31,
                coderName: 'Coder 31',
                jobId: 100,
                jobName: 'Job 31',
                jobDefinitionId: 11,
                trainingId: null,
                trainingLabel: null,
                code: 1,
                score: 1,
                notes: null,
                supervisorComment: null,
                codedAt: new Date('2026-05-18T00:00:00.000Z')
              },
              {
                coderId: 32,
                coderName: 'Coder 32',
                jobId: 101,
                jobName: 'Job 32',
                jobDefinitionId: 11,
                trainingId: null,
                trainingLabel: null,
                code: 1,
                score: 1,
                notes: null,
                supervisorComment: null,
                codedAt: new Date('2026-05-18T00:00:00.000Z')
              },
              {
                coderId: 33,
                coderName: 'Coder 33',
                jobId: 102,
                jobName: 'Job 33',
                jobDefinitionId: 11,
                trainingId: null,
                trainingLabel: null,
                code: 2,
                score: 1,
                notes: null,
                supervisorComment: null,
                codedAt: new Date('2026-05-18T00:00:00.000Z')
              }
            ]
          }
        ],
        total: 1,
        page: 1,
        limit: 1000
      });

    const result = await service.getWorkspaceCohensKappaSummary(
      workspaceId,
      true,
      true,
      [],
      [],
      [31, 32]
    );

    expect(getDoubleCodedVariablesForReviewSpy).toHaveBeenCalledWith(
      workspaceId,
      1,
      1000,
      false,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [],
      [],
      false
    );
    expect(codingStatisticsService.calculateCohensKappa).toHaveBeenCalledWith([
      expect.objectContaining({
        coder1Id: 31,
        coder2Id: 32,
        codes: [{ code1: 1, code2: 1 }]
      })
    ]);
    expect(result.workspaceSummary.codersIncluded).toBe(2);
  });
});
