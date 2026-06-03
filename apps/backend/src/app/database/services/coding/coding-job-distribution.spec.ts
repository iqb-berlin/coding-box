import { BadRequestException } from '@nestjs/common';
import { CodingJobService, ResponseMatchingFlag } from './coding-job.service';
import { CodingJob } from '../../entities/coding-job.entity';
import { JobDefinition } from '../../entities/job-definition.entity';

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
  count: jest.fn().mockResolvedValue(0),
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(value => value),
  save: jest.fn(value => Promise.resolve(value)),
  delete: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn()
});

const createJobDefinitionLockQueryBuilder = (
  jobDefinition: unknown = { id: 1, workspace_id: 5, status: 'approved' }
) => {
  const queryBuilder: Record<string, jest.Mock> = {};
  [
    'setLock',
    'where',
    'andWhere'
  ].forEach(method => {
    queryBuilder[method] = jest.fn().mockReturnValue(queryBuilder);
  });
  queryBuilder.getOne = jest.fn().mockResolvedValue(jobDefinition);
  return queryBuilder;
};

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
  let codingJobRepository: ReturnType<typeof createRepo>;
  let jobDefinitionRepository: ReturnType<typeof createRepo>;
  let cacheService: { delete: jest.Mock };

  beforeEach(() => {
    codingJobRepository = createRepo();
    const codingJobCoderRepository = createRepo();
    const codingJobVariableRepository = createRepo();
    const codingJobVariableBundleRepository = createRepo();
    const codingJobUnitRepository = createRepo();
    const variableBundleRepository = createRepo();
    const responseRepository = createRepo();
    const fileUploadRepository = createRepo();
    const settingRepository = createRepo();
    jobDefinitionRepository = createRepo();
    jobDefinitionRepository.createQueryBuilder.mockReturnValue(createJobDefinitionLockQueryBuilder());
    const connection = {
      transaction: jest.fn(callback => callback({
        getRepository: (entity: unknown) => {
          if (entity === CodingJob) return codingJobRepository;
          if (entity === JobDefinition) return jobDefinitionRepository;
          return createRepo();
        }
      }))
    };
    cacheService = { delete: jest.fn().mockResolvedValue(undefined) };
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
    const usersService = {
      getUserIsAdmin: jest.fn().mockResolvedValue(false),
      getUserAccessLevel: jest.fn().mockResolvedValue(1),
      assertUsersCanCodeInWorkspace: jest.fn().mockResolvedValue(undefined)
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
      workspaceExclusionService as never,
      usersService as never
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
    jest.spyOn(
      service as unknown as { getAssignedResponseIdsForVariables: () => Promise<Set<number>> },
      'getAssignedResponseIdsForVariables'
    ).mockResolvedValue(new Set());
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
    jest.spyOn(
      service as unknown as {
        createCodingJobWithUnitSubsetInManager: (
          workspaceId: number,
          dto: {
            assignedCoders?: number[];
            caseOrderingMode?: 'continuous' | 'alternating';
            jobDefinitionId?: number;
            variableBundleIds?: number[];
            variables?: { unitName: string; variableId: string }[];
          },
          subset: SlimResponseForTest[]
        ) => Promise<CodingJob>
      },
      'createCodingJobWithUnitSubsetInManager'
    ).mockImplementation(async (_workspaceId, dto, subset) => {
      createdJobCalls.push({ dto, subset: subset as SlimResponseForTest[] });
      return { id: 100 + createdJobCalls.length } as CodingJob;
    });

    const preview = await service.calculateDistribution(5, request);
    const result = await service.createDistributedCodingJobs(5, {
      ...request,
      jobDefinitionId: 77
    });

    expect(result.success).toBe(true);
    expect(cacheService.delete).toHaveBeenCalledWith('coding_incomplete_variables_v6:5');
    expect(result.distribution).toEqual(preview.distribution);
    expect(result.doubleCodingInfo).toEqual(preview.doubleCodingInfo);
    expect(result.jobsCreated).toBe(createdJobCalls.length);
    expect(result.jobsCreated).toBe(
      Object.values(result.distribution)
        .reduce(
          (sum, itemDistribution) => sum + Object.values(itemDistribution).filter(count => count > 0).length,
          0
        )
    );

    const doubleCodingSummary = Object.values(result.doubleCodingInfo);
    expect(doubleCodingSummary.reduce((sum, item) => sum + item.distinctCases, 0)).toBe(7);
    expect(doubleCodingSummary.reduce((sum, item) => sum + item.codingTasksTotal, 0)).toBe(8);
    expect(doubleCodingSummary.reduce((sum, item) => sum + item.doubleCodedCases, 0)).toBe(1);
    expect(doubleCodingSummary.reduce((sum, item) => sum + item.singleCodedCasesAssigned, 0)).toBe(6);

    expect(createdJobCalls.every(call => call.dto.jobDefinitionId === 77)).toBe(true);
    expect(createdJobCalls.every(call => call.subset.length > 0)).toBe(true);

    const bundleCalls = createdJobCalls.filter(call => call.dto.variableBundleIds);
    const variableCalls = createdJobCalls.filter(call => call.dto.variables);
    expect(bundleCalls.length + variableCalls.length).toBe(createdJobCalls.length);
    expect(bundleCalls.every(call => call.dto.caseOrderingMode === 'alternating')).toBe(true);
    expect(variableCalls.every(call => call.dto.caseOrderingMode === 'continuous')).toBe(true);
    expect(bundleCalls.every(call => call.dto.variableBundleIds?.[0] === 9)).toBe(true);
    expect(variableCalls.every(call => (
      call.dto.variables?.[0].unitName === 'Unit 3' &&
      call.dto.variables?.[0].variableId === 'Var 3'
    ))).toBe(true);

    const assignedResponseCounts = new Map<number, number>();
    createdJobCalls.flatMap(call => call.subset).forEach(response => {
      assignedResponseCounts.set(response.id, (assignedResponseCounts.get(response.id) || 0) + 1);
    });
    expect([...assignedResponseCounts.values()].filter(count => count === 2)).toHaveLength(1);
    expect(Math.max(...assignedResponseCounts.values())).toBe(2);
  });

  it('skips cases already assigned by an earlier definition when creating later jobs', async () => {
    const responses = Array.from({ length: 10 }, (_, index) => makeResponse(index + 1, 'Unit 1', 'Var 1'));
    const createdJobCalls: Array<{ subset: SlimResponseForTest[] }> = [];

    mockResponses(responses);
    jest.spyOn(service, 'getResponseMatchingMode').mockResolvedValue([ResponseMatchingFlag.NO_AGGREGATION]);
    jest.spyOn(service, 'getAggregationThreshold').mockResolvedValue(null);
    (
      service as unknown as { getAssignedResponseIdsForVariables: jest.Mock<Promise<Set<number>>, []> }
    ).getAssignedResponseIdsForVariables.mockResolvedValue(new Set([1, 2, 3, 4, 5]));
    jest.spyOn(
      service as unknown as {
        createCodingJobWithUnitSubsetInManager: (
          workspaceId: number,
          dto: unknown,
          subset: SlimResponseForTest[]
        ) => Promise<CodingJob>
      },
      'createCodingJobWithUnitSubsetInManager'
    ).mockImplementation(async (_workspaceId, _dto, subset) => {
      createdJobCalls.push({ subset: subset as SlimResponseForTest[] });
      return { id: 200 + createdJobCalls.length } as CodingJob;
    });

    const result = await service.createDistributedCodingJobs(5, {
      selectedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      selectedCoders: [{ id: 1, name: 'Ada', username: 'ada' }],
      maxCodingCases: 5,
      caseOrderingMode: 'continuous',
      jobDefinitionId: 78
    });

    expect(result.success).toBe(true);
    expect(result.distribution['Unit 1::Var 1']).toEqual({ Ada: 5 });
    expect(result.warnings).toEqual([{
      unitName: 'Unit 1',
      variableId: 'Var 1',
      message: 'Variable: nur noch 5 von 10 Fällen verfügbar',
      casesInJobs: 5,
      availableCases: 5
    }]);
    expect(createdJobCalls).toHaveLength(1);
    expect(createdJobCalls[0].subset.map(response => response.id)).toEqual([6, 7, 8, 9, 10]);
  });

  it('shows newly imported available cases in a job definition refresh preview', async () => {
    const responses = Array.from({ length: 8 }, (_, index) => makeResponse(index + 1, 'Unit 1', 'Var 1'));
    const variable = { unitName: 'Unit 1', variableId: 'Var 1' };

    mockResponses(responses);
    jest.spyOn(service, 'getResponseMatchingMode').mockResolvedValue([ResponseMatchingFlag.NO_AGGREGATION]);
    jest.spyOn(service, 'getAggregationThreshold').mockResolvedValue(null);
    jest.spyOn(
      service as unknown as {
        getJobDefinitionExistingTaskRows: (
          workspaceId: number,
          jobDefinitionId: number
        ) => Promise<Array<{
          responseId: number;
          itemKey: string;
          coderId: number;
          taskCount: number;
        }>>;
      },
      'getJobDefinitionExistingTaskRows'
    ).mockResolvedValue(
      [1, 2, 3, 4, 5].map(responseId => ({
        responseId,
        itemKey: 'Unit 1::Var 1',
        coderId: 1,
        taskCount: 1
      }))
    );
    jest.spyOn(
      service as unknown as {
        getJobDefinitionJobCounts: (
          workspaceId: number,
          jobDefinitionId: number
        ) => Promise<{ existingJobsCount: number; staleJobsCount: number }>;
      },
      'getJobDefinitionJobCounts'
    ).mockResolvedValue({ existingJobsCount: 1, staleJobsCount: 1 });
    jest.spyOn(
      service as unknown as {
        jobDefinitionHasAnyCodingWork: (
          workspaceId: number,
          jobDefinitionId: number
        ) => Promise<boolean>;
      },
      'jobDefinitionHasAnyCodingWork'
    ).mockResolvedValue(false);

    const preview = await service.previewJobDefinitionRefresh(5, {
      selectedVariables: [variable],
      selectedCoders: [{ id: 1, name: 'Ada', username: 'ada' }],
      caseOrderingMode: 'continuous',
      jobDefinitionId: 80
    });

    expect(preview).toMatchObject({
      jobDefinitionId: 80,
      existingJobsCount: 1,
      staleJobsCount: 1,
      existingCases: 5,
      plannedCases: 8,
      retainedCases: 5,
      addedCases: 3,
      removedCases: 0,
      addedCodingTasks: 3,
      removedCodingTasks: 0,
      itemDeltas: [
        expect.objectContaining({
          itemKey: 'Unit 1::Var 1',
          addedCases: 3,
          addedCodingTasks: 3
        })
      ],
      canApply: true
    });
    expect(
      (
        service as unknown as { getAssignedResponseIdsForVariables: jest.Mock }
      ).getAssignedResponseIdsForVariables
    ).toHaveBeenCalledWith(5, [variable], 80, undefined);
  });

  it('assigns double-coded cases to exactly two coders when more coders are selected', async () => {
    const responses = Array.from({ length: 6 }, (_, index) => makeResponse(index + 1, 'Unit 1', 'Var 1'));
    const createdJobCalls: Array<{ subset: SlimResponseForTest[] }> = [];

    mockResponses(responses);
    jest.spyOn(service, 'getResponseMatchingMode').mockResolvedValue([ResponseMatchingFlag.NO_AGGREGATION]);
    jest.spyOn(service, 'getAggregationThreshold').mockResolvedValue(null);
    jest.spyOn(
      service as unknown as {
        createCodingJobWithUnitSubsetInManager: (
          workspaceId: number,
          dto: unknown,
          subset: SlimResponseForTest[]
        ) => Promise<CodingJob>
      },
      'createCodingJobWithUnitSubsetInManager'
    ).mockImplementation(async (_workspaceId, _dto, subset) => {
      createdJobCalls.push({ subset: subset as SlimResponseForTest[] });
      return { id: 500 + createdJobCalls.length } as CodingJob;
    });

    const result = await service.createDistributedCodingJobs(5, {
      selectedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      selectedCoders: [
        { id: 1, name: 'Ada', username: 'ada' },
        { id: 2, name: 'Bea', username: 'bea' },
        { id: 3, name: 'Chris', username: 'chris' }
      ],
      doubleCodingAbsolute: 2,
      caseOrderingMode: 'continuous',
      jobDefinitionId: 83
    });

    const assignedResponseCounts = new Map<number, number>();
    createdJobCalls.flatMap(call => call.subset).forEach(response => {
      assignedResponseCounts.set(response.id, (assignedResponseCounts.get(response.id) || 0) + 1);
    });

    expect(result.success).toBe(true);
    expect(result.doubleCodingInfo['Unit 1::Var 1']).toMatchObject({
      distinctCases: 6,
      codingTasksTotal: 8,
      doubleCodedCases: 2,
      singleCodedCasesAssigned: 4
    });
    expect([...assignedResponseCounts.values()].filter(count => count === 2)).toHaveLength(2);
    expect(Math.max(...assignedResponseCounts.values())).toBe(2);
    expect(Object.values(result.pairDistribution).reduce((sum, count) => sum + count, 0)).toBe(2);
  });

  it('ignores unsupported requests for more than two coders per double-coded case', async () => {
    const responses = Array.from({ length: 4 }, (_, index) => makeResponse(index + 1, 'Unit 1', 'Var 1'));
    const createdJobCalls: Array<{ subset: SlimResponseForTest[] }> = [];

    mockResponses(responses);
    jest.spyOn(service, 'getResponseMatchingMode').mockResolvedValue([ResponseMatchingFlag.NO_AGGREGATION]);
    jest.spyOn(service, 'getAggregationThreshold').mockResolvedValue(null);
    jest.spyOn(
      service as unknown as {
        createCodingJobWithUnitSubsetInManager: (
          workspaceId: number,
          dto: unknown,
          subset: SlimResponseForTest[]
        ) => Promise<CodingJob>
      },
      'createCodingJobWithUnitSubsetInManager'
    ).mockImplementation(async (_workspaceId, _dto, subset) => {
      createdJobCalls.push({ subset: subset as SlimResponseForTest[] });
      return { id: 600 + createdJobCalls.length } as CodingJob;
    });

    const result = await service.createDistributedCodingJobs(5, {
      selectedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      selectedCoders: [
        { id: 1, name: 'Ada', username: 'ada' },
        { id: 2, name: 'Bea', username: 'bea' },
        { id: 3, name: 'Chris', username: 'chris' }
      ],
      doubleCodingAbsolute: 1,
      caseOrderingMode: 'continuous',
      jobDefinitionId: 84,
      codersPerDoubleCodedCase: 3
    } as never);

    const assignedResponseCounts = new Map<number, number>();
    createdJobCalls.flatMap(call => call.subset).forEach(response => {
      assignedResponseCounts.set(response.id, (assignedResponseCounts.get(response.id) || 0) + 1);
    });

    expect(result.success).toBe(true);
    expect(result.doubleCodingInfo['Unit 1::Var 1']).toMatchObject({
      distinctCases: 4,
      codingTasksTotal: 5,
      doubleCodedCases: 1,
      singleCodedCasesAssigned: 3
    });
    expect(Math.max(...assignedResponseCounts.values())).toBe(2);
    expect([...assignedResponseCounts.values()].filter(count => count === 2)).toHaveLength(1);
  });

  it('uses safe display keys for coder names that collide with object prototype properties', async () => {
    const responses = [makeResponse(1, 'Unit 1', 'Var 1')];

    mockResponses(responses);
    jest.spyOn(service, 'getResponseMatchingMode').mockResolvedValue([ResponseMatchingFlag.NO_AGGREGATION]);
    jest.spyOn(service, 'getAggregationThreshold').mockResolvedValue(null);

    const preview = await service.calculateDistribution(5, {
      selectedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      selectedCoders: [
        { id: 1, name: 'constructor', username: 'constructor' },
        { id: 2, name: '__proto__', username: '__proto__' }
      ],
      doubleCodingAbsolute: 1,
      caseOrderingMode: 'continuous'
    });

    expect(preview.distribution['Unit 1::Var 1']).toEqual({
      'constructor (#1)': 1,
      '__proto__ (#2)': 1
    });
    expect(preview.distributionByCoderId['Unit 1::Var 1']).toEqual({
      1: 1,
      2: 1
    });
    expect(preview.doubleCodingInfo['Unit 1::Var 1'].doubleCodedCasesPerCoder).toEqual({
      'constructor (#1)': 1,
      '__proto__ (#2)': 1
    });
  });

  it('uses coder weights when balancing single-coded work', async () => {
    const responses = Array.from({ length: 8 }, (_, index) => makeResponse(index + 1, 'Unit 1', 'Var 1'));

    mockResponses(responses);
    jest.spyOn(service, 'getResponseMatchingMode').mockResolvedValue([ResponseMatchingFlag.NO_AGGREGATION]);
    jest.spyOn(service, 'getAggregationThreshold').mockResolvedValue(null);

    const preview = await service.calculateDistribution(5, {
      selectedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      selectedCoders: [
        {
          id: 1, name: 'Ada', username: 'ada', weight: 1
        },
        {
          id: 2, name: 'Bea', username: 'bea', weight: 3
        }
      ],
      caseOrderingMode: 'continuous'
    });

    expect(preview.tasksPerCoder['1'] + preview.tasksPerCoder['2']).toBe(8);
    expect(preview.tasksPerCoder['2']).toBeGreaterThan(preview.tasksPerCoder['1']);
    expect(preview.coderWeights).toEqual({ 1: 1, 2: 3 });
  });

  it.each([
    [
      'non-integer coder IDs',
      [
        {
          id: 1.5,
          name: 'Ada',
          username: 'ada'
        }
      ]
    ],
    [
      'capacity below the allowed range',
      [
        {
          id: 1,
          name: 'Ada',
          username: 'ada',
          capacityPercent: 0
        }
      ]
    ],
    [
      'capacity above the allowed range',
      [
        {
          id: 1,
          name: 'Ada',
          username: 'ada',
          capacityPercent: 500
        }
      ]
    ],
    [
      'non-positive weights',
      [
        {
          id: 1,
          name: 'Ada',
          username: 'ada',
          weight: 0
        }
      ]
    ]
  ])('rejects invalid direct distribution coder input: %s', async (_label, selectedCoders) => {
    await expect(service.calculateDistribution(5, {
      selectedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      selectedCoders,
      caseOrderingMode: 'continuous'
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('skips an entire aggregation group when one representative is already assigned', async () => {
    const responses = [1, 2, 3].map(id => makeResponse(id, 'Unit 1', 'Var 1', 'same-value'));
    const createdJobCalls: Array<{ subset: SlimResponseForTest[] }> = [];
    const request = {
      selectedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      selectedCoders: [{ id: 1, name: 'Ada', username: 'ada' }],
      caseOrderingMode: 'continuous' as const
    };

    mockResponses(responses);
    jest.spyOn(service, 'getResponseMatchingMode').mockResolvedValue([]);
    jest.spyOn(service, 'getAggregationThreshold').mockResolvedValue(2);
    (
      service as unknown as { getAssignedResponseIdsForVariables: jest.Mock<Promise<Set<number>>, []> }
    ).getAssignedResponseIdsForVariables.mockResolvedValue(new Set([1]));
    jest.spyOn(
      service as unknown as {
        createCodingJobWithUnitSubsetInManager: (
          workspaceId: number,
          dto: unknown,
          subset: SlimResponseForTest[]
        ) => Promise<CodingJob>
      },
      'createCodingJobWithUnitSubsetInManager'
    ).mockImplementation(async (_workspaceId, _dto, subset) => {
      createdJobCalls.push({ subset: subset as SlimResponseForTest[] });
      return { id: 300 + createdJobCalls.length } as CodingJob;
    });

    const preview = await service.calculateDistribution(5, request);
    const result = await service.createDistributedCodingJobs(5, {
      ...request,
      jobDefinitionId: 79
    });

    expect(preview.aggregationInfo['Unit 1::Var 1']).toEqual({
      uniqueCases: 0,
      totalResponses: 0
    });
    expect(preview.distribution['Unit 1::Var 1']).toEqual({ Ada: 0 });
    expect(preview.warnings).toEqual([{
      unitName: 'Unit 1',
      variableId: 'Var 1',
      message: 'Variable: nur noch 0 von 1 Fällen verfügbar',
      casesInJobs: 1,
      availableCases: 0
    }]);
    expect(result.success).toBe(true);
    expect(result.distribution).toEqual(preview.distribution);
    expect(result.warnings).toEqual(preview.warnings);
    expect(result.jobsCreated).toBe(0);
    expect(createdJobCalls).toHaveLength(0);
  });

  it('keeps aggregation groups separate for equal values in different variables of a bundle', async () => {
    const responses = [
      makeResponse(1, 'Unit 1', 'Var 1', 'same-value'),
      makeResponse(2, 'Unit 1', 'Var 1', 'same-value'),
      makeResponse(3, 'Unit 2', 'Var 2', 'same-value'),
      makeResponse(4, 'Unit 2', 'Var 2', 'same-value')
    ];
    const createdJobCalls: Array<{ subset: SlimResponseForTest[] }> = [];
    const request = {
      selectedVariables: [],
      selectedVariableBundles: [{
        id: 9,
        name: 'Bundle A',
        variables: [
          { unitName: 'Unit 1', variableId: 'Var 1' },
          { unitName: 'Unit 2', variableId: 'Var 2' }
        ]
      }],
      selectedCoders: [{ id: 1, name: 'Ada', username: 'ada' }],
      caseOrderingMode: 'continuous' as const
    };

    mockResponses(responses);
    jest.spyOn(service, 'getResponseMatchingMode').mockResolvedValue([]);
    jest.spyOn(service, 'getAggregationThreshold').mockResolvedValue(2);
    jest.spyOn(
      service as unknown as {
        createCodingJobWithUnitSubsetInManager: (
          workspaceId: number,
          dto: unknown,
          subset: SlimResponseForTest[]
        ) => Promise<CodingJob>
      },
      'createCodingJobWithUnitSubsetInManager'
    ).mockImplementation(async (_workspaceId, _dto, subset) => {
      createdJobCalls.push({ subset: subset as SlimResponseForTest[] });
      return { id: 400 + createdJobCalls.length } as CodingJob;
    });

    const preview = await service.calculateDistribution(5, request);
    const result = await service.createDistributedCodingJobs(5, {
      ...request,
      jobDefinitionId: 80
    });

    expect(preview.aggregationInfo['bundle:9']).toEqual({
      uniqueCases: 2,
      totalResponses: 4
    });
    expect(preview.distribution['bundle:9']).toEqual({ Ada: 2 });
    expect(result.distribution).toEqual(preview.distribution);
    expect(result.aggregationInfo).toEqual(preview.aggregationInfo);
    expect(createdJobCalls).toHaveLength(1);
    expect(createdJobCalls[0].subset.map(response => response.id).sort((a, b) => a - b)).toEqual([1, 3]);
  });

  it('keeps bundles with duplicate names separate by bundle id', async () => {
    const responses = [
      makeResponse(1, 'Unit 1', 'Var 1'),
      makeResponse(2, 'Unit 1', 'Var 1'),
      makeResponse(3, 'Unit 2', 'Var 2'),
      makeResponse(4, 'Unit 2', 'Var 2')
    ];
    const createdJobCalls: Array<{
      dto: {
        variableBundleIds?: number[];
      };
      subset: SlimResponseForTest[];
    }> = [];

    mockResponses(responses);
    jest.spyOn(service, 'getResponseMatchingMode').mockResolvedValue([ResponseMatchingFlag.NO_AGGREGATION]);
    jest.spyOn(service, 'getAggregationThreshold').mockResolvedValue(null);
    jest.spyOn(
      service as unknown as {
        createCodingJobWithUnitSubsetInManager: (
          workspaceId: number,
          dto: { variableBundleIds?: number[] },
          subset: SlimResponseForTest[]
        ) => Promise<CodingJob>
      },
      'createCodingJobWithUnitSubsetInManager'
    ).mockImplementation(async (_workspaceId, dto, subset) => {
      createdJobCalls.push({ dto, subset: subset as SlimResponseForTest[] });
      return { id: 700 + createdJobCalls.length } as CodingJob;
    });

    const result = await service.createDistributedCodingJobs(5, {
      selectedVariables: [],
      selectedVariableBundles: [
        {
          id: 9,
          name: 'Duplicate Bundle',
          variables: [{ unitName: 'Unit 1', variableId: 'Var 1' }]
        },
        {
          id: 10,
          name: 'Duplicate Bundle',
          variables: [{ unitName: 'Unit 2', variableId: 'Var 2' }]
        }
      ],
      selectedCoders: [{ id: 1, name: 'Ada', username: 'ada' }],
      caseOrderingMode: 'continuous',
      jobDefinitionId: 85
    });

    expect(result.success).toBe(true);
    expect(result.distribution).toEqual({
      'bundle:9': { Ada: 2 },
      'bundle:10': { Ada: 2 }
    });
    expect(result.jobs.map(job => job.itemKey)).toEqual(['bundle:9', 'bundle:10']);
    expect(createdJobCalls.map(call => call.dto.variableBundleIds)).toEqual([[9], [10]]);
    expect(createdJobCalls.map(call => call.subset.map(response => response.id))).toEqual([[1, 2], [3, 4]]);
  });

  it('calculates variable usage from the exact planned bundle case selection', async () => {
    const responses = [
      ...Array.from({ length: 8 }, (_, index) => ({
        ...makeResponse(index + 1, 'Unit A', 'Var A'),
        personGroup: `G${index}`
      })),
      ...Array.from({ length: 10 }, (_, index) => ({
        ...makeResponse(index + 20, 'Unit Y', 'Var B'),
        personGroup: 'G0'
      }))
    ];

    mockResponses(responses);
    jest.spyOn(service, 'getResponseMatchingMode').mockResolvedValue([ResponseMatchingFlag.NO_AGGREGATION]);
    jest.spyOn(service, 'getAggregationThreshold').mockResolvedValue(null);

    const usage = await service.calculateDistributionVariableUsage(5, {
      selectedVariables: [],
      selectedVariableBundles: [{
        id: 9,
        name: 'Bundle A',
        variables: [
          { unitName: 'Unit A', variableId: 'Var A' },
          { unitName: 'Unit Y', variableId: 'Var B' }
        ]
      }],
      maxCodingCases: 6,
      caseOrderingMode: 'continuous',
      distributionSeed: 'usage-seed'
    });

    expect(Object.fromEntries(usage.entries())).toEqual({
      'Unit A::Var A': 6
    });
  });

  it('calculates batched variable usage with one shared workspace context', async () => {
    const responses = [
      ...Array.from({ length: 3 }, (_, index) => makeResponse(index + 1, 'Unit 1', 'Var 1')),
      ...Array.from({ length: 4 }, (_, index) => makeResponse(index + 10, 'Unit 2', 'Var 2'))
    ];

    mockResponses(responses);
    const matchingSpy = jest.spyOn(service, 'getResponseMatchingMode')
      .mockResolvedValue([ResponseMatchingFlag.NO_AGGREGATION]);
    const thresholdSpy = jest.spyOn(service, 'getAggregationThreshold').mockResolvedValue(null);
    const slimResponsesSpy = service.getSlimResponsesForVariables as jest.Mock;
    const assignedResponseIdsSpy = (
      service as unknown as { getAssignedResponseIdsForVariables: jest.Mock }
    ).getAssignedResponseIdsForVariables;

    const usageByKey = await service.calculateDistributionVariableUsageBatch(5, [
      {
        key: 'first',
        selectedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
        maxCodingCases: 2,
        caseOrderingMode: 'continuous',
        distributionSeed: 'seed-1'
      },
      {
        key: 'second',
        selectedVariables: [{ unitName: 'Unit 2', variableId: 'Var 2' }],
        maxCodingCases: 3,
        caseOrderingMode: 'alternating',
        distributionSeed: 'seed-2'
      }
    ]);

    expect(Object.fromEntries(usageByKey.get('first')?.entries() || [])).toEqual({
      'Unit 1::Var 1': 2
    });
    expect(Object.fromEntries(usageByKey.get('second')?.entries() || [])).toEqual({
      'Unit 2::Var 2': 3
    });
    expect(matchingSpy).toHaveBeenCalledTimes(1);
    expect(thresholdSpy).toHaveBeenCalledTimes(1);
    expect(workspaceFilesService.getDerivedVariableMap).toHaveBeenCalledTimes(1);
    expect(slimResponsesSpy).toHaveBeenCalledTimes(1);
    expect(assignedResponseIdsSpy).toHaveBeenCalledTimes(1);
    expect(slimResponsesSpy).toHaveBeenCalledWith(5, [
      { unitName: 'Unit 1', variableId: 'Var 1' },
      { unitName: 'Unit 2', variableId: 'Var 2' }
    ]);
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

  it('does not aggregate empty manual responses when distributing coding jobs', async () => {
    const request = {
      selectedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      selectedCoders: [
        { id: 1, name: 'Ada', username: 'ada' },
        { id: 2, name: 'Bea', username: 'bea' }
      ],
      caseOrderingMode: 'continuous' as const
    };

    mockResponses([
      makeResponse(1, 'Unit 1', 'Var 1', ''),
      makeResponse(2, 'Unit 1', 'Var 1', ''),
      makeResponse(3, 'Unit 1', 'Var 1', null),
      makeResponse(4, 'Unit 1', 'Var 1', '[]')
    ]);
    jest.spyOn(service, 'getResponseMatchingMode').mockResolvedValue([]);
    jest.spyOn(service, 'getAggregationThreshold').mockResolvedValue(2);

    const preview = await service.calculateDistribution(5, request);

    expect(preview.aggregationInfo['Unit 1::Var 1']).toEqual({
      uniqueCases: 4,
      totalResponses: 4
    });
    expect(
      Object.values(preview.distribution['Unit 1::Var 1'])
        .reduce((sum, value) => sum + value, 0)
    ).toBe(4);
  });

  it('blocks creating jobs from a definition when jobs already exist for it', async () => {
    const responses = Array.from({ length: 3 }, (_, index) => makeResponse(index + 1, 'Unit 1', 'Var 1'));
    const createCodingJobSpy = jest.spyOn(
      service as unknown as {
        createCodingJobWithUnitSubsetInManager: (
          workspaceId: number,
          dto: unknown,
          subset: SlimResponseForTest[]
        ) => Promise<CodingJob>
      },
      'createCodingJobWithUnitSubsetInManager'
    ).mockResolvedValue({ id: 900 } as CodingJob);

    mockResponses(responses);
    jest.spyOn(service, 'getResponseMatchingMode').mockResolvedValue([ResponseMatchingFlag.NO_AGGREGATION]);
    jest.spyOn(service, 'getAggregationThreshold').mockResolvedValue(null);
    codingJobRepository.count.mockResolvedValue(1);

    const result = await service.createDistributedCodingJobs(5, {
      selectedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      selectedCoders: [{ id: 1, name: 'Ada', username: 'ada' }],
      caseOrderingMode: 'continuous',
      jobDefinitionId: 81
    });

    expect(result.success).toBe(false);
    expect(result.jobsCreated).toBe(0);
    expect(result.message).toContain('Coding jobs already exist for job definition 81');
    expect(createCodingJobSpy).not.toHaveBeenCalled();
    expect(codingJobRepository.count).toHaveBeenCalledWith({
      where: {
        workspace_id: 5,
        job_definition_id: 81
      }
    });
  });

  it('blocks creating jobs from a definition that is not approved', async () => {
    const responses = Array.from({ length: 3 }, (_, index) => makeResponse(index + 1, 'Unit 1', 'Var 1'));
    const createCodingJobSpy = jest.spyOn(
      service as unknown as {
        createCodingJobWithUnitSubsetInManager: (
          workspaceId: number,
          dto: unknown,
          subset: SlimResponseForTest[]
        ) => Promise<CodingJob>
      },
      'createCodingJobWithUnitSubsetInManager'
    ).mockResolvedValue({ id: 901 } as CodingJob);

    mockResponses(responses);
    jest.spyOn(service, 'getResponseMatchingMode').mockResolvedValue([ResponseMatchingFlag.NO_AGGREGATION]);
    jest.spyOn(service, 'getAggregationThreshold').mockResolvedValue(null);
    jobDefinitionRepository.createQueryBuilder.mockReturnValue(
      createJobDefinitionLockQueryBuilder({ id: 82, workspace_id: 5, status: 'draft' })
    );

    const result = await service.createDistributedCodingJobs(5, {
      selectedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      selectedCoders: [{ id: 1, name: 'Ada', username: 'ada' }],
      caseOrderingMode: 'continuous',
      jobDefinitionId: 82
    });

    expect(result.success).toBe(false);
    expect(result.jobsCreated).toBe(0);
    expect(result.message).toContain(
      'Only approved job definitions can be used to create coding jobs'
    );
    expect(createCodingJobSpy).not.toHaveBeenCalled();
    expect(codingJobRepository.count).not.toHaveBeenCalled();
  });
});
