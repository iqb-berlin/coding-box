import { BadRequestException } from '@nestjs/common';
import { JobDefinitionService } from './job-definition.service';

jest.mock('../coding/coding-job.service', () => ({
  CodingJobService: jest.fn()
}));

jest.mock('../coding/coding-validation.service', () => ({
  CodingValidationService: jest.fn()
}));

const createRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(value => value),
  save: jest.fn(value => Promise.resolve(value)),
  remove: jest.fn()
});

describe('JobDefinitionService', () => {
  let jobDefinitionRepository: ReturnType<typeof createRepo>;
  let variableBundleRepository: ReturnType<typeof createRepo>;
  let usersRepository: ReturnType<typeof createRepo>;
  let codingJobService: {
    createCodingJob: jest.Mock;
    createDistributedCodingJobs: jest.Mock;
    refreshDistributedCodingJobs: jest.Mock;
    calculateDistribution: jest.Mock;
    calculateDistributionVariableUsage: jest.Mock;
    calculateDistributionVariableUsageBatch: jest.Mock;
    getCodingJobCountsByDefinitionIds: jest.Mock;
    getBlockingCodingJobCountsByDefinitionIds: jest.Mock;
    assertCodersCanCodeInWorkspace: jest.Mock;
  };
  let codingValidationService: { getCodingIncompleteVariables: jest.Mock };
  let missingsProfilesService: { resolveMissingsProfileId: jest.Mock };
  let service: JobDefinitionService;

  beforeEach(() => {
    jobDefinitionRepository = createRepo();
    variableBundleRepository = createRepo();
    usersRepository = createRepo();
    codingJobService = {
      createCodingJob: jest.fn(),
      createDistributedCodingJobs: jest.fn().mockResolvedValue({ success: true, jobsCreated: 0, jobs: [] }),
      refreshDistributedCodingJobs: jest.fn().mockResolvedValue({
        success: true,
        jobsCreated: 0,
        jobs: [],
        preview: {
          jobDefinitionId: 1,
          existingJobsCount: 0,
          staleJobsCount: 0,
          existingCases: 0,
          plannedCases: 0,
          retainedCases: 0,
          addedCases: 0,
          removedCases: 0,
          addedCodingTasks: 0,
          removedCodingTasks: 0,
          canApply: true
        }
      }),
      calculateDistribution: jest.fn().mockResolvedValue({
        distribution: {},
        distributionByCoderId: {},
        doubleCodingInfo: {},
        aggregationInfo: {},
        matchingFlags: [],
        warnings: [],
        pairDistribution: {},
        tasksPerCoder: {},
        coderWeights: {}
      }),
      calculateDistributionVariableUsage: jest.fn(),
      calculateDistributionVariableUsageBatch: jest.fn(),
      getCodingJobCountsByDefinitionIds: jest.fn().mockResolvedValue(new Map()),
      getBlockingCodingJobCountsByDefinitionIds: jest.fn().mockResolvedValue(new Map()),
      assertCodersCanCodeInWorkspace: jest.fn().mockResolvedValue(undefined)
    };
    codingValidationService = {
      getCodingIncompleteVariables: jest.fn().mockResolvedValue([
        { unitName: 'Unit 1', variableId: 'Var 1', availableCases: 5 },
        { unitName: 'Unit 2', variableId: 'Var 2', availableCases: 4 }
      ])
    };
    missingsProfilesService = {
      resolveMissingsProfileId: jest.fn(async (_workspaceId, profileId?: number | null) => profileId || 55)
    };

    jobDefinitionRepository.find.mockResolvedValue([]);
    variableBundleRepository.find.mockResolvedValue([]);
    usersRepository.find.mockResolvedValue([]);
    const calculateUsageForRequest = async (request: {
      selectedVariableBundles?: {
        variables?: { unitName: string; variableId: string; includeDeriveError?: boolean }[];
      }[];
      selectedVariables?: { unitName: string; variableId: string; includeDeriveError?: boolean }[];
      maxCodingCases?: number;
    }) => {
      const incompleteVariables = await codingValidationService.getCodingIncompleteVariables() as Array<{
        unitName: string;
        variableId: string;
        availableCases: number;
      }>;
      const availableCasesByVariable = new Map<string, number>(
        incompleteVariables.map(variable => [
          `${variable.unitName}::${variable.variableId}`,
          variable.availableCases
        ])
      );
      const addUsage = (
        usageByVariable: Map<string, number>,
        variable: { unitName: string; variableId: string; includeDeriveError?: boolean },
        usage: number
      ) => {
        const key = `${variable.unitName}::${variable.variableId}`;
        usageByVariable.set(key, (usageByVariable.get(key) || 0) + usage);
      };
      const reserveAcrossVariables = (
        usageByVariable: Map<string, number>,
        variables: { unitName: string; variableId: string; includeDeriveError?: boolean }[],
        selectedCases: number
      ) => {
        const entries = variables
          .map(variable => ({
            variable,
            availableCases: availableCasesByVariable.get(`${variable.unitName}::${variable.variableId}`) || 0,
            usage: 0
          }))
          .filter(entry => entry.availableCases > 0);
        let remainingCases = Math.min(
          selectedCases,
          entries.reduce((sum, entry) => sum + entry.availableCases, 0)
        );

        while (remainingCases > 0) {
          const activeEntries = entries.filter(entry => entry.usage < entry.availableCases);
          const share = Math.max(1, Math.floor(remainingCases / activeEntries.length));

          for (const entry of activeEntries) {
            if (remainingCases <= 0) break;
            const assigned = Math.min(share, entry.availableCases - entry.usage, remainingCases);
            entry.usage += assigned;
            remainingCases -= assigned;
          }
        }

        entries.forEach(entry => addUsage(usageByVariable, entry.variable, entry.usage));
      };
      const items = [
        ...(request.selectedVariableBundles || []).map(bundle => ({
          availableCases: (bundle.variables || []).reduce(
            (sum, variable) => sum + (availableCasesByVariable.get(`${variable.unitName}::${variable.variableId}`) || 0),
            0
          ),
          reserve: (usageByVariable: Map<string, number>, selectedCases: number) => reserveAcrossVariables(
            usageByVariable,
            bundle.variables || [],
            selectedCases
          )
        })),
        ...(request.selectedVariables || []).map(variable => ({
          availableCases: availableCasesByVariable.get(`${variable.unitName}::${variable.variableId}`) || 0,
          reserve: (usageByVariable: Map<string, number>, selectedCases: number) => addUsage(
            usageByVariable,
            variable,
            Math.min(selectedCases, availableCasesByVariable.get(`${variable.unitName}::${variable.variableId}`) || 0)
          )
        }))
      ].filter(item => item.availableCases > 0);
      const maxCodingCases = request.maxCodingCases;
      const selectedByItem = items.map(() => 0);
      const remainingByItem = items.map(item => item.availableCases);
      const targetCases = typeof maxCodingCases === 'number' && maxCodingCases > 0 ?
        Math.min(maxCodingCases, remainingByItem.reduce((sum, availableCases) => sum + availableCases, 0)) :
        remainingByItem.reduce((sum, availableCases) => sum + availableCases, 0);
      let selectedCases = 0;

      while (selectedCases < targetCases) {
        for (let index = 0; index < items.length && selectedCases < targetCases; index += 1) {
          if (remainingByItem[index] <= 0) continue;
          remainingByItem[index] -= 1;
          selectedByItem[index] += 1;
          selectedCases += 1;
        }
      }

      const usageByVariable = new Map<string, number>();
      items.forEach((item, index) => item.reserve(usageByVariable, selectedByItem[index]));
      return usageByVariable;
    };
    codingJobService.calculateDistributionVariableUsage.mockImplementation(async (_workspaceId, request) => calculateUsageForRequest(request));
    codingJobService.calculateDistributionVariableUsageBatch.mockImplementation(async (_workspaceId, requests) => {
      const usageByKey = new Map();
      for (const request of requests) {
        usageByKey.set(
          request.key,
          await calculateUsageForRequest(request)
        );
      }
      return usageByKey;
    });

    service = new JobDefinitionService(
      jobDefinitionRepository as never,
      variableBundleRepository as never,
      usersRepository as never,
      codingJobService as never,
      codingValidationService as never,
      missingsProfilesService as never
    );
  });

  it('rejects definitions without coders or assigned variables/bundles', async () => {
    await expect(service.createJobDefinition({
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoders: []
    }, 7)).rejects.toBeInstanceOf(BadRequestException);

    await expect(service.createJobDefinition({
      assignedVariables: [],
      assignedVariableBundles: [],
      assignedCoders: [1]
    }, 7)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid double coding settings', async () => {
    await expect(service.createJobDefinition({
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoders: [1],
      doubleCodingAbsolute: 2,
      doubleCodingPercentage: 25
    }, 7)).rejects.toBeInstanceOf(BadRequestException);

    await expect(service.createJobDefinition({
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoders: [1],
      doubleCodingPercentage: 101
    }, 7)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects double coding with fewer than two coders', async () => {
    await expect(service.createJobDefinition({
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoders: [1],
      doubleCodingAbsolute: 1
    }, 7)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('uses the persisted distribution seed when checking and saving new definitions', async () => {
    const result = await service.createJobDefinition({
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoders: [1],
      maxCodingCases: 2
    }, 7);

    expect(result.distribution_seed).toMatch(/^job-definition:7:/);
    expect(codingJobService.calculateDistributionVariableUsageBatch).toHaveBeenCalledWith(7, [
      expect.objectContaining({
        key: 'requested',
        selectedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
        maxCodingCases: 2,
        distributionSeed: result.distribution_seed
      })
    ]);
  });

  it('merges DERIVE_ERROR opt-in into bundled variables when planning usage', async () => {
    variableBundleRepository.find.mockResolvedValue([
      {
        id: 9,
        name: 'Bundle',
        variables: [{ unitName: 'Unit 1', variableId: 'Var 1' }]
      }
    ]);

    await expect(service.createJobDefinition({
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1', includeDeriveError: true }],
      assignedVariableBundles: [{ id: 9, name: 'Bundle' }],
      assignedCoders: [1],
      maxCodingCases: 2
    }, 7)).resolves.toMatchObject({
      workspace_id: 7,
      max_coding_cases: 2
    });

    expect(codingJobService.calculateDistributionVariableUsageBatch).toHaveBeenCalledWith(7, [
      expect.objectContaining({
        key: 'requested',
        selectedVariables: [],
        selectedVariableBundles: [expect.objectContaining({
          id: 9,
          variables: [{ unitName: 'Unit 1', variableId: 'Var 1', includeDeriveError: true }]
        })]
      })
    ]);
  });

  it('preserves DERIVE_ERROR opt-in from duplicate assigned variables when planning usage', async () => {
    variableBundleRepository.find.mockResolvedValue([
      {
        id: 9,
        name: 'Bundle',
        variables: [{ unitName: 'Unit 1', variableId: 'Var 1' }]
      }
    ]);

    await service.createJobDefinition({
      assignedVariables: [
        { unitName: 'Unit 1', variableId: 'Var 1', includeDeriveError: true },
        { unitName: 'Unit 1', variableId: 'Var 1' }
      ],
      assignedVariableBundles: [{ id: 9, name: 'Bundle' }],
      assignedCoders: [1],
      maxCodingCases: 2
    }, 7);

    expect(codingJobService.calculateDistributionVariableUsageBatch).toHaveBeenCalledWith(7, [
      expect.objectContaining({
        key: 'requested',
        selectedVariables: [],
        selectedVariableBundles: [expect.objectContaining({
          id: 9,
          variables: [{ unitName: 'Unit 1', variableId: 'Var 1', includeDeriveError: true }]
        })]
      })
    ]);
  });

  it('deduplicates duplicate unbundled variables when planning usage', async () => {
    await service.createJobDefinition({
      assignedVariables: [
        { unitName: 'Unit 1', variableId: 'Var 1', includeDeriveError: true },
        { unitName: 'Unit 1', variableId: 'Var 1' }
      ],
      assignedVariableBundles: [],
      assignedCoders: [1],
      maxCodingCases: 2
    }, 7);

    expect(codingJobService.calculateDistributionVariableUsageBatch).toHaveBeenCalledWith(7, [
      expect.objectContaining({
        key: 'requested',
        selectedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1', includeDeriveError: true }],
        selectedVariableBundles: []
      })
    ]);
  });

  it('batches planned variable usage when checking conflicts', async () => {
    jobDefinitionRepository.find.mockResolvedValue([
      {
        id: 1,
        assigned_variables: [{ unitName: 'Unit 2', variableId: 'Var 2' }],
        assigned_variable_bundles: [],
        max_coding_cases: 1,
        case_ordering_mode: 'continuous',
        distribution_seed: 'seed-1'
      },
      {
        id: 2,
        assigned_variables: [{ unitName: 'Unit 2', variableId: 'Var 2' }],
        assigned_variable_bundles: [],
        max_coding_cases: 1,
        case_ordering_mode: 'alternating',
        distribution_seed: 'seed-2'
      }
    ]);

    await expect(service.createJobDefinition({
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoders: [1],
      maxCodingCases: 1
    }, 7)).resolves.toMatchObject({
      workspace_id: 7,
      max_coding_cases: 1
    });

    expect(codingJobService.calculateDistributionVariableUsageBatch).toHaveBeenCalledTimes(1);
    expect(codingJobService.calculateDistributionVariableUsage).not.toHaveBeenCalled();
    expect(codingJobService.calculateDistributionVariableUsageBatch).toHaveBeenCalledWith(7, [
      expect.objectContaining({
        key: 'requested',
        selectedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
        maxCodingCases: 1
      }),
      expect.objectContaining({
        key: 1,
        selectedVariables: [{ unitName: 'Unit 2', variableId: 'Var 2' }],
        caseOrderingMode: 'continuous',
        maxCodingCases: 1,
        jobDefinitionId: 1,
        distributionSeed: 'seed-1'
      }),
      expect.objectContaining({
        key: 2,
        selectedVariables: [{ unitName: 'Unit 2', variableId: 'Var 2' }],
        caseOrderingMode: 'alternating',
        maxCodingCases: 1,
        jobDefinitionId: 2,
        distributionSeed: 'seed-2'
      })
    ]);
  });

  it('rejects variables whose available cases are already reserved by another definition', async () => {
    jobDefinitionRepository.find.mockResolvedValue([
      {
        id: 1,
        assigned_variables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
        assigned_variable_bundles: [],
        max_coding_cases: 5
      }
    ]);

    await expect(service.createJobDefinition({
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoders: [1],
      maxCodingCases: 1
    }, 7)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('counts bundled variables when checking reserved cases', async () => {
    variableBundleRepository.find.mockResolvedValue([
      {
        id: 9,
        name: 'Bundle',
        variables: [
          { unitName: 'Unit 1', variableId: 'Var 1' },
          { unitName: 'Unit 2', variableId: 'Var 2' }
        ]
      }
    ]);
    jobDefinitionRepository.find.mockResolvedValue([
      {
        id: 1,
        assigned_variables: [],
        assigned_variable_bundles: [{ id: 9, name: 'Bundle' }],
        max_coding_cases: 6
      }
    ]);

    await expect(service.createJobDefinition({
      assignedVariableBundles: [{ id: 9, name: 'Bundle' }],
      assignedCoders: [1],
      maxCodingCases: 5
    }, 7)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows capped bundles when variables have uneven available cases', async () => {
    codingValidationService.getCodingIncompleteVariables.mockResolvedValue([
      { unitName: 'Unit 1', variableId: 'Var 1', availableCases: 9 },
      { unitName: 'Unit 2', variableId: 'Var 2', availableCases: 8 }
    ]);
    variableBundleRepository.find.mockResolvedValue([
      {
        id: 9,
        name: 'Bundle',
        variables: [
          { unitName: 'Unit 1', variableId: 'Var 1' },
          { unitName: 'Unit 2', variableId: 'Var 2' }
        ]
      }
    ]);

    await expect(service.createJobDefinition({
      assignedVariableBundles: [{ id: 9, name: 'Bundle' }],
      assignedCoders: [1],
      maxCodingCases: 17
    }, 7)).resolves.toMatchObject({
      workspace_id: 7,
      max_coding_cases: 17
    });
  });

  it('allows overlapping variable definitions when precise bundle reservation leaves enough cases', async () => {
    codingValidationService.getCodingIncompleteVariables.mockResolvedValue([
      { unitName: 'Unit 1', variableId: 'Var 1', availableCases: 10 },
      { unitName: 'Unit 2', variableId: 'Var 2', availableCases: 10 }
    ]);
    variableBundleRepository.find.mockResolvedValue([
      {
        id: 9,
        name: 'Bundle',
        variables: [
          { unitName: 'Unit 1', variableId: 'Var 1' },
          { unitName: 'Unit 2', variableId: 'Var 2' }
        ]
      }
    ]);
    jobDefinitionRepository.find.mockResolvedValue([
      {
        id: 1,
        assigned_variables: [],
        assigned_variable_bundles: [{ id: 9, name: 'Bundle' }],
        max_coding_cases: 5
      }
    ]);

    await expect(service.createJobDefinition({
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoders: [1],
      maxCodingCases: 6
    }, 7)).resolves.toMatchObject({
      workspace_id: 7,
      max_coding_cases: 6
    });
  });

  it('rejects overlapping variable definitions when precise bundle reservation leaves too few cases', async () => {
    codingValidationService.getCodingIncompleteVariables.mockResolvedValue([
      { unitName: 'Unit 1', variableId: 'Var 1', availableCases: 10 },
      { unitName: 'Unit 2', variableId: 'Var 2', availableCases: 10 }
    ]);
    variableBundleRepository.find.mockResolvedValue([
      {
        id: 9,
        name: 'Bundle',
        variables: [
          { unitName: 'Unit 1', variableId: 'Var 1' },
          { unitName: 'Unit 2', variableId: 'Var 2' }
        ]
      }
    ]);
    jobDefinitionRepository.find.mockResolvedValue([
      {
        id: 1,
        assigned_variables: [],
        assigned_variable_bundles: [{ id: 9, name: 'Bundle' }],
        max_coding_cases: 5
      }
    ]);

    await expect(service.createJobDefinition({
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoders: [1],
      maxCodingCases: 8
    }, 7)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not reserve the full global bundle cap against every bundle variable', async () => {
    codingValidationService.getCodingIncompleteVariables.mockResolvedValue([
      { unitName: 'Unit 1', variableId: 'Var 1', availableCases: 100 },
      { unitName: 'Unit 2', variableId: 'Var 2', availableCases: 100 }
    ]);
    variableBundleRepository.find.mockResolvedValue([
      {
        id: 9,
        name: 'Bundle',
        variables: [
          { unitName: 'Unit 1', variableId: 'Var 1' },
          { unitName: 'Unit 2', variableId: 'Var 2' }
        ]
      }
    ]);
    jobDefinitionRepository.find.mockResolvedValue([
      {
        id: 1,
        assigned_variables: [],
        assigned_variable_bundles: [{ id: 9, name: 'Bundle' }],
        max_coding_cases: 50
      }
    ]);

    await expect(service.createJobDefinition({
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoders: [1],
      maxCodingCases: 75
    }, 7)).resolves.toMatchObject({
      workspace_id: 7,
      max_coding_cases: 75
    });
  });

  it('uses planned bundle variable usage when checking conflicts', async () => {
    codingValidationService.getCodingIncompleteVariables.mockResolvedValue([
      { unitName: 'Unit 1', variableId: 'Var 1', availableCases: 10 },
      { unitName: 'Unit 2', variableId: 'Var 2', availableCases: 10 }
    ]);
    variableBundleRepository.find.mockResolvedValue([
      {
        id: 9,
        name: 'Bundle',
        variables: [
          { unitName: 'Unit 1', variableId: 'Var 1' },
          { unitName: 'Unit 2', variableId: 'Var 2' }
        ]
      }
    ]);
    jobDefinitionRepository.find.mockResolvedValue([
      {
        id: 1,
        assigned_variables: [],
        assigned_variable_bundles: [{ id: 9, name: 'Bundle' }],
        max_coding_cases: 6
      }
    ]);
    codingJobService.calculateDistributionVariableUsageBatch.mockResolvedValueOnce(new Map<string | number, Map<string, number>>([
      ['requested', new Map([['Unit 1::Var 1', 6]])],
      [1, new Map([['Unit 1::Var 1', 5], ['Unit 2::Var 2', 1]])]
    ]));

    await expect(service.createJobDefinition({
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoders: [1],
      maxCodingCases: 6
    }, 7)).rejects.toBeInstanceOf(BadRequestException);

    expect(codingJobService.calculateDistributionVariableUsageBatch).toHaveBeenCalledWith(7, [
      expect.objectContaining({
        key: 'requested',
        selectedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }]
      }),
      expect.objectContaining({
        key: 1,
        selectedVariableBundles: [expect.objectContaining({
          id: 9,
          variables: [
            { unitName: 'Unit 1', variableId: 'Var 1' },
            { unitName: 'Unit 2', variableId: 'Var 2' }
          ]
        })],
        jobDefinitionId: 1
      })
    ]);
  });

  it('allows split definitions on the same variable when the requested cap fits the remaining cases', async () => {
    jobDefinitionRepository.find.mockResolvedValue([
      {
        id: 1,
        assigned_variables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
        assigned_variable_bundles: [],
        max_coding_cases: 2
      }
    ]);

    await expect(service.createJobDefinition({
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoders: [1],
      maxCodingCases: 3
    }, 7)).resolves.toMatchObject({
      workspace_id: 7,
      max_coding_cases: 3
    });
  });

  it('does not reserve planned cases again for definitions that already have created jobs', async () => {
    codingValidationService.getCodingIncompleteVariables.mockResolvedValue([
      { unitName: 'Unit 1', variableId: 'Var 1', availableCases: 5 }
    ]);
    jobDefinitionRepository.find.mockResolvedValue([
      {
        id: 1,
        assigned_variables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
        assigned_variable_bundles: [],
        max_coding_cases: 5
      }
    ]);
    codingJobService.getCodingJobCountsByDefinitionIds.mockResolvedValue(new Map([[1, 1]]));
    codingJobService.calculateDistributionVariableUsageBatch.mockClear();

    await expect(service.createJobDefinition({
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoders: [1],
      maxCodingCases: 5
    }, 7)).resolves.toMatchObject({
      workspace_id: 7,
      max_coding_cases: 5
    });

    expect(codingJobService.getCodingJobCountsByDefinitionIds).toHaveBeenCalledWith(7, [1]);
    expect(codingJobService.calculateDistributionVariableUsageBatch).toHaveBeenCalledTimes(1);
    expect(codingJobService.calculateDistributionVariableUsageBatch.mock.calls[0][1].some(
      (usageRequest: { jobDefinitionId?: number }) => usageRequest.jobDefinitionId === 1
    )).toBe(false);
  });

  it('reserves global maxCodingCases across uneven variable items', async () => {
    codingValidationService.getCodingIncompleteVariables.mockResolvedValue([
      { unitName: 'Unit 1', variableId: 'Var 1', availableCases: 1 },
      { unitName: 'Unit 2', variableId: 'Var 2', availableCases: 100 }
    ]);
    jobDefinitionRepository.find.mockResolvedValue([
      {
        id: 1,
        assigned_variables: [
          { unitName: 'Unit 1', variableId: 'Var 1', includeDeriveError: true },
          { unitName: 'Unit 2', variableId: 'Var 2' }
        ],
        assigned_variable_bundles: [],
        max_coding_cases: 50
      }
    ]);

    await expect(service.createJobDefinition({
      assignedVariables: [{ unitName: 'Unit 2', variableId: 'Var 2' }],
      assignedCoders: [1],
      maxCodingCases: 60
    }, 7)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('persists coding display options on job definitions', async () => {
    await expect(service.createJobDefinition({
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoders: [1],
      showScore: true,
      allowComments: false,
      suppressGeneralInstructions: true
    }, 7)).resolves.toMatchObject({
      workspace_id: 7,
      show_score: true,
      allow_comments: false,
      suppress_general_instructions: true
    });
  });

  it('normalizes missing profiles on job definitions', async () => {
    await expect(service.createJobDefinition({
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoders: [1]
    }, 7)).resolves.toMatchObject({
      missings_profile_id: 55
    });

    await expect(service.createJobDefinition({
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoders: [1],
      missingsProfileId: 77
    }, 7)).resolves.toMatchObject({
      missings_profile_id: 77
    });

    expect(missingsProfilesService.resolveMissingsProfileId).toHaveBeenCalledWith(7, undefined);
    expect(missingsProfilesService.resolveMissingsProfileId).toHaveBeenCalledWith(7, 77);
  });

  it('persists coder capacity configs and derives assigned coder ids from them', async () => {
    await expect(service.createJobDefinition({
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoders: [99],
      assignedCoderConfigs: [
        { coderId: 1, capacityPercent: 50 },
        { coderId: 2, capacityPercent: 150 }
      ]
    }, 7)).resolves.toMatchObject({
      workspace_id: 7,
      assigned_coders: [1, 2],
      assigned_coder_configs: [
        { coderId: 1, capacityPercent: 50 },
        { coderId: 2, capacityPercent: 150 }
      ]
    });
  });

  it('preserves existing coder capacities when only assigned coder ids are updated', async () => {
    const existingDefinition = {
      id: 2,
      workspace_id: 7,
      status: 'draft',
      assigned_variables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assigned_variable_bundles: [],
      assigned_coders: [1, 2],
      assigned_coder_configs: [
        { coderId: 1, capacityPercent: 50 },
        { coderId: 2, capacityPercent: 150 }
      ],
      duration_seconds: 1,
      max_coding_cases: 5,
      case_ordering_mode: 'continuous'
    };

    jobDefinitionRepository.findOne.mockResolvedValue(existingDefinition);
    jobDefinitionRepository.find.mockResolvedValue([existingDefinition]);

    await expect(service.updateJobDefinition(2, {
      assignedCoders: [2, 3]
    })).resolves.toMatchObject({
      id: 2,
      assigned_coders: [2, 3],
      assigned_coder_configs: [
        { coderId: 2, capacityPercent: 150 },
        { coderId: 3, capacityPercent: 100 }
      ]
    });
    expect(codingJobService.assertCodersCanCodeInWorkspace).toHaveBeenCalledWith([2, 3], 7);
  });

  it('checks conflicts with the next caseOrderingMode when only ordering changes', async () => {
    const existingDefinition = {
      id: 2,
      workspace_id: 7,
      status: 'draft',
      assigned_variables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assigned_variable_bundles: [],
      assigned_coders: [1],
      duration_seconds: 1,
      max_coding_cases: 5,
      case_ordering_mode: 'continuous',
      distribution_seed: 'seed-2'
    };

    jobDefinitionRepository.findOne.mockResolvedValue(existingDefinition);
    jobDefinitionRepository.find.mockResolvedValue([existingDefinition]);
    codingJobService.calculateDistributionVariableUsageBatch.mockClear();
    codingJobService.assertCodersCanCodeInWorkspace.mockClear();

    await service.updateJobDefinition(2, {
      caseOrderingMode: 'alternating'
    });

    expect(codingJobService.assertCodersCanCodeInWorkspace).not.toHaveBeenCalled();
    expect(codingJobService.calculateDistributionVariableUsageBatch).toHaveBeenCalledWith(7, [
      expect.objectContaining({
        key: 'requested',
        selectedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
        caseOrderingMode: 'alternating',
        maxCodingCases: 5,
        jobDefinitionId: 2,
        distributionSeed: 'seed-2'
      })
    ]);
  });

  it('rejects invalid coder capacity configs', async () => {
    await expect(service.createJobDefinition({
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoderConfigs: [{ coderId: 1, capacityPercent: 0 }]
    }, 7)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates coding display options on job definitions', async () => {
    const existingDefinition = {
      id: 2,
      workspace_id: 7,
      status: 'draft',
      assigned_variables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assigned_variable_bundles: [],
      assigned_coders: [1],
      duration_seconds: 1,
      max_coding_cases: 5,
      case_ordering_mode: 'continuous',
      show_score: false,
      allow_comments: true,
      suppress_general_instructions: false
    };

    jobDefinitionRepository.findOne.mockResolvedValue(existingDefinition);
    jobDefinitionRepository.find.mockResolvedValue([existingDefinition]);

    await expect(service.updateJobDefinition(2, {
      showScore: true,
      allowComments: false,
      suppressGeneralInstructions: true
    })).resolves.toMatchObject({
      id: 2,
      show_score: true,
      allow_comments: false,
      suppress_general_instructions: true
    });
  });

  it('does not count the edited definition against its own availability', async () => {
    const existingDefinition = {
      id: 2,
      workspace_id: 7,
      status: 'draft',
      assigned_variables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assigned_variable_bundles: [],
      assigned_coders: [1],
      duration_seconds: 1,
      max_coding_cases: 5,
      case_ordering_mode: 'continuous'
    };

    jobDefinitionRepository.findOne.mockResolvedValue(existingDefinition);
    jobDefinitionRepository.find.mockResolvedValue([existingDefinition]);

    await expect(service.updateJobDefinition(2, {
      maxCodingCases: 5
    })).resolves.toMatchObject({ id: 2, max_coding_cases: 5 });
  });

  it('validates availability when an update approves a definition', async () => {
    const editedDefinition = {
      id: 2,
      workspace_id: 7,
      status: 'draft',
      assigned_variables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assigned_variable_bundles: [],
      assigned_coders: [1],
      duration_seconds: 1,
      max_coding_cases: 1,
      case_ordering_mode: 'continuous'
    };
    const competingDefinition = {
      id: 8,
      assigned_variables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assigned_variable_bundles: [],
      max_coding_cases: 5
    };

    jobDefinitionRepository.findOne.mockResolvedValue(editedDefinition);
    jobDefinitionRepository.find.mockResolvedValue([editedDefinition, competingDefinition]);

    await expect(service.updateJobDefinition(2, {
      status: 'approved'
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(codingJobService.assertCodersCanCodeInWorkspace).toHaveBeenCalledWith([1], 7);
  });

  it('rejects approval updates when existing assigned coders are no longer coding-enabled', async () => {
    const editedDefinition = {
      id: 2,
      workspace_id: 7,
      status: 'draft',
      assigned_variables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assigned_variable_bundles: [],
      assigned_coders: [1],
      duration_seconds: 1,
      max_coding_cases: 1,
      case_ordering_mode: 'continuous'
    };

    jobDefinitionRepository.findOne.mockResolvedValue(editedDefinition);
    codingJobService.assertCodersCanCodeInWorkspace.mockRejectedValueOnce(
      new BadRequestException('Coder is not enabled')
    );

    await expect(service.updateJobDefinition(2, {
      status: 'approved'
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(codingJobService.assertCodersCanCodeInWorkspace).toHaveBeenCalledWith([1], 7);
    expect(jobDefinitionRepository.save).not.toHaveBeenCalled();
  });

  it('attaches created coding job counts to listed definitions', async () => {
    const definitions = [
      {
        id: 3,
        workspace_id: 7,
        status: 'approved',
        assigned_variable_bundles: []
      },
      {
        id: 4,
        workspace_id: 7,
        status: 'draft',
        assigned_variable_bundles: []
      }
    ];

    jobDefinitionRepository.find.mockResolvedValue(definitions);
    codingJobService.getCodingJobCountsByDefinitionIds.mockResolvedValue(new Map([[3, 2]]));
    codingJobService.getBlockingCodingJobCountsByDefinitionIds.mockResolvedValue(new Map([[3, 1]]));

    const result = await service.getJobDefinitions(7);

    expect(codingJobService.getCodingJobCountsByDefinitionIds).toHaveBeenCalledWith(7, [3, 4]);
    expect(codingJobService.getBlockingCodingJobCountsByDefinitionIds).toHaveBeenCalledWith(7, [3, 4]);
    expect(result).toEqual([
      expect.objectContaining({
        id: 3,
        createdJobsCount: 2,
        created_jobs_count: 2,
        blockingCreatedJobsCount: 1,
        blocking_created_jobs_count: 1,
        openCreatedJobsCount: 1,
        open_created_jobs_count: 1
      }),
      expect.objectContaining({
        id: 4,
        createdJobsCount: 0,
        created_jobs_count: 0,
        blockingCreatedJobsCount: 0,
        blocking_created_jobs_count: 0,
        openCreatedJobsCount: 0,
        open_created_jobs_count: 0
      })
    ]);
  });

  it('attaches planned variable usage for listed definitions without created jobs', async () => {
    jobDefinitionRepository.find.mockResolvedValue([
      {
        id: 4,
        workspace_id: 7,
        status: 'draft',
        assigned_variables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
        assigned_variable_bundles: [],
        max_coding_cases: 2,
        case_ordering_mode: 'continuous',
        distribution_seed: 'seed-4'
      }
    ]);
    codingJobService.getCodingJobCountsByDefinitionIds.mockResolvedValue(new Map());
    codingJobService.getBlockingCodingJobCountsByDefinitionIds.mockResolvedValue(new Map());
    codingJobService.calculateDistributionVariableUsageBatch.mockResolvedValueOnce(new Map([
      [4, new Map([['Unit 1::Var 1', 2]])]
    ]));

    const result = await service.getJobDefinitions(7);

    expect(result[0]).toMatchObject({
      id: 4,
      plannedVariableUsage: { 'Unit 1::Var 1': 2 },
      planned_variable_usage: { 'Unit 1::Var 1': 2 }
    });
    expect(codingJobService.calculateDistributionVariableUsageBatch).toHaveBeenCalledWith(7, [
      expect.objectContaining({
        key: 4,
        selectedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
        maxCodingCases: 2,
        caseOrderingMode: 'continuous',
        jobDefinitionId: 4,
        distributionSeed: 'seed-4'
      })
    ]);
  });

  it('normalizes bundled variable opt-ins when attaching planned usage to listed definitions', async () => {
    jobDefinitionRepository.find.mockResolvedValue([
      {
        id: 6,
        workspace_id: 7,
        status: 'draft',
        assigned_variables: [
          { unitName: 'Unit-A', variableId: 'B', includeDeriveError: true },
          { unitName: 'Unit', variableId: 'A-B', includeDeriveError: true }
        ],
        assigned_variable_bundles: [{ id: 10, name: 'Hyphen Bundle' }],
        max_coding_cases: 2,
        case_ordering_mode: 'continuous',
        distribution_seed: 'seed-6'
      }
    ]);
    variableBundleRepository.find.mockResolvedValue([
      {
        id: 10,
        name: 'Hyphen Bundle',
        variables: [{ unitName: 'Unit', variableId: 'A-B' }]
      }
    ]);
    codingJobService.getCodingJobCountsByDefinitionIds.mockResolvedValue(new Map());
    codingJobService.getBlockingCodingJobCountsByDefinitionIds.mockResolvedValue(new Map());
    codingJobService.calculateDistributionVariableUsageBatch.mockResolvedValueOnce(new Map([
      [6, new Map([['Unit::A-B', 1], ['Unit-A::B', 1]])]
    ]));

    await service.getJobDefinitions(7);

    expect(codingJobService.calculateDistributionVariableUsageBatch).toHaveBeenCalledWith(7, [
      expect.objectContaining({
        key: 6,
        selectedVariables: [{ unitName: 'Unit-A', variableId: 'B', includeDeriveError: true }],
        selectedVariableBundles: [expect.objectContaining({
          id: 10,
          variables: [{ unitName: 'Unit', variableId: 'A-B', includeDeriveError: true }]
        })],
        maxCodingCases: 2,
        caseOrderingMode: 'continuous',
        jobDefinitionId: 6,
        distributionSeed: 'seed-6'
      })
    ]);
  });

  it('batches planned variable usage for listed definitions in the same workspace', async () => {
    jobDefinitionRepository.find.mockResolvedValue([
      {
        id: 4,
        workspace_id: 7,
        status: 'draft',
        assigned_variables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
        assigned_variable_bundles: [],
        max_coding_cases: 2,
        case_ordering_mode: 'continuous',
        distribution_seed: 'seed-4'
      },
      {
        id: 5,
        workspace_id: 7,
        status: 'draft',
        assigned_variables: [{ unitName: 'Unit 2', variableId: 'Var 2' }],
        assigned_variable_bundles: [],
        max_coding_cases: 3,
        case_ordering_mode: 'alternating',
        distribution_seed: 'seed-5'
      }
    ]);
    codingJobService.getCodingJobCountsByDefinitionIds.mockResolvedValue(new Map());
    codingJobService.getBlockingCodingJobCountsByDefinitionIds.mockResolvedValue(new Map());
    codingJobService.calculateDistributionVariableUsageBatch.mockResolvedValueOnce(new Map([
      [4, new Map([['Unit 1::Var 1', 2]])],
      [5, new Map([['Unit 2::Var 2', 3]])]
    ]));

    const result = await service.getJobDefinitions(7);

    expect(codingJobService.calculateDistributionVariableUsageBatch).toHaveBeenCalledTimes(1);
    expect(codingJobService.calculateDistributionVariableUsageBatch).toHaveBeenCalledWith(7, [
      expect.objectContaining({
        key: 4,
        selectedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }]
      }),
      expect.objectContaining({
        key: 5,
        selectedVariables: [{ unitName: 'Unit 2', variableId: 'Var 2' }]
      })
    ]);
    expect(result.map(definition => definition.plannedVariableUsage)).toEqual([
      { 'Unit 1::Var 1': 2 },
      { 'Unit 2::Var 2': 3 }
    ]);
  });

  it('rejects updates once coding jobs exist for a definition', async () => {
    jobDefinitionRepository.findOne.mockResolvedValue({
      id: 2,
      workspace_id: 7,
      status: 'approved',
      assigned_variables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assigned_variable_bundles: [],
      assigned_coders: [1],
      duration_seconds: 1,
      case_ordering_mode: 'continuous'
    });
    codingJobService.getCodingJobCountsByDefinitionIds.mockResolvedValue(new Map([[2, 1]]));

    await expect(service.updateJobDefinition(2, {
      assignedVariables: [{ unitName: 'Unit 2', variableId: 'Var 2' }]
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(jobDefinitionRepository.save).not.toHaveBeenCalled();
  });

  it('rejects deletes while coding jobs still block deletion for a definition', async () => {
    jobDefinitionRepository.findOne.mockResolvedValue({
      id: 2,
      workspace_id: 7,
      status: 'approved',
      assigned_variables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assigned_variable_bundles: [],
      assigned_coders: [1],
      duration_seconds: 1,
      case_ordering_mode: 'continuous'
    });
    codingJobService.getBlockingCodingJobCountsByDefinitionIds.mockResolvedValue(new Map([[2, 1]]));

    await expect(service.deleteJobDefinition(2)).rejects.toBeInstanceOf(BadRequestException);

    expect(jobDefinitionRepository.remove).not.toHaveBeenCalled();
  });

  it('allows deletes once all created coding jobs are ready for definition deletion', async () => {
    const definition = {
      id: 2,
      workspace_id: 7,
      status: 'approved',
      assigned_variables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assigned_variable_bundles: [],
      assigned_coders: [1],
      duration_seconds: 1,
      case_ordering_mode: 'continuous'
    };
    jobDefinitionRepository.findOne.mockResolvedValue(definition);
    codingJobService.getBlockingCodingJobCountsByDefinitionIds.mockResolvedValue(new Map());

    await expect(service.deleteJobDefinition(2)).resolves.toBeUndefined();

    expect(jobDefinitionRepository.remove).toHaveBeenCalledWith(definition);
  });

  it('hydrates bundles for approved definitions while preserving saved ordering mode', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const updatedAt = new Date('2026-01-02T00:00:00.000Z');
    const approvedDefinition = {
      id: 3,
      status: 'approved',
      workspace_id: 7,
      assigned_variable_bundles: [{ id: 9, name: 'Saved Bundle', caseOrderingMode: 'alternating' }]
    };

    jobDefinitionRepository.find.mockResolvedValue([approvedDefinition]);
    variableBundleRepository.find.mockResolvedValue([
      {
        id: 9,
        name: 'Hydrated Bundle',
        description: 'Bundle description',
        created_at: createdAt,
        updated_at: updatedAt,
        variables: [{ unitName: 'Unit 2', variableId: 'Var 2' }]
      }
    ]);

    const result = await service.getApprovedJobDefinitions(7);

    expect(result[0].assigned_variable_bundles).toEqual([
      {
        id: 9,
        name: 'Hydrated Bundle',
        description: 'Bundle description',
        createdAt,
        updatedAt,
        variables: [{ unitName: 'Unit 2', variableId: 'Var 2' }],
        caseOrderingMode: 'alternating'
      }
    ]);
  });

  it('uses BadRequestException for invalid approval transitions', async () => {
    jobDefinitionRepository.findOne.mockResolvedValue({
      id: 4,
      workspace_id: 7,
      status: 'approved',
      assigned_variables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assigned_variable_bundles: [],
      assigned_coders: [1],
      duration_seconds: 1,
      case_ordering_mode: 'continuous'
    });

    await expect(service.approveJobDefinition(4, {
      status: 'pending_review'
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects approval endpoint calls when existing assigned coders are no longer coding-enabled', async () => {
    jobDefinitionRepository.findOne.mockResolvedValue({
      id: 4,
      workspace_id: 7,
      status: 'pending_review',
      assigned_variables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assigned_variable_bundles: [],
      assigned_coders: [1],
      duration_seconds: 1,
      max_coding_cases: 1,
      case_ordering_mode: 'continuous'
    });
    codingJobService.assertCodersCanCodeInWorkspace.mockRejectedValueOnce(
      new BadRequestException('Coder is not enabled')
    );

    await expect(service.approveJobDefinition(4, {
      status: 'approved'
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(codingJobService.assertCodersCanCodeInWorkspace).toHaveBeenCalledWith([1], 7);
    expect(jobDefinitionRepository.save).not.toHaveBeenCalled();
  });

  it('creates distributed coding jobs from an approved definition', async () => {
    jobDefinitionRepository.findOne.mockResolvedValue({
      id: 12,
      workspace_id: 7,
      status: 'approved',
      assigned_variables: [
        { unitName: 'Unit 1', variableId: 'Var 1', includeDeriveError: true },
        { unitName: 'Unit 2', variableId: 'Var 2' }
      ],
      assigned_variable_bundles: [{ id: 9, name: 'Saved Bundle', caseOrderingMode: 'alternating' }],
      assigned_coders: [3, 1],
      duration_seconds: 30,
      max_coding_cases: 7,
      double_coding_absolute: 2,
      double_coding_percentage: null,
      case_ordering_mode: 'continuous',
      missings_profile_id: 88,
      assigned_coder_configs: [
        { coderId: 3, capacityPercent: 50 },
        { coderId: 1, capacityPercent: 150 }
      ],
      distribution_seed: 'seed-12',
      show_score: true,
      allow_comments: false,
      suppress_general_instructions: true
    });
    variableBundleRepository.find.mockResolvedValue([
      {
        id: 9,
        name: 'Hydrated Bundle',
        variables: [{ unitName: 'Unit 2', variableId: 'Var 2' }]
      }
    ]);
    usersRepository.find.mockResolvedValue([
      { id: 1, username: 'Ada' },
      { id: 3, username: 'Chris' }
    ]);
    codingJobService.createDistributedCodingJobs.mockResolvedValue({
      success: true,
      jobsCreated: 2,
      jobs: [{ jobId: 100 }, { jobId: 101 }]
    });

    await expect(service.createCodingJobFromDefinition(12, 7)).resolves.toMatchObject({
      success: true,
      jobsCreated: 2
    });

    expect(codingJobService.createCodingJob).not.toHaveBeenCalled();
    expect(codingJobService.createDistributedCodingJobs).toHaveBeenCalledWith(7, {
      selectedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1', includeDeriveError: true }],
      selectedVariableBundles: [{
        id: 9,
        name: 'Hydrated Bundle',
        variables: [{ unitName: 'Unit 2', variableId: 'Var 2' }],
        caseOrderingMode: 'alternating'
      }],
      selectedCoders: [
        {
          id: 3, name: 'Chris', username: 'Chris', capacityPercent: 50
        },
        {
          id: 1, name: 'Ada', username: 'Ada', capacityPercent: 150
        }
      ],
      doubleCodingAbsolute: 2,
      doubleCodingPercentage: undefined,
      caseOrderingMode: 'continuous',
      maxCodingCases: 7,
      jobDefinitionId: 12,
      missingsProfileId: 88,
      distributionSeed: 'seed-12',
      showScore: true,
      allowComments: false,
      suppressGeneralInstructions: true
    });
  });

  it('does not collide hyphenated variable keys when creating jobs from definitions', async () => {
    jobDefinitionRepository.findOne.mockResolvedValue({
      id: 13,
      workspace_id: 7,
      status: 'approved',
      assigned_variables: [
        { unitName: 'Unit-A', variableId: 'B', includeDeriveError: true },
        { unitName: 'Unit', variableId: 'A-B' }
      ],
      assigned_variable_bundles: [{ id: 10, name: 'Hyphen Bundle' }],
      assigned_coders: [1],
      duration_seconds: 30,
      max_coding_cases: 7,
      double_coding_absolute: 0,
      double_coding_percentage: null,
      case_ordering_mode: 'continuous',
      assigned_coder_configs: [{ coderId: 1, capacityPercent: 100 }],
      distribution_seed: 'seed-13',
      show_score: false,
      allow_comments: true,
      suppress_general_instructions: false
    });
    variableBundleRepository.find.mockResolvedValue([
      {
        id: 10,
        name: 'Hyphen Bundle',
        variables: [{ unitName: 'Unit', variableId: 'A-B' }]
      }
    ]);
    usersRepository.find.mockResolvedValue([{ id: 1, username: 'Ada' }]);

    await expect(service.createCodingJobFromDefinition(13, 7)).resolves.toMatchObject({
      success: true
    });

    expect(codingJobService.createDistributedCodingJobs).toHaveBeenCalledWith(7, expect.objectContaining({
      selectedVariables: [{ unitName: 'Unit-A', variableId: 'B', includeDeriveError: true }],
      selectedVariableBundles: [{
        id: 10,
        name: 'Hyphen Bundle',
        variables: [{ unitName: 'Unit', variableId: 'A-B' }],
        caseOrderingMode: undefined
      }]
    }));
  });

  it('previews jobs from definitions with the same normalized variable selection', async () => {
    jobDefinitionRepository.findOne.mockResolvedValue({
      id: 14,
      workspace_id: 7,
      status: 'approved',
      assigned_variables: [
        { unitName: 'Unit-A', variableId: 'B', includeDeriveError: true },
        { unitName: 'Unit', variableId: 'A-B', includeDeriveError: true }
      ],
      assigned_variable_bundles: [{ id: 10, name: 'Hyphen Bundle' }],
      assigned_coders: [1],
      duration_seconds: 30,
      max_coding_cases: 7,
      double_coding_absolute: 0,
      double_coding_percentage: null,
      case_ordering_mode: 'continuous',
      assigned_coder_configs: [{ coderId: 1, capacityPercent: 100 }],
      distribution_seed: 'seed-14',
      show_score: false,
      allow_comments: true,
      suppress_general_instructions: false
    });
    variableBundleRepository.find.mockResolvedValue([
      {
        id: 10,
        name: 'Hyphen Bundle',
        variables: [{ unitName: 'Unit', variableId: 'A-B' }]
      }
    ]);
    usersRepository.find.mockResolvedValue([{ id: 1, username: 'Ada' }]);

    const preview = await service.previewCodingJobFromDefinition(14, 7);

    expect(codingJobService.calculateDistribution).toHaveBeenCalledWith(7, expect.objectContaining({
      selectedVariables: [{ unitName: 'Unit-A', variableId: 'B', includeDeriveError: true }],
      selectedVariableBundles: [{
        id: 10,
        name: 'Hyphen Bundle',
        variables: [{ unitName: 'Unit', variableId: 'A-B', includeDeriveError: true }],
        caseOrderingMode: undefined
      }]
    }));
    expect(preview).toMatchObject({
      selectedVariables: [{ unitName: 'Unit-A', variableId: 'B', includeDeriveError: true }],
      selectedVariableBundles: [{
        id: 10,
        name: 'Hyphen Bundle',
        variables: [{ unitName: 'Unit', variableId: 'A-B', includeDeriveError: true }],
        caseOrderingMode: undefined
      }],
      selectedCoders: [{
        id: 1,
        name: 'Ada',
        username: 'Ada',
        capacityPercent: 100
      }]
    });
  });
});
