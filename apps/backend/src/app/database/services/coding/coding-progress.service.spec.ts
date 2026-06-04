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
  findOne: jest.fn()
});

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
      executeBrackets(condition, queryBuilder);
      return queryBuilder;
    });
  });
  queryBuilder.getRawMany = jest.fn().mockResolvedValue(rawResults);
  queryBuilder.getCount = jest.fn().mockResolvedValue(0);
  return queryBuilder;
};

const expectProductiveManualPoolExists = (queryBuilder: MockQueryBuilder) => {
  expect(queryBuilder.subQueryProbes).toHaveLength(1);
  const [existsBuilder] = queryBuilder.subQueryProbes;
  expect(existsBuilder.from).toHaveBeenCalledWith('coding_job_unit', 'manual_cju');
  expect(existsBuilder.innerJoin).toHaveBeenCalledWith(
    'coding_job',
    'manual_cj',
    'manual_cj.id = manual_cju.coding_job_id'
  );
  expect(existsBuilder.where).toHaveBeenCalledWith('manual_cju.response_id = response.id');
  expect(existsBuilder.andWhere).toHaveBeenCalledWith('manual_cj.training_id IS NULL');
};

describe('CodingProgressService variable coverage conflicts', () => {
  let responseRepository: ReturnType<typeof createRepository>;
  let codingJobUnitRepository: ReturnType<typeof createRepository>;
  let jobDefinitionRepository: ReturnType<typeof createRepository>;
  let variableBundleRepository: ReturnType<typeof createRepository>;
  let settingRepository: ReturnType<typeof createRepository>;
  let workspaceFilesService: {
    getDerivedVariableMap: jest.Mock;
    getDerivedVariablesBySourceMap: jest.Mock;
  };
  let service: CodingProgressService;

  beforeEach(() => {
    responseRepository = createRepository();
    codingJobUnitRepository = createRepository();
    jobDefinitionRepository = createRepository();
    variableBundleRepository = createRepository();
    settingRepository = createRepository();

    workspaceFilesService = {
      getDerivedVariableMap: jest.fn().mockResolvedValue(new Map()),
      getDerivedVariablesBySourceMap: jest.fn().mockResolvedValue(new Map())
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
      .mockReturnValueOnce(createQueryBuilder(allResponses))
      .mockReturnValueOnce(createQueryBuilder(manualPoolResponses))
      .mockReturnValueOnce(createQueryBuilder(allResponses))
      .mockReturnValueOnce(createQueryBuilder(manualPoolResponses));
    codingJobUnitRepository.createQueryBuilder
      .mockReturnValueOnce(createQueryBuilder([]))
      .mockReturnValueOnce(createQueryBuilder([]))
      .mockReturnValueOnce(createQueryBuilder([]));
    settingRepository.findOne.mockResolvedValue({ content: 'disabled' });
    workspaceFilesService.getDerivedVariablesBySourceMap.mockResolvedValue(new Map([
      [getManualCodingScopeKey('UnitA', 'base-var'), new Set(['derived-var'])]
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
      .mockReturnValueOnce(createQueryBuilder(responses))
      .mockReturnValueOnce(createQueryBuilder(responses));
    settingRepository.findOne.mockResolvedValue({ content: 'disabled' });

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

  it('limits manual pool existence checks to non-training coding jobs', async () => {
    const allResponsesQuery = createQueryBuilder([]);
    const manualPoolQuery = createQueryBuilder([]);
    const variableCoverageQuery = createQueryBuilder([]);

    responseRepository.createQueryBuilder
      .mockReturnValueOnce(allResponsesQuery)
      .mockReturnValueOnce(manualPoolQuery)
      .mockReturnValueOnce(variableCoverageQuery);
    codingJobUnitRepository.createQueryBuilder.mockReturnValue(createQueryBuilder([]));
    settingRepository.findOne.mockResolvedValue({ content: 'disabled' });
    jobDefinitionRepository.find.mockResolvedValue([]);

    await service.getCodingProgressOverview(5);
    await service.getVariableCoverageOverview(5);

    expectProductiveManualPoolExists(manualPoolQuery);
    expectProductiveManualPoolExists(variableCoverageQuery);
  });

  it('excludes covered source responses from case coverage while preserving status totals', async () => {
    const codingIncompleteStatus = statusStringToNumber('CODING_INCOMPLETE');
    const intendedIncompleteStatus = statusStringToNumber('INTENDED_INCOMPLETE');

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

  it('does not flag split definitions when their created jobs cover disjoint cases', async () => {
    responseRepository.createQueryBuilder.mockReturnValue(createQueryBuilder([
      { unitName: 'MDB091', variableId: '01', caseCount: '7' }
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
    responseRepository.createQueryBuilder.mockReturnValue(createQueryBuilder([
      { unitName: 'FULL_UNIT', variableId: '01', caseCount: '3' },
      { unitName: 'PARTIAL_UNIT', variableId: '01', caseCount: '3' },
      { unitName: 'MISSING_UNIT', variableId: '01', caseCount: '2' }
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

  it('flags variables when the same response is assigned through multiple job definitions', async () => {
    responseRepository.createQueryBuilder.mockReturnValue(createQueryBuilder([
      { unitName: 'MDB091', variableId: '01', caseCount: '2' }
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
