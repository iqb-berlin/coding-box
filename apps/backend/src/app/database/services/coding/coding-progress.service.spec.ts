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

const createQueryBuilder = (rawResults: unknown[] = []) => {
  const queryBuilder: Record<string, jest.Mock> = {};
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
    queryBuilder[method] = jest.fn().mockReturnValue(queryBuilder);
  });
  queryBuilder.getRawMany = jest.fn().mockResolvedValue(rawResults);
  queryBuilder.getCount = jest.fn().mockResolvedValue(0);
  return queryBuilder;
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
