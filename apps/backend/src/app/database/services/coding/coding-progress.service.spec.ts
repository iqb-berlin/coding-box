import { CodingProgressService } from './coding-progress.service';

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
  let service: CodingProgressService;

  beforeEach(() => {
    responseRepository = createRepository();
    codingJobUnitRepository = createRepository();
    jobDefinitionRepository = createRepository();
    variableBundleRepository = createRepository();
    settingRepository = createRepository();

    const workspaceFilesService = {
      getDerivedVariableMap: jest.fn().mockResolvedValue(new Map())
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
