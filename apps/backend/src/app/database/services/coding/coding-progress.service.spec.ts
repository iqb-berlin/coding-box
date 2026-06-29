import { Brackets } from 'typeorm';
import { CodingProgressService } from './coding-progress.service';
import { getManualCodingScopeKey } from '../../utils/manual-coding-scope.util';
import { statusStringToNumber } from '../../utils/response-status-converter';

jest.mock('../workspace/workspace-files.service', () => ({
  WorkspaceFilesService: class {}
}));

const createRepository = () => ({
  createQueryBuilder: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  query: jest.fn().mockResolvedValue([])
});

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

type MockQueryBuilder = Record<string, jest.Mock> & {
  subQueryProbes: Record<string, jest.Mock>[];
};

const createSubQueryProbe = (queryBuilder: MockQueryBuilder) => {
  const subQueryBuilder: Record<string, jest.Mock> = {};
  [
    'select',
    'from',
    'innerJoin',
    'where',
    'andWhere'
  ].forEach(method => {
    subQueryBuilder[method] = jest.fn().mockReturnValue(subQueryBuilder);
  });
  subQueryBuilder.getQuery = jest.fn().mockReturnValue('SELECT 1');
  queryBuilder.subQueryProbes.push(subQueryBuilder);
  return subQueryBuilder;
};

const executeBrackets = (condition: unknown, queryBuilder: MockQueryBuilder) => {
  if (!(condition instanceof Brackets)) {
    return;
  }

  const bracketBuilder: Record<string, jest.Mock> = {};
  bracketBuilder.where = jest.fn().mockReturnValue(bracketBuilder);
  bracketBuilder.orWhere = jest.fn((conditionOrCallback: string | ((builder: { subQuery: jest.Mock }) => string)) => {
    if (typeof conditionOrCallback === 'function') {
      conditionOrCallback({
        subQuery: jest.fn().mockReturnValue(createSubQueryProbe(queryBuilder))
      });
    }
    return bracketBuilder;
  });
  condition.whereFactory(bracketBuilder as never);
};

const createQueryBuilder = (rawResults: unknown[] = []) => {
  const queryBuilder: MockQueryBuilder = {
    subQueryProbes: []
  } as MockQueryBuilder;
  [
    'select',
    'addSelect',
    'innerJoin',
    'leftJoin',
    'where',
    'andWhere',
    'groupBy',
    'addGroupBy',
    'orderBy'
  ].forEach(method => {
    queryBuilder[method] = jest.fn((condition?: unknown) => {
      if (method === 'leftJoin' && typeof condition === 'function') {
        condition(createSubQueryProbe(queryBuilder));
      }
      executeBrackets(condition, queryBuilder);
      return queryBuilder;
    });
  });
  queryBuilder.getRawMany = jest.fn().mockResolvedValue(rawResults);
  queryBuilder.getRawOne = jest.fn().mockResolvedValue({
    count: rawResults.length.toString()
  });
  queryBuilder.getCount = jest.fn().mockResolvedValue(0);
  return queryBuilder;
};

const expectProductiveManualPoolExists = (queryBuilder: MockQueryBuilder) => {
  const assignedResponsesBuilder = queryBuilder.subQueryProbes.find(
    probe => probe.select.mock.calls.some(
      call => call[0] === 'DISTINCT manual_cju.response_id'
    )
  );
  expect(assignedResponsesBuilder).toBeDefined();
  expect(assignedResponsesBuilder.select).toHaveBeenCalledWith(
    'DISTINCT manual_cju.response_id',
    'response_id'
  );
  expect(assignedResponsesBuilder.from).toHaveBeenCalledWith(
    'coding_job_unit',
    'manual_cju'
  );
  expect(assignedResponsesBuilder.innerJoin).toHaveBeenCalledWith(
    'coding_job',
    'manual_cj',
    'manual_cj.id = manual_cju.coding_job_id'
  );
  expect(assignedResponsesBuilder.where).toHaveBeenCalledWith(
    'manual_cj.training_id IS NULL'
  );
  expect(assignedResponsesBuilder.andWhere).toHaveBeenCalledWith(
    expect.stringContaining('coding_issue_review')
  );
};

