import { DoubleCodingReviewDecisionService } from './double-coding-review-decision.service';

jest.mock('../workspace/workspace-exclusion.service', () => ({
  isExcludedByResolvedExclusions: jest.fn().mockReturnValue(false),
  WorkspaceExclusionService: jest.fn()
}));

describe('DoubleCodingReviewDecisionService', () => {
  const workspaceId = 123;
  const manager = { userId: 99, name: 'Reviewer' };
  const emptyExclusions = {
    globalIgnoredUnits: [],
    ignoredBooklets: [],
    testletIgnoredUnits: []
  };

  let codingJobService: {
    getCodingSchemeScoreForUnitCode: jest.Mock;
    getSelectableReviewCodeForUnit: jest.Mock;
  };
  let service: DoubleCodingReviewDecisionService;

  const makeCodingJobUnit = (
    overrides: Record<string, unknown> = {}
  ): Record<string, unknown> => ({
    id: 1,
    response_id: 10,
    variable_id: 'VAR_1',
    coding_job_id: 100,
    code: 1,
    coding_issue_option: null,
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
      id: 10,
      value: 'answer',
      code_v2: null,
      score_v2: null,
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

  const createDecisionService = (dependencies: {
    responseRepository?: unknown;
    codingStatisticsService?: unknown;
    codingAnalysisService?: unknown;
    codingValidationService?: unknown;
    codingProgressService?: unknown;
    workspaceExclusionService?: unknown;
    codingJobService?: unknown;
    missingsProfilesService?: unknown;
    reviewDecisionRepository?: unknown;
  } = {}): DoubleCodingReviewDecisionService => new DoubleCodingReviewDecisionService(
    (dependencies.responseRepository ?? {}) as never,
    (dependencies.codingStatisticsService ?? {}) as never,
    (dependencies.codingAnalysisService ?? {}) as never,
    (dependencies.codingValidationService ?? {}) as never,
    (dependencies.codingProgressService ?? {
      invalidateAppliedResultsOverviewCache: jest.fn()
    }) as never,
    (dependencies.workspaceExclusionService ?? {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue(emptyExclusions)
    }) as never,
    (dependencies.codingJobService ?? codingJobService) as never,
    (dependencies.missingsProfilesService ?? {
      getMissingByIdForProfileOrDefault: jest.fn()
    }) as never,
    (dependencies.reviewDecisionRepository ?? {}) as never
  );

  beforeEach(() => {
    codingJobService = {
      getCodingSchemeScoreForUnitCode: jest.fn().mockResolvedValue(1),
      getSelectableReviewCodeForUnit: jest.fn().mockImplementation(
        async (_unit, _workspaceId, code: number) => ({
          code,
          label: `Code ${code}`,
          score: 1
        })
      )
    };
    service = createDecisionService();
  });

  it('rejects resolution application without a valid manager', async () => {
    await expect(service.applyDoubleCodedResolutions(
      workspaceId,
      [],
      undefined as never
    )).rejects.toThrow('A valid manager is required');
  });

  it('applies an explicit replay code with the score derived from the coding scheme', async () => {
    codingJobService.getSelectableReviewCodeForUnit.mockResolvedValueOnce({
      code: 3,
      label: 'Code 3',
      score: 7
    });
    const response = {
      value: 'supervisor note\n\n--- ORIGINAL RESPONSE ---\noriginal answer',
      status_v2: null,
      code_v2: null,
      score_v2: null
    };
    const sourceUnit = makeCodingJobUnit({
      id: 77,
      response_id: 10,
      coding_job_id: 100,
      code: 1,
      score: 0,
      supervisor_comment: 'old comment',
      response
    });
    const clearCommentsQueryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([{ id: 77 }])
    };
    const managerDecisionRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(clearCommentsQueryBuilder),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((decision: Record<string, unknown>) => decision),
      save: jest.fn().mockResolvedValue(undefined)
    };
    const transactionalEntityManager = {
      findOne: jest.fn()
        .mockResolvedValueOnce(sourceUnit)
        .mockResolvedValueOnce(response),
      save: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      getRepository: jest.fn().mockReturnValue(managerDecisionRepository)
    };
    const responseRepository = {
      manager: {
        transaction: jest.fn(async (callback: (manager: typeof transactionalEntityManager) => Promise<void>) => (
          callback(transactionalEntityManager)
        ))
      }
    };
    const codingStatisticsService = {
      invalidateCache: jest.fn().mockResolvedValue(undefined)
    };
    const codingAnalysisService = {
      invalidateCache: jest.fn().mockResolvedValue(undefined)
    };
    const codingValidationService = {
      invalidateIncompleteVariablesCache: jest.fn().mockResolvedValue(undefined)
    };
    const codingProgressService = {
      invalidateAppliedResultsOverviewCache: jest.fn().mockResolvedValue(undefined)
    };
    const localService = createDecisionService({
      responseRepository,
      codingStatisticsService,
      codingAnalysisService,
      codingValidationService,
      codingProgressService,
      reviewDecisionRepository: managerDecisionRepository
    });

    const result = await localService.applyDoubleCodedResolutions(workspaceId, [{
      responseId: 10,
      sourceUnitId: 77,
      code: 3,
      score: 999,
      resolutionComment: 'Replay checked'
    }], manager);

    expect(transactionalEntityManager.findOne).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        where: expect.arrayContaining([
          expect.objectContaining({ id: 77, response_id: 10 })
        ]),
        relations: ['response', 'coding_job', 'coding_job.codingJobCoders']
      })
    );
    expect(codingJobService.getSelectableReviewCodeForUnit).toHaveBeenCalledWith(
      sourceUnit,
      workspaceId,
      3
    );
    expect(sourceUnit.supervisor_comment).toBe('Replay checked');
    expect(response.code_v2).toBe(3);
    expect(response.score_v2).toBe(7);
    expect(response.value).toBe('original answer');
    expect(transactionalEntityManager.update).toHaveBeenCalled();
    expect(transactionalEntityManager.save).toHaveBeenCalledWith(
      expect.any(Function),
      sourceUnit
    );
    expect(transactionalEntityManager.save).toHaveBeenCalledWith(
      expect.any(Function),
      response
    );
    expect(result).toMatchObject({
      success: true,
      appliedCount: 1,
      failedCount: 0,
      skippedCount: 0
    });
    expect(codingStatisticsService.invalidateCache).toHaveBeenCalledWith(workspaceId);
    expect(codingAnalysisService.invalidateCache).toHaveBeenCalledWith(workspaceId);
    expect(codingValidationService.invalidateIncompleteVariablesCache).toHaveBeenCalledWith(workspaceId);
    expect(codingProgressService.invalidateAppliedResultsOverviewCache).toHaveBeenCalledWith(workspaceId);
  });

  it('resolves general review selections through the coding job missing profile', async () => {
    const sourceUnit = makeCodingJobUnit({
      coding_job: {
        workspace_id: workspaceId,
        missings_profile_id: 77,
        job_definition_id: 11,
        training_id: null,
        name: 'Job A',
        codingJobCoders: []
      }
    });
    const missingsProfilesService = {
      getMissingByIdForProfileOrDefault: jest.fn().mockResolvedValue({
        id: 'mir',
        label: 'Missing invalid response',
        code: -98,
        score: 0
      })
    };
    const localService = createDecisionService({ missingsProfilesService });
    const harness = localService as unknown as {
      resolveReviewSelection: (
        selectedWorkspaceId: number,
        unit: unknown,
        code: number
      ) => Promise<{ code: number; score: number | null } | undefined>;
    };

    await expect(harness.resolveReviewSelection(workspaceId, sourceUnit, -3)).resolves.toEqual({
      code: -98,
      score: 0
    });
    expect(missingsProfilesService.getMissingByIdForProfileOrDefault)
      .toHaveBeenCalledWith(workspaceId, 77, 'mir');
  });

  it('persists the original general selection next to its profile-resolved code', async () => {
    const repository = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((decision: Record<string, unknown>) => decision),
      save: jest.fn().mockResolvedValue(undefined)
    };
    const entityManager = {
      getRepository: jest.fn().mockReturnValue(repository)
    };
    const localService = createDecisionService({
      workspaceExclusionService: {},
      reviewDecisionRepository: {}
    });
    const harness = localService as unknown as {
      persistAppliedManagerDecision: (
        entityManager: unknown,
        selectedWorkspaceId: number,
        responseId: number,
        managerData: { userId: number; name: string },
        selectionCode: number,
        code: number,
        score: number,
        comment: string | null
      ) => Promise<void>;
    };

    await harness.persistAppliedManagerDecision(
      entityManager,
      workspaceId,
      10,
      { userId: 99, name: 'Reviewer' },
      -3,
      -98,
      0,
      null
    );

    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      selected_code: -3,
      effective_code: -98,
      score: 0
    }));
  });

  it('rejects selected legacy job results that are no longer manually selectable', async () => {
    const selectedUnit = makeCodingJobUnit({ code: 999, score: 123 });
    const currentSourceUnit = makeCodingJobUnit({ id: 1501, code: 2, score: 1 });
    codingJobService.getSelectableReviewCodeForUnit.mockRejectedValueOnce(
      new Error('Code is not available for manual review')
    );
    const entityManager = {
      findOne: jest.fn().mockResolvedValue(selectedUnit)
    };
    const harness = service as unknown as {
      getReviewSourceUnit: jest.Mock;
      resolveSelectedCodingJobResolution: (
        entityManager: unknown,
        selectedWorkspaceId: number,
        decision: { responseId: number; sourceUnitId: number; selectedJobId: number }
      ) => Promise<unknown>;
    };
    harness.getReviewSourceUnit = jest.fn().mockResolvedValue(currentSourceUnit);

    await expect(harness.resolveSelectedCodingJobResolution(
      entityManager,
      workspaceId,
      { responseId: 10, sourceUnitId: 1501, selectedJobId: 100 }
    )).resolves.toBeNull();
    expect(harness.getReviewSourceUnit).toHaveBeenCalledWith(
      entityManager,
      workspaceId,
      10,
      1501
    );
    expect(codingJobService.getSelectableReviewCodeForUnit)
      .toHaveBeenCalledWith(currentSourceUnit, workspaceId, 999);
  });

  it('rejects selected coder results without the current review source', async () => {
    const entityManager = { findOne: jest.fn() };
    const harness = service as unknown as {
      resolveSelectedCodingJobResolution: (
        entityManager: unknown,
        selectedWorkspaceId: number,
        decision: { responseId: number; selectedJobId: number }
      ) => Promise<unknown>;
    };

    await expect(harness.resolveSelectedCodingJobResolution(
      entityManager,
      workspaceId,
      { responseId: 10, selectedJobId: 100 }
    )).resolves.toBeNull();
    expect(entityManager.findOne).not.toHaveBeenCalled();
  });

  it('rejects selected legacy job results without a final code', async () => {
    const sourceUnit = makeCodingJobUnit({ code: null, score: 1 });
    const entityManager = {
      findOne: jest.fn().mockResolvedValue(sourceUnit)
    };
    const harness = service as unknown as {
      resolveSelectedCodingJobResolution: (
        entityManager: unknown,
        selectedWorkspaceId: number,
        decision: { responseId: number; sourceUnitId: number; selectedJobId: number }
      ) => Promise<unknown>;
    };

    await expect(harness.resolveSelectedCodingJobResolution(
      entityManager,
      workspaceId,
      { responseId: 10, sourceUnitId: 1501, selectedJobId: 100 }
    )).resolves.toBeNull();
    expect(codingJobService.getSelectableReviewCodeForUnit).not.toHaveBeenCalled();
  });

  it('skips explicit replay decisions with codes unsupported by the coding scheme', async () => {
    const sourceUnit = makeCodingJobUnit({
      response_id: 10,
      coding_job_id: 100
    });
    const transactionalEntityManager = {
      findOne: jest.fn().mockResolvedValue(sourceUnit),
      save: jest.fn(),
      update: jest.fn(),
      getRepository: jest.fn()
    };
    const responseRepository = {
      manager: {
        transaction: jest.fn(async (callback: (manager: typeof transactionalEntityManager) => Promise<void>) => (
          callback(transactionalEntityManager)
        ))
      }
    };
    codingJobService.getSelectableReviewCodeForUnit.mockRejectedValueOnce(new Error('Unsupported code'));
    const localService = createDecisionService({ responseRepository });

    const result = await localService.applyDoubleCodedResolutions(workspaceId, [{
      responseId: 10,
      sourceUnitId: 1,
      code: 999,
      score: 1
    }], manager);

    expect(codingJobService.getSelectableReviewCodeForUnit).toHaveBeenCalledWith(
      sourceUnit,
      workspaceId,
      999
    );
    expect(transactionalEntityManager.save).not.toHaveBeenCalled();
    expect(transactionalEntityManager.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false,
      appliedCount: 0,
      failedCount: 0,
      skippedCount: 1
    });
  });

  it('never applies internal workflow marker codes from legacy job selections', async () => {
    const transactionalEntityManager = {
      findOne: jest.fn()
        .mockResolvedValueOnce(makeCodingJobUnit({ response_id: 10, code: -1 }))
        .mockResolvedValueOnce(makeCodingJobUnit({ response_id: 11, code: -2 }))
        .mockResolvedValueOnce(makeCodingJobUnit({
          response_id: 12,
          code: 7,
          coding_issue_option: -1
        }))
        .mockResolvedValueOnce(makeCodingJobUnit({
          response_id: 13,
          code: 7,
          coding_issue_option: -2
        })),
      save: jest.fn(),
      update: jest.fn(),
      getRepository: jest.fn()
    };
    const responseRepository = {
      manager: {
        transaction: jest.fn(async (callback: (manager: typeof transactionalEntityManager) => Promise<void>) => (
          callback(transactionalEntityManager)
        ))
      }
    };
    const localService = createDecisionService({ responseRepository });

    const result = await localService.applyDoubleCodedResolutions(workspaceId, [
      { responseId: 10, sourceUnitId: 1501, selectedJobId: 100 },
      { responseId: 11, sourceUnitId: 1502, selectedJobId: 101 },
      { responseId: 12, sourceUnitId: 1503, selectedJobId: 102 },
      { responseId: 13, sourceUnitId: 1504, selectedJobId: 103 }
    ], manager);

    expect(transactionalEntityManager.save).not.toHaveBeenCalled();
    expect(transactionalEntityManager.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false,
      appliedCount: 0,
      failedCount: 0,
      skippedCount: 4
    });
  });

  it('upserts a shared manager draft with a server-derived score', async () => {
    const response = {
      id: 10,
      value: 'answer',
      status_v2: null,
      code_v2: null,
      score_v2: null
    };
    const sourceUnit = makeCodingJobUnit({ id: 77, response_id: 10, response });
    codingJobService.getSelectableReviewCodeForUnit.mockResolvedValueOnce({
      code: 3,
      label: 'Code 3',
      score: 4
    });
    const savedDecision = {
      id: 51,
      workspace_id: workspaceId,
      response_id: 10,
      manager_user_id: 99,
      manager_key: '99',
      manager_name: 'Reviewer',
      state: 'draft',
      effective_code: 3,
      selected_code: 3,
      score: 4,
      comment: 'Check this',
      created_at: new Date('2026-05-20T12:00:00.000Z'),
      updated_at: new Date('2026-05-20T12:01:00.000Z'),
      finalized_at: null
    };
    const reviewDecisionRepository = {
      upsert: jest.fn().mockResolvedValue(undefined),
      findOneOrFail: jest.fn().mockResolvedValue(savedDecision)
    };
    const transactionalEntityManager = {
      findOne: jest.fn()
        .mockResolvedValueOnce(sourceUnit)
        .mockResolvedValueOnce(response),
      getRepository: jest.fn().mockReturnValue(reviewDecisionRepository)
    };
    const responseRepository = {
      manager: {
        transaction: jest.fn(async (callback: (manager: typeof transactionalEntityManager) => Promise<unknown>) => (
          callback(transactionalEntityManager)
        ))
      }
    };
    const localService = createDecisionService({
      responseRepository,
      reviewDecisionRepository
    });

    const result = await localService.saveDoubleCodedReviewDraft(
      workspaceId,
      10,
      99,
      'Reviewer',
      {
        sourceUnitId: 77, code: 3, score: 999, comment: ' Check this '
      }
    );

    expect(transactionalEntityManager.findOne).toHaveBeenNthCalledWith(
      1,
      expect.any(Function),
      expect.objectContaining({
        where: expect.arrayContaining([
          expect.objectContaining({ id: 77, response_id: 10 })
        ]),
        relations: ['response', 'coding_job', 'coding_job.codingJobCoders']
      })
    );
    expect(codingJobService.getSelectableReviewCodeForUnit).toHaveBeenCalledWith(sourceUnit, workspaceId, 3);
    expect(transactionalEntityManager.findOne).toHaveBeenLastCalledWith(
      expect.any(Function),
      expect.objectContaining({
        where: { id: response.id },
        lock: { mode: 'pessimistic_write' }
      })
    );
    expect(reviewDecisionRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: workspaceId,
        response_id: 10,
        manager_user_id: 99,
        manager_key: '99',
        state: 'draft',
        effective_code: 3,
        selected_code: 3,
        score: 4,
        comment: 'Check this'
      }),
      expect.objectContaining({
        conflictPaths: ['workspace_id', 'response_id', 'manager_user_id']
      })
    );
    expect(result).toMatchObject({
      id: 51,
      responseId: 10,
      managerUserId: 99,
      managerKey: '99',
      managerName: 'Reviewer',
      state: 'draft',
      effectiveCode: 3,
      selectedCode: 3,
      score: 4,
      comment: 'Check this',
      createdAt: '2026-05-20T12:00:00.000Z',
      updatedAt: '2026-05-20T12:01:00.000Z',
      finalizedAt: null
    });
  });

  it('skips explicit replay decisions with invalid code or score values', async () => {
    const transactionalEntityManager = {
      findOne: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      getRepository: jest.fn()
    };
    const responseRepository = {
      manager: {
        transaction: jest.fn(async (callback: (manager: typeof transactionalEntityManager) => Promise<void>) => (
          callback(transactionalEntityManager)
        ))
      }
    };
    const localService = createDecisionService({ responseRepository });

    const result = await localService.applyDoubleCodedResolutions(workspaceId, [
      { responseId: 10, code: '' },
      { responseId: 11, code: 1, score: ' ' },
      { responseId: 12, code: true },
      { responseId: 13, code: 1, score: [2] },
      { responseId: 14, selectedJobId: true }
    ] as never, manager);

    expect(transactionalEntityManager.findOne).not.toHaveBeenCalled();
    expect(transactionalEntityManager.save).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false,
      appliedCount: 0,
      failedCount: 0,
      skippedCount: 5
    });
  });
});
