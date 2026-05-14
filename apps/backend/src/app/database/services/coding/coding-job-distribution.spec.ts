import { CodingJobService, ResponseMatchingFlag } from './coding-job.service';
import { CodingJob } from '../../entities/coding-job.entity';

jest.mock('../workspace/workspace-files.service', () => ({
  WorkspaceFilesService: class {}
}));

type SlimResponseForTest = {
  id: number;
  variableid: string;
  value: string | null;
  unitName: string;
  unitAlias: string | null;
  bookletName: string;
  personLogin: string;
  personCode: string;
  personGroup: string;
  variableBundleId?: number;
};

const createRepo = () => ({
  count: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(value => value),
  save: jest.fn(value => Promise.resolve(value)),
  delete: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn()
});

const makeResponse = (
  id: number,
  unitName: string,
  variableid: string,
  value = `value-${id}`
): SlimResponseForTest => ({
  id,
  variableid,
  value,
  unitName,
  unitAlias: unitName,
  bookletName: 'Booklet',
  personLogin: `P${id.toString().padStart(3, '0')}`,
  personCode: `C${id.toString().padStart(3, '0')}`,
  personGroup: 'G1'
});

describe('CodingJobService distribution from job definitions', () => {
  let service: CodingJobService;
  let workspaceFilesService: { getDerivedVariableMap: jest.Mock };

  beforeEach(() => {
    const codingJobRepository = createRepo();
    const codingJobCoderRepository = createRepo();
    const codingJobVariableRepository = createRepo();
    const codingJobVariableBundleRepository = createRepo();
    const codingJobUnitRepository = createRepo();
    const variableBundleRepository = createRepo();
    const responseRepository = createRepo();
    const fileUploadRepository = createRepo();
    const settingRepository = createRepo();
    const connection = { transaction: jest.fn() };
    const cacheService = { delete: jest.fn().mockResolvedValue(undefined) };
    workspaceFilesService = {
      getDerivedVariableMap: jest.fn().mockResolvedValue(new Map())
    };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };

    service = new CodingJobService(
      codingJobRepository as never,
      codingJobCoderRepository as never,
      codingJobVariableRepository as never,
      codingJobVariableBundleRepository as never,
      codingJobUnitRepository as never,
      variableBundleRepository as never,
      responseRepository as never,
      fileUploadRepository as never,
      settingRepository as never,
      connection as never,
      cacheService as never,
      workspaceFilesService as never,
      workspaceExclusionService as never
    );

    jest.spyOn(
      (service as unknown as { logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock } }).logger,
      'log'
    ).mockImplementation(jest.fn());
    jest.spyOn(
      (service as unknown as { logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock } }).logger,
      'warn'
    ).mockImplementation(jest.fn());
    jest.spyOn(
      (service as unknown as { logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock } }).logger,
      'error'
    ).mockImplementation(jest.fn());
  });

  function mockResponses(responses: SlimResponseForTest[]): void {
    jest.spyOn(service, 'getSlimResponsesForVariables').mockImplementation(async (_workspaceId, variables) => responses.filter(response => variables.some(variable => variable.unitName === response.unitName &&
      variable.variableId === response.variableid
    ))
    );
    jest.spyOn(
      service as unknown as { getVariableCasesInJobs: () => Promise<Map<string, number>> },
      'getVariableCasesInJobs'
    ).mockResolvedValue(new Map());
  }

  it('keeps preview distribution and created jobs aligned for capped double-coded mixed definitions', async () => {
    const responses = [
      ...Array.from({ length: 5 }, (_, index) => makeResponse(index + 1, 'Unit 1', 'Var 1')),
      ...Array.from({ length: 4 }, (_, index) => makeResponse(index + 6, 'Unit 2', 'Var 2')),
      ...Array.from({ length: 5 }, (_, index) => makeResponse(index + 10, 'Unit 3', 'Var 3'))
    ];
    const request = {
      selectedVariables: [{ unitName: 'Unit 3', variableId: 'Var 3' }],
      selectedVariableBundles: [{
        id: 9,
        name: 'Bundle A',
        caseOrderingMode: 'alternating' as const,
        variables: [
          { unitName: 'Unit 1', variableId: 'Var 1' },
          { unitName: 'Unit 2', variableId: 'Var 2' }
        ]
      }],
      selectedCoders: [
        { id: 2, name: 'Bea', username: 'bea' },
        { id: 1, name: 'Ada', username: 'ada' }
      ],
      doubleCodingAbsolute: 1,
      caseOrderingMode: 'continuous' as const,
      maxCodingCases: 7
    };
    const createdJobCalls: Array<{
      dto: {
        assignedCoders?: number[];
        caseOrderingMode?: 'continuous' | 'alternating';
        jobDefinitionId?: number;
        variableBundleIds?: number[];
        variables?: { unitName: string; variableId: string }[];
      };
      subset: SlimResponseForTest[];
    }> = [];

    mockResponses(responses);
    jest.spyOn(service, 'getResponseMatchingMode').mockResolvedValue([ResponseMatchingFlag.NO_AGGREGATION]);
    jest.spyOn(service, 'getAggregationThreshold').mockResolvedValue(null);
    jest.spyOn(service, 'createCodingJobWithUnitSubset').mockImplementation(async (_workspaceId, dto, subset) => {
      createdJobCalls.push({ dto, subset: subset as SlimResponseForTest[] });
      return { id: 100 + createdJobCalls.length } as CodingJob;
    });

    const preview = await service.calculateDistribution(5, request);
    const result = await service.createDistributedCodingJobs(5, {
      ...request,
      jobDefinitionId: 77
    });

    expect(result.success).toBe(true);
    expect(result.distribution).toEqual(preview.distribution);
    expect(result.doubleCodingInfo).toEqual(preview.doubleCodingInfo);
    expect(result.jobsCreated).toBe(4);
    expect(result.distribution).toEqual({
      'Bundle A': { Ada: 3, Bea: 2 },
      'Unit 3::Var 3': { Ada: 2, Bea: 2 }
    });
    expect(createdJobCalls.map(call => call.dto.jobDefinitionId)).toEqual([77, 77, 77, 77]);
    expect(createdJobCalls.map(call => call.dto.caseOrderingMode)).toEqual([
      'alternating',
      'alternating',
      'continuous',
      'continuous'
    ]);
    expect(createdJobCalls[0].dto.variableBundleIds).toEqual([9]);
    expect(createdJobCalls[1].dto.variableBundleIds).toEqual([9]);
    expect(createdJobCalls[2].dto.variables).toEqual([{ unitName: 'Unit 3', variableId: 'Var 3' }]);
    expect(createdJobCalls[3].dto.variables).toEqual([{ unitName: 'Unit 3', variableId: 'Var 3' }]);

    const assignedResponseCounts = new Map<number, number>();
    createdJobCalls.flatMap(call => call.subset).forEach(response => {
      assignedResponseCounts.set(response.id, (assignedResponseCounts.get(response.id) || 0) + 1);
    });
    expect(assignedResponseCounts.get(1)).toBe(2);
    expect(assignedResponseCounts.get(10)).toBe(2);
  });

  it('does not aggregate derived variables even when their values are empty', async () => {
    const request = {
      selectedVariables: [{ unitName: 'Derived Unit', variableId: 'Derived Var' }],
      selectedCoders: [
        { id: 1, name: 'Ada', username: 'ada' },
        { id: 2, name: 'Bea', username: 'bea' }
      ],
      caseOrderingMode: 'continuous' as const
    };

    mockResponses(
      Array.from({ length: 4 }, (_, index) => makeResponse(index + 1, 'Derived Unit', 'Derived Var', null))
    );
    jest.spyOn(service, 'getResponseMatchingMode').mockResolvedValue([]);
    jest.spyOn(service, 'getAggregationThreshold').mockResolvedValue(2);
    workspaceFilesService.getDerivedVariableMap.mockResolvedValue(new Map([
      ['Derived Unit', new Set(['Derived Var'])]
    ]));

    const preview = await service.calculateDistribution(5, request);

    expect(preview.aggregationInfo['Derived Unit::Derived Var']).toEqual({
      uniqueCases: 4,
      totalResponses: 4
    });
    expect(preview.distribution['Derived Unit::Derived Var']).toEqual({
      Ada: 2,
      Bea: 2
    });
  });
});