describe('CodingProgressService variable coverage conflicts', () => {
  let responseRepository: ReturnType<typeof createRepository>;
  let codingJobUnitRepository: ReturnType<typeof createRepository>;
  let jobDefinitionRepository: ReturnType<typeof createRepository>;
  let variableBundleRepository: ReturnType<typeof createRepository>;
  let settingRepository: ReturnType<typeof createRepository>;
  let workspaceFilesService: {
    getUnitVariableMap: jest.Mock;
    getDerivedVariableMap: jest.Mock;
    getDerivedVariablesBySourceMap: jest.Mock;
    getManualInstructionVariableMap: jest.Mock;
  };
  let service: CodingProgressService;

  const mockCoverageResponseCounts = (...counts: number[]) => {
    responseRepository.query.mockImplementation((sql: string) => {
      if (sql.includes('SELECT COUNT(response.id) AS count')) {
        return Promise.resolve([{ count: String(counts.shift() ?? 0) }]);
      }
      return Promise.resolve([]);
    });
  };

  beforeEach(() => {
    responseRepository = createRepository();
    codingJobUnitRepository = createRepository();
    jobDefinitionRepository = createRepository();
    variableBundleRepository = createRepository();
    settingRepository = createRepository();
    settingRepository.findOne.mockResolvedValue({ content: 'disabled' });

    workspaceFilesService = {
      getUnitVariableMap: jest.fn().mockResolvedValue(new Map()),
      getDerivedVariableMap: jest.fn().mockResolvedValue(new Map()),
      getDerivedVariablesBySourceMap: jest.fn().mockResolvedValue(new Map()),
      getManualInstructionVariableMap: jest.fn().mockResolvedValue(new Map())
    };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };

    service = new CodingProgressService(
      responseRepository as never,
      codingJobUnitRepository as never,
      jobDefinitionRepository as never,
      variableBundleRepository as never,
      settingRepository as never,
      workspaceFilesService as never,
      workspaceExclusionService as never
    );
  });

  it('keeps covered source responses in status totals but excludes them from progress totals', async () => {
    const codingIncompleteStatus = statusStringToNumber('CODING_INCOMPLETE');
    const intendedIncompleteStatus = statusStringToNumber('INTENDED_INCOMPLETE');
    mockCoverageResponseCounts(3);

    responseRepository.createQueryBuilder.mockReturnValue(createQueryBuilder([
      {
        responseId: '100',
        unitName: 'UnitA',
        variableId: 'derived-var',
        value: 'derived value',
        codeV2: null,
        statusV2: null,
        statusV1: String(codingIncompleteStatus)
      },
      {
        responseId: '101',
        unitName: 'UnitA',
        variableId: 'base-var',
        value: 'base value',
        codeV2: null,
        statusV2: null,
        statusV1: String(intendedIncompleteStatus)
      },
      {
        responseId: '102',
        unitName: 'UnitA',
        variableId: 'standalone-var',
        value: 'standalone value',
        codeV2: null,
        statusV2: null,
        statusV1: String(intendedIncompleteStatus)
      }
    ]));
    codingJobUnitRepository.createQueryBuilder.mockReturnValue(createQueryBuilder([
      { responseId: '100' },
      { responseId: '101' },
      { responseId: '102' }
    ]));
    settingRepository.findOne.mockResolvedValue({ content: 'disabled' });
    workspaceFilesService.getDerivedVariablesBySourceMap.mockResolvedValue(new Map([
      [getManualCodingScopeKey('UnitA', 'base-var'), new Set(['derived-var'])]
    ]));
    workspaceFilesService.getUnitVariableMap.mockResolvedValue(new Map([
      ['UNITA', new Set(['derived-var', 'base-var', 'standalone-var'])]
    ]));
    workspaceFilesService.getManualInstructionVariableMap.mockResolvedValue(new Map([
      ['UNITA', new Set(['base-var', 'standalone-var'])]
    ]));

    const result = await service.getCodingProgressOverview(5);

    expect(result).toMatchObject({
      rawTotalCasesToCode: 2,
      rawCompletedCases: 2,
      totalCasesToCode: 2,
      completedCases: 2,
      statusTotalCasesToCode: 3,
      coveredSourceVariableCount: 1,
      coveredSourceResponseCount: 1
    });
  });

  it('does not let unassigned pre-coded derived responses cover source responses in manual totals', async () => {
    const codingIncompleteStatus = statusStringToNumber('CODING_INCOMPLETE');
    const intendedIncompleteStatus = statusStringToNumber('INTENDED_INCOMPLETE');
    mockCoverageResponseCounts(3, 3);
    const allResponses = [
      {
        responseId: '100',
        unitName: 'UnitA',
        variableId: 'derived-var',
        value: 'derived value',
        codeV2: '1',
        statusV2: null,
        statusV1: String(codingIncompleteStatus)
      },
      {
        responseId: '101',
        unitName: 'UnitA',
        variableId: 'base-var',
        value: 'base value',
        codeV2: null,
        statusV2: null,
        statusV1: String(intendedIncompleteStatus)
      },
      {
        responseId: '102',
        unitName: 'UnitA',
        variableId: 'standalone-var',
        value: 'standalone value',
        codeV2: null,
        statusV2: null,
        statusV1: String(intendedIncompleteStatus)
      }
    ];
    const manualPoolResponses = allResponses.slice(1);

    responseRepository.createQueryBuilder
      .mockReturnValueOnce(createQueryBuilder(manualPoolResponses))
      .mockReturnValueOnce(createQueryBuilder(manualPoolResponses));
    codingJobUnitRepository.createQueryBuilder
      .mockReturnValueOnce(createQueryBuilder([]))
      .mockReturnValueOnce(createQueryBuilder([]))
      .mockReturnValueOnce(createQueryBuilder([]));
    settingRepository.findOne.mockResolvedValue({ content: 'disabled' });
    workspaceFilesService.getDerivedVariablesBySourceMap.mockResolvedValue(new Map([
      [getManualCodingScopeKey('UnitA', 'base-var'), new Set(['derived-var'])]
    ]));
    workspaceFilesService.getUnitVariableMap.mockResolvedValue(new Map([
      ['UNITA', new Set(['derived-var', 'base-var', 'standalone-var'])]
    ]));
    workspaceFilesService.getManualInstructionVariableMap.mockResolvedValue(new Map([
      ['UNITA', new Set(['base-var', 'standalone-var'])]
    ]));

    const progress = await service.getCodingProgressOverview(5);
    const coverage = await service.getCaseCoverageOverview(5);

    expect(progress).toMatchObject({
      rawTotalCasesToCode: 2,
      rawCompletedCases: 0,
      totalCasesToCode: 2,
      completedCases: 0,
      statusTotalCasesToCode: 3,
      coveredSourceVariableCount: 0,
      coveredSourceResponseCount: 0
    });
    expect(coverage).toMatchObject({
      totalCasesToCode: 2,
      effectiveTotalCasesToCode: 2,
      casesInJobs: 0,
      effectiveCasesInJobs: 0,
      unassignedCases: 2,
      effectiveUnassignedCases: 2,
      statusTotalCasesToCode: 3,
      coveredSourceVariableCount: 0,
      coveredSourceResponseCount: 0
    });
  });

  it('includes DERIVE_ERROR manual job units in applied result progress', async () => {
    const codingIncompleteStatus = statusStringToNumber('CODING_INCOMPLETE');
    const deriveErrorStatus = statusStringToNumber('DERIVE_ERROR');
    const codingCompleteStatus = statusStringToNumber('CODING_COMPLETE');
    mockCoverageResponseCounts(2);
    const responses = [
      {
        responseId: '100',
        unitName: 'UnitA',
        variableId: 'standard-var',
        value: 'standard value',
        codeV2: null,
        statusV2: null,
        statusV1: String(codingIncompleteStatus)
      },
      {
        responseId: '101',
        unitName: 'UnitA',
        variableId: 'derived-error-var',
        value: 'derive error value',
        codeV2: '2',
        statusV2: String(codingCompleteStatus),
        statusV1: String(deriveErrorStatus)
      }
    ];

    responseRepository.createQueryBuilder
      .mockReturnValueOnce(createQueryBuilder(responses));
    settingRepository.findOne.mockResolvedValue({ content: 'disabled' });
    workspaceFilesService.getUnitVariableMap.mockResolvedValue(new Map([
      ['UNITA', new Set(['standard-var', 'derived-error-var'])]
    ]));

    const result = await service.getAppliedResultsOverview(5);

    expect(result).toMatchObject({
      rawTotalIncompleteResponses: 2,
      rawAppliedResponses: 1,
      totalIncompleteResponses: 2,
      appliedResponses: 1,
      remainingResponses: 1,
      deriveErrorRawTotalResponses: 1,
      deriveErrorRawAppliedResponses: 1,
      deriveErrorTotalResponses: 1,
      deriveErrorAppliedResponses: 1,
      deriveErrorRemainingResponses: 0
    });
  });

  it('returns cached applied result overview by test results revision', async () => {
    const cachedOverview = {
      totalIncompleteResponses: 2,
      appliedResponses: 1,
      remainingResponses: 1,
      completionPercentage: 50,
      rawTotalIncompleteResponses: 2,
      rawAppliedResponses: 1,
      rawCompletionPercentage: 50,
      aggregationActive: false,
      aggregationThreshold: null,
      aggregatedDuplicateCases: 0,
      statusTotalIncompleteResponses: 2,
      coveredSourceVariableCount: 0,
      coveredSourceResponseCount: 0,
      deriveErrorTotalResponses: 0,
      deriveErrorAppliedResponses: 0,
      deriveErrorRemainingResponses: 0,
      deriveErrorRawTotalResponses: 0,
      deriveErrorRawAppliedResponses: 0
    };
    const cacheService = {
      get: jest.fn().mockResolvedValue(cachedOverview),
      set: jest.fn(),
      getNumber: jest.fn().mockResolvedValue(3),
      incr: jest.fn(),
      deleteByPattern: jest.fn()
    };
    responseRepository.query.mockResolvedValue([{ revision: 9 }]);
    const cachedService = new CodingProgressService(
      responseRepository as never,
      codingJobUnitRepository as never,
      jobDefinitionRepository as never,
      variableBundleRepository as never,
      settingRepository as never,
      workspaceFilesService as never,
      { resolveExclusionsForQueries: jest.fn() } as never,
      undefined,
      cacheService as never
    );

    const result = await cachedService.getAppliedResultsOverview(5);

    expect(result).toBe(cachedOverview);
    expect(cacheService.get).toHaveBeenCalledWith(
      'coding_applied_results_overview:5:r9:c3'
    );
    expect(responseRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('reuses an in-flight applied result overview query for the same revision', async () => {
    const overview = {
      totalIncompleteResponses: 1,
      appliedResponses: 0,
      remainingResponses: 1,
      completionPercentage: 0,
      rawTotalIncompleteResponses: 1,
      rawAppliedResponses: 0,
      rawCompletionPercentage: 0,
      aggregationActive: false,
      aggregationThreshold: null,
      aggregatedDuplicateCases: 0,
      statusTotalIncompleteResponses: 1,
      coveredSourceVariableCount: 0,
      coveredSourceResponseCount: 0,
      deriveErrorTotalResponses: 0,
      deriveErrorAppliedResponses: 0,
      deriveErrorRemainingResponses: 0,
      deriveErrorRawTotalResponses: 0,
      deriveErrorRawAppliedResponses: 0
    };
    const overviewDeferred = createDeferred<typeof overview>();
    const cacheService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
      getNumber: jest.fn().mockResolvedValue(4),
      incr: jest.fn(),
      deleteByPattern: jest.fn()
    };
    responseRepository.query.mockResolvedValue([{ revision: 10 }]);
    const cachedService = new CodingProgressService(
      responseRepository as never,
      codingJobUnitRepository as never,
      jobDefinitionRepository as never,
      variableBundleRepository as never,
      settingRepository as never,
      workspaceFilesService as never,
      { resolveExclusionsForQueries: jest.fn() } as never,
      undefined,
      cacheService as never
    );
    const internals = cachedService as unknown as {
      computeAndCacheAppliedResultsOverview: (
        workspaceId: number,
        testResultsRevision: number,
        codingRevision: number,
        cacheKey: string
      ) => Promise<typeof overview>;
    };
    const computeSpy = jest
      .spyOn(internals, 'computeAndCacheAppliedResultsOverview')
      .mockReturnValue(overviewDeferred.promise);

    const firstRequest = cachedService.getAppliedResultsOverview(5);
    const secondRequest = cachedService.getAppliedResultsOverview(5);
    await new Promise(resolve => {
      setImmediate(resolve);
    });

    expect(computeSpy).toHaveBeenCalledTimes(1);
    expect(computeSpy).toHaveBeenCalledWith(
      5,
      10,
      4,
      'coding_applied_results_overview:5:r10:c4'
    );

    overviewDeferred.resolve(overview);
    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual(
      [overview, overview]
    );
  });

  it('does not cache stale applied result overview when revision changes while computing', async () => {
    const overview = {
      totalIncompleteResponses: 1,
      appliedResponses: 1,
      remainingResponses: 0,
      completionPercentage: 100,
      rawTotalIncompleteResponses: 1,
      rawAppliedResponses: 1,
      rawCompletionPercentage: 100,
      aggregationActive: false,
      aggregationThreshold: null,
      aggregatedDuplicateCases: 0,
      statusTotalIncompleteResponses: 1,
      coveredSourceVariableCount: 0,
      coveredSourceResponseCount: 0,
      deriveErrorTotalResponses: 0,
      deriveErrorAppliedResponses: 0,
      deriveErrorRemainingResponses: 0,
      deriveErrorRawTotalResponses: 0,
      deriveErrorRawAppliedResponses: 0
    };
    const cacheService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
      getNumber: jest.fn().mockResolvedValue(0),
      incr: jest.fn(),
      deleteByPattern: jest.fn()
    };
    responseRepository.query
      .mockResolvedValueOnce([{ revision: 11 }])
      .mockResolvedValueOnce([{ revision: 12 }]);
    const cachedService = new CodingProgressService(
      responseRepository as never,
      codingJobUnitRepository as never,
      jobDefinitionRepository as never,
      variableBundleRepository as never,
      settingRepository as never,
      workspaceFilesService as never,
      { resolveExclusionsForQueries: jest.fn() } as never,
      undefined,
      cacheService as never
    );
    const internals = cachedService as unknown as {
      computeAppliedResultsOverview: (
        workspaceId: number
      ) => Promise<typeof overview>;
    };
    jest
      .spyOn(internals, 'computeAppliedResultsOverview')
      .mockResolvedValue(overview);

    await cachedService.getAppliedResultsOverview(5);

    expect(cacheService.set).not.toHaveBeenCalledWith(
      'coding_applied_results_overview:5:r11:c0',
      expect.anything(),
      0
    );
  });

  it('does not cache stale applied result overview when coding revision changes while computing', async () => {
    const overview = {
      totalIncompleteResponses: 1,
      appliedResponses: 1,
      remainingResponses: 0,
      completionPercentage: 100,
      rawTotalIncompleteResponses: 1,
      rawAppliedResponses: 1,
      rawCompletionPercentage: 100,
      aggregationActive: false,
      aggregationThreshold: null,
      aggregatedDuplicateCases: 0,
      statusTotalIncompleteResponses: 1,
      coveredSourceVariableCount: 0,
      coveredSourceResponseCount: 0,
      deriveErrorTotalResponses: 0,
      deriveErrorAppliedResponses: 0,
      deriveErrorRemainingResponses: 0,
      deriveErrorRawTotalResponses: 0,
      deriveErrorRawAppliedResponses: 0
    };
    const cacheService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
      getNumber: jest.fn()
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(3),
      incr: jest.fn(),
      deleteByPattern: jest.fn()
    };
    responseRepository.query.mockResolvedValue([{ revision: 11 }]);
    const cachedService = new CodingProgressService(
      responseRepository as never,
      codingJobUnitRepository as never,
      jobDefinitionRepository as never,
      variableBundleRepository as never,
      settingRepository as never,
      workspaceFilesService as never,
      { resolveExclusionsForQueries: jest.fn() } as never,
      undefined,
      cacheService as never
    );
    const internals = cachedService as unknown as {
      computeAppliedResultsOverview: (
        workspaceId: number
      ) => Promise<typeof overview>;
    };
    jest
      .spyOn(internals, 'computeAppliedResultsOverview')
      .mockResolvedValue(overview);

    await cachedService.getAppliedResultsOverview(5);

    expect(cacheService.set).not.toHaveBeenCalledWith(
      'coding_applied_results_overview:5:r11:c2',
      expect.anything(),
      0
    );
  });

  it('invalidates applied result overview keys and bumps the coding revision', async () => {
    const cacheService = {
      get: jest.fn(),
      set: jest.fn(),
      getNumber: jest.fn(),
      incr: jest.fn().mockResolvedValue(8),
      deleteByPattern: jest.fn().mockResolvedValue(undefined)
    };
    const cachedService = new CodingProgressService(
      responseRepository as never,
      codingJobUnitRepository as never,
      jobDefinitionRepository as never,
      variableBundleRepository as never,
      settingRepository as never,
      workspaceFilesService as never,
      { resolveExclusionsForQueries: jest.fn() } as never,
      undefined,
      cacheService as never
    );

    await cachedService.invalidateAppliedResultsOverviewCache(5);

    expect(cacheService.incr).toHaveBeenCalledWith(
      'coding_applied_results_overview:version:5'
    );
    expect(cacheService.deleteByPattern).toHaveBeenCalledWith(
      'coding_applied_results_overview:5:*'
    );
  });

  it('limits manual pool existence checks to non-training coding jobs', async () => {
    mockCoverageResponseCounts(0);
    const responseQueries: MockQueryBuilder[] = [];
    responseRepository.createQueryBuilder.mockImplementation(() => {
      const query = createQueryBuilder([]);
      responseQueries.push(query);
      return query;
    });
    codingJobUnitRepository.createQueryBuilder.mockReturnValue(createQueryBuilder([]));
    settingRepository.findOne.mockResolvedValue({ content: 'disabled' });
    jobDefinitionRepository.find.mockResolvedValue([]);

    await service.getCodingProgressOverview(5);
    await service.getVariableCoverageOverview(5);

    const manualPoolQueries = responseQueries.filter(query => query.subQueryProbes.some(probe => probe.select.mock.calls.some(
      call => call[0] === 'DISTINCT manual_cju.response_id'
    )));
    expect(manualPoolQueries.length).toBeGreaterThanOrEqual(1);
    manualPoolQueries.forEach(expectProductiveManualPoolExists);
  });

  it('excludes covered source responses from case coverage while preserving status totals', async () => {
    const codingIncompleteStatus = statusStringToNumber('CODING_INCOMPLETE');
    const intendedIncompleteStatus = statusStringToNumber('INTENDED_INCOMPLETE');
    mockCoverageResponseCounts(3);

    responseRepository.createQueryBuilder.mockReturnValue(createQueryBuilder([
      {
        responseId: '100',
        unitName: 'UnitA',
        variableId: 'derived-var',
        value: 'derived value',
        codeV2: null,
        statusV2: null,
        statusV1: String(codingIncompleteStatus)
      },
      {
        responseId: '101',
        unitName: 'UnitA',
        variableId: 'base-var',
        value: 'base value',
        codeV2: null,
        statusV2: null,
        statusV1: String(intendedIncompleteStatus)
      },
      {
        responseId: '102',
        unitName: 'UnitA',
        variableId: 'standalone-var',
        value: 'standalone value',
        codeV2: null,
        statusV2: null,
        statusV1: String(intendedIncompleteStatus)
      }
    ]));
    codingJobUnitRepository.createQueryBuilder
      .mockReturnValueOnce(createQueryBuilder([
        { responseId: '100' },
        { responseId: '101' },
        { responseId: '102' }
      ]))
      .mockReturnValueOnce(createQueryBuilder([
        { responseId: '100' },
        { responseId: '101' },
        { responseId: '102' }
      ]));
    settingRepository.findOne.mockResolvedValue({ content: 'disabled' });
    workspaceFilesService.getDerivedVariablesBySourceMap.mockResolvedValue(new Map([
      [getManualCodingScopeKey('UnitA', 'base-var'), new Set(['derived-var'])]
    ]));
    workspaceFilesService.getUnitVariableMap.mockResolvedValue(new Map([
      ['UNITA', new Set(['derived-var', 'base-var', 'standalone-var'])]
    ]));
    workspaceFilesService.getManualInstructionVariableMap.mockResolvedValue(new Map([
      ['UNITA', new Set(['base-var', 'standalone-var'])]
    ]));

    const result = await service.getCaseCoverageOverview(5);

    expect(result).toMatchObject({
      totalCasesToCode: 2,
      effectiveTotalCasesToCode: 2,
      casesInJobs: 2,
      effectiveCasesInJobs: 2,
      unassignedCases: 0,
      statusTotalCasesToCode: 3,
      coveredSourceVariableCount: 1,
      coveredSourceResponseCount: 1
    });
  });

  it('excludes covered source variables from variable coverage and reports the status-scope delta', async () => {
    const codingIncompleteStatus = statusStringToNumber('CODING_INCOMPLETE');
    const intendedIncompleteStatus = statusStringToNumber('INTENDED_INCOMPLETE');

    responseRepository.createQueryBuilder.mockReturnValue(createQueryBuilder([
      {
        unitName: 'UnitA',
        variableId: 'derived-var',
        statusV1: String(codingIncompleteStatus),
        caseCount: '2'
      },
      {
        unitName: 'UnitA',
        variableId: 'base-var',
        statusV1: String(intendedIncompleteStatus),
        caseCount: '2'
      },
      {
        unitName: 'UnitA',
        variableId: 'standalone-var',
        statusV1: String(intendedIncompleteStatus),
        caseCount: '1'
      }
    ]));
    jobDefinitionRepository.find.mockResolvedValue([
      {
        id: 20,
        status: 'approved',
        assigned_variables: [
          { unitName: 'UnitA', variableId: 'derived-var' },
          { unitName: 'UnitA', variableId: 'standalone-var' }
        ]
      }
    ]);
    codingJobUnitRepository.createQueryBuilder
      .mockReturnValueOnce(createQueryBuilder([
        { unitName: 'UnitA', variableId: 'derived-var', casesInJobs: '2' },
        { unitName: 'UnitA', variableId: 'base-var', casesInJobs: '2' },
        { unitName: 'UnitA', variableId: 'standalone-var', casesInJobs: '1' }
      ]))
      .mockReturnValueOnce(createQueryBuilder([]));
    workspaceFilesService.getDerivedVariablesBySourceMap.mockResolvedValue(new Map([
      [getManualCodingScopeKey('UnitA', 'base-var'), new Set(['derived-var'])]
    ]));
    workspaceFilesService.getUnitVariableMap.mockResolvedValue(new Map([
      ['UNITA', new Set(['derived-var', 'base-var', 'standalone-var'])]
    ]));
    workspaceFilesService.getManualInstructionVariableMap.mockResolvedValue(new Map([
      ['UNITA', new Set(['base-var', 'standalone-var'])]
    ]));

    const result = await service.getVariableCoverageOverview(5);

    expect(result).toMatchObject({
      totalVariables: 2,
      coveredVariables: 2,
      coveredByApproved: 2,
      missingVariables: 0,
      fullyAbgedeckteVariablen: 2,
      statusTotalVariables: 3,
      coveredSourceVariableCount: 1,
      coveredSourceResponseCount: 2
    });
    expect(result.variableCaseCounts).toEqual([
      { unitName: 'UnitA', variableId: 'derived-var', caseCount: 2 },
      { unitName: 'UnitA', variableId: 'standalone-var', caseCount: 1 }
    ]);
  });

  it('excludes intended-incomplete variables without manual instructions from variable coverage', async () => {
    const codingIncompleteStatus = statusStringToNumber('CODING_INCOMPLETE');
    const intendedIncompleteStatus = statusStringToNumber('INTENDED_INCOMPLETE');

    responseRepository.createQueryBuilder.mockReturnValue(createQueryBuilder([
      {
        unitName: 'UnitA',
        variableId: 'manual-var',
        statusV1: String(codingIncompleteStatus),
        caseCount: '3'
      },
      {
        unitName: 'UnitA',
        variableId: 'auto-intended-var',
        statusV1: String(intendedIncompleteStatus),
        caseCount: '5'
      }
    ]));
    workspaceFilesService.getUnitVariableMap.mockResolvedValue(new Map([
      ['UNITA', new Set(['manual-var', 'auto-intended-var'])]
    ]));
    workspaceFilesService.getManualInstructionVariableMap.mockResolvedValue(new Map());
    jobDefinitionRepository.find.mockResolvedValue([]);
    codingJobUnitRepository.createQueryBuilder
      .mockReturnValueOnce(createQueryBuilder([]))
      .mockReturnValueOnce(createQueryBuilder([]));

    const result = await service.getVariableCoverageOverview(5);

    expect(result.totalVariables).toBe(1);
    expect(result.missingVariables).toBe(1);
    expect(result.variableCaseCounts).toEqual([
      { unitName: 'UnitA', variableId: 'manual-var', caseCount: 3 }
    ]);
  });

  it('excludes intended-incomplete variables without manual instructions from case coverage', async () => {
    const codingIncompleteStatus = statusStringToNumber('CODING_INCOMPLETE');
    const intendedIncompleteStatus = statusStringToNumber('INTENDED_INCOMPLETE');
    mockCoverageResponseCounts(2);
    const responses = [
      {
        responseId: '100',
        unitName: 'UnitA',
        variableId: 'manual-var',
        value: 'manual value',
        codeV2: null,
        statusV2: null,
        statusV1: String(codingIncompleteStatus)
      },
      {
        responseId: '101',
        unitName: 'UnitA',
        variableId: 'auto-intended-var',
        value: 'auto intended value',
        codeV2: null,
        statusV2: null,
        statusV1: String(intendedIncompleteStatus)
      }
    ];

    responseRepository.createQueryBuilder
      .mockReturnValueOnce(createQueryBuilder(responses));
    codingJobUnitRepository.createQueryBuilder
      .mockReturnValueOnce(createQueryBuilder([]))
      .mockReturnValueOnce(createQueryBuilder([]));
    settingRepository.findOne.mockResolvedValue({ content: 'disabled' });
    workspaceFilesService.getUnitVariableMap.mockResolvedValue(new Map([
      ['UNITA', new Set(['manual-var', 'auto-intended-var'])]
    ]));
    workspaceFilesService.getManualInstructionVariableMap.mockResolvedValue(new Map());

    const result = await service.getCaseCoverageOverview(5);

    expect(result).toMatchObject({
      totalCasesToCode: 1,
      effectiveTotalCasesToCode: 1,
      casesInJobs: 0,
      effectiveCasesInJobs: 0,
      unassignedCases: 1,
      effectiveUnassignedCases: 1,
      statusTotalCasesToCode: 2
    });
  });

  it('does not flag split definitions when their created jobs cover disjoint cases', async () => {
    const codingIncompleteStatus = statusStringToNumber('CODING_INCOMPLETE');

    responseRepository.createQueryBuilder.mockReturnValue(createQueryBuilder([
      {
        unitName: 'MDB091',
        variableId: '01',
        statusV1: String(codingIncompleteStatus),
        caseCount: '7'
      }
    ]));
    workspaceFilesService.getUnitVariableMap.mockResolvedValue(new Map([
      ['MDB091', new Set(['01'])]
    ]));
    jobDefinitionRepository.find.mockResolvedValue([
      {
        id: 20,
        status: 'approved',
        assigned_variables: [{ unitName: 'MDB091', variableId: '01' }]
      },
      {
        id: 21,
        status: 'approved',
        assigned_variables: [{ unitName: 'MDB091', variableId: '01' }]
      }
    ]);
    codingJobUnitRepository.createQueryBuilder
      .mockReturnValueOnce(createQueryBuilder([
        { unitName: 'MDB091', variableId: '01', casesInJobs: '7' }
      ]))
      .mockReturnValueOnce(createQueryBuilder([
        {
          unitName: 'MDB091',
          variableId: '01',
          responseId: '100',
          definitionId: '20',
          definitionStatus: 'approved'
        },
        {
          unitName: 'MDB091',
          variableId: '01',
          responseId: '101',
          definitionId: '20',
          definitionStatus: 'approved'
        },
        {
          unitName: 'MDB091',
          variableId: '01',
          responseId: '102',
          definitionId: '21',
          definitionStatus: 'approved'
        },
        {
          unitName: 'MDB091',
          variableId: '01',
          responseId: '103',
          definitionId: '21',
          definitionStatus: 'approved'
        },
        {
          unitName: 'MDB091',
          variableId: '01',
          responseId: '103',
          definitionId: '21',
          definitionStatus: 'approved'
        }
      ]));

    const result = await service.getVariableCoverageOverview(5);

    expect(result.conflictedVariables).toBe(0);
    expect(result.coverageByStatus.conflicted).toEqual([]);
    expect(result.fullyAbgedeckteVariablen).toBe(1);
  });

  it('classifies fully, partially, and missing variable coverage separately', async () => {
    const codingIncompleteStatus = statusStringToNumber('CODING_INCOMPLETE');

    responseRepository.createQueryBuilder.mockReturnValue(createQueryBuilder([
      {
        unitName: 'FULL_UNIT',
        variableId: '01',
        statusV1: String(codingIncompleteStatus),
        caseCount: '3'
      },
      {
        unitName: 'PARTIAL_UNIT',
        variableId: '01',
        statusV1: String(codingIncompleteStatus),
        caseCount: '3'
      },
      {
        unitName: 'MISSING_UNIT',
        variableId: '01',
        statusV1: String(codingIncompleteStatus),
        caseCount: '2'
      }
    ]));
    workspaceFilesService.getUnitVariableMap.mockResolvedValue(new Map([
      ['FULL_UNIT', new Set(['01'])],
      ['PARTIAL_UNIT', new Set(['01'])],
      ['MISSING_UNIT', new Set(['01'])]
    ]));
    jobDefinitionRepository.find.mockResolvedValue([
      {
        id: 30,
        status: 'approved',
        assigned_variables: [{ unitName: 'FULL_UNIT', variableId: '01' }]
      },
      {
        id: 31,
        status: 'pending_review',
        assigned_variables: [{ unitName: 'PARTIAL_UNIT', variableId: '01' }]
      }
    ]);
    codingJobUnitRepository.createQueryBuilder
      .mockReturnValueOnce(createQueryBuilder([
        { unitName: 'FULL_UNIT', variableId: '01', casesInJobs: '3' },
        { unitName: 'PARTIAL_UNIT', variableId: '01', casesInJobs: '1' }
      ]))
      .mockReturnValueOnce(createQueryBuilder([]));

    const result = await service.getVariableCoverageOverview(5);

    expect(result.totalVariables).toBe(3);
    expect(result.coveredVariables).toBe(2);
    expect(result.missingVariables).toBe(1);
    expect(result.fullyAbgedeckteVariablen).toBe(1);
    expect(result.partiallyAbgedeckteVariablen).toBe(1);
    expect(result.conflictedVariables).toBe(0);
    expect(result.coveragePercentage).toBeCloseTo(66.67, 2);
    expect(result.coverageByStatus.approved).toEqual(['FULL_UNIT:01']);
    expect(result.coverageByStatus.pending_review).toEqual(['PARTIAL_UNIT:01']);
    expect(result.coverageByStatus.conflicted).toEqual([]);
  });

  it('classifies duplicate-aggregated variable coverage on effective cases', async () => {
    const codingIncompleteStatus = statusStringToNumber('CODING_INCOMPLETE');
    const codingCompleteStatus = statusStringToNumber('CODING_COMPLETE');

    settingRepository.findOne.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === 'workspace-5-duplicate-aggregation-threshold') {
        return { content: '2' };
      }

      if (where.key === 'workspace-5-response-matching-mode') {
        return { content: JSON.stringify({ flags: ['IGNORE_CASE', 'IGNORE_WHITESPACE'] }) };
      }

      return null;
    });
    const incompleteVariablesQuery = createQueryBuilder([
      {
        unitName: 'AGG_UNIT',
        variableId: '01',
        statusV1: String(codingIncompleteStatus),
        caseCount: '3'
      }
    ]);
    const variableResponsesQuery = createQueryBuilder([
      {
        responseId: '100',
        unitName: 'AGG_UNIT',
        variableId: '01',
        value: 'Same answer',
        codeV2: null,
        statusV2: null,
        statusV1: String(codingIncompleteStatus),
        bookletName: 'BookletA',
        personLogin: 'login-1',
        personCode: 'code-1',
        personGroup: 'group-1'
      },
      {
        responseId: '101',
        unitName: 'AGG_UNIT',
        variableId: '01',
        value: 'sameanswer',
        codeV2: null,
        statusV2: null,
        statusV1: String(codingIncompleteStatus),
        bookletName: 'BookletA',
        personLogin: 'login-2',
        personCode: 'code-2',
        personGroup: 'group-1'
      },
      {
        responseId: '102',
        unitName: 'AGG_UNIT',
        variableId: '01',
        value: ' SAME ANSWER ',
        codeV2: null,
        statusV2: null,
        statusV1: String(codingIncompleteStatus),
        bookletName: 'BookletA',
        personLogin: 'login-3',
        personCode: 'code-3',
        personGroup: 'group-1'
      },
      {
        responseId: '103',
        unitName: 'AGG_UNIT',
        variableId: '01',
        value: 'already applied answer',
        codeV2: null,
        statusV2: String(codingCompleteStatus),
        statusV1: String(codingIncompleteStatus),
        bookletName: 'BookletA',
        personLogin: 'login-4',
        personCode: 'code-4',
        personGroup: 'group-1'
      }
    ]);
    responseRepository.createQueryBuilder
      .mockReturnValueOnce(incompleteVariablesQuery)
      .mockReturnValueOnce(variableResponsesQuery);
    workspaceFilesService.getUnitVariableMap.mockResolvedValue(new Map([
      ['AGG_UNIT', new Set(['01'])]
    ]));
    jobDefinitionRepository.find.mockResolvedValue([
      {
        id: 40,
        status: 'approved',
        assigned_variables: [{ unitName: 'AGG_UNIT', variableId: '01' }]
      }
    ]);
    const assignedResponseIdsQuery = createQueryBuilder([{ responseId: '100' }]);
    codingJobUnitRepository.createQueryBuilder
      .mockReturnValueOnce(assignedResponseIdsQuery)
      .mockReturnValueOnce(createQueryBuilder([]));

    const result = await service.getVariableCoverageOverview(5);

    expect(result.totalVariables).toBe(1);
    expect(result.coveredVariables).toBe(1);
    expect(result.fullyAbgedeckteVariablen).toBe(1);
    expect(result.partiallyAbgedeckteVariablen).toBe(0);
    expect(result.variableCaseCounts).toEqual([
      { unitName: 'AGG_UNIT', variableId: '01', caseCount: 3 }
    ]);
    expect(variableResponsesQuery.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('unit.name = :variableCoverageResponsesUnitName0'),
      expect.objectContaining({
        variableCoverageResponsesUnitName0: 'AGG_UNIT',
        variableCoverageResponsesVariableId0: '01'
      })
    );
    expect(assignedResponseIdsQuery.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('cju.unit_name = :assignedVariableCoverageUnitName0'),
      expect.objectContaining({
        assignedVariableCoverageUnitName0: 'AGG_UNIT',
        assignedVariableCoverageVariableId0: '01'
      })
    );
  });

  it('flags variables when the same response is assigned through multiple job definitions', async () => {
    const codingIncompleteStatus = statusStringToNumber('CODING_INCOMPLETE');

    responseRepository.createQueryBuilder.mockReturnValue(createQueryBuilder([
      {
        unitName: 'MDB091',
        variableId: '01',
        statusV1: String(codingIncompleteStatus),
        caseCount: '2'
      }
    ]));
    workspaceFilesService.getUnitVariableMap.mockResolvedValue(new Map([
      ['MDB091', new Set(['01'])]
    ]));
    jobDefinitionRepository.find.mockResolvedValue([
      {
        id: 20,
        status: 'approved',
        assigned_variables: [{ unitName: 'MDB091', variableId: '01' }]
      },
      {
        id: 21,
        status: 'approved',
        assigned_variables: [{ unitName: 'MDB091', variableId: '01' }]
      }
    ]);
    codingJobUnitRepository.createQueryBuilder
      .mockReturnValueOnce(createQueryBuilder([
        { unitName: 'MDB091', variableId: '01', casesInJobs: '2' }
      ]))
      .mockReturnValueOnce(createQueryBuilder([
        {
          unitName: 'MDB091',
          variableId: '01',
          responseId: '100',
          definitionId: '20',
          definitionStatus: 'approved'
        },
        {
          unitName: 'MDB091',
          variableId: '01',
          responseId: '100',
          definitionId: '21',
          definitionStatus: 'approved'
        },
        {
          unitName: 'MDB091',
          variableId: '01',
          responseId: '101',
          definitionId: '21',
          definitionStatus: 'approved'
        }
      ]));

    const result = await service.getVariableCoverageOverview(5);

    expect(result.conflictedVariables).toBe(1);
    expect(result.coverageByStatus.conflicted).toEqual([
      {
        variableKey: 'MDB091:01',
        conflictingDefinitions: [
          { id: 20, status: 'approved' },
          { id: 21, status: 'approved' }
        ]
      }
    ]);
  });
});
