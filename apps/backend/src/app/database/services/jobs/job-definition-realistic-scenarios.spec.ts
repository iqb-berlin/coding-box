import { BadRequestException } from '@nestjs/common';
import { CodingJobService } from '../coding/coding-job.service';
import {
  JobDefinition,
  JobDefinitionVariable
} from '../../entities/job-definition.entity';
import { JobDefinitionService } from './job-definition.service';

type ScenarioResponse = {
  id: number;
  variableid: string;
  value: string | null;
  statusV1?: number | null;
  unitName: string;
  unitAlias: string | null;
  bookletName: string;
  personLogin: string;
  personCode: string;
  personGroup: string;
};

type ScenarioJobDefinition = Partial<JobDefinition> &
Pick<JobDefinition, 'id' | 'workspace_id' | 'status' | 'assigned_variables' | 'assigned_variable_bundles'>;

type AssignedResponseIdsOwner = {
  getAssignedResponseIdsForVariables: (
    workspaceId: number,
    variables: JobDefinitionVariable[],
    excludeJobDefinitionId?: number
  ) => Promise<Set<number>>;
};

const createRepo = () => {
  const repo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(value => value),
    save: jest.fn(value => Promise.resolve(value)),
    remove: jest.fn(),
    manager: {
      transaction: jest.fn(async (callback: (manager: {
        getRepository: jest.Mock;
      }) => Promise<unknown>) => callback({
        getRepository: jest.fn(() => repo)
      }))
    },
    createQueryBuilder: jest.fn()
  };

  return repo;
};

const manualCodingResponse = (
  id: number,
  variable: JobDefinitionVariable,
  personCase: number,
  value: string
): ScenarioResponse => ({
  id,
  variableid: variable.variableId,
  value,
  unitName: variable.unitName,
  unitAlias: variable.unitName,
  bookletName: `Booklet-${personCase}`,
  personLogin: `P${personCase.toString().padStart(3, '0')}`,
  personCode: `C${personCase.toString().padStart(3, '0')}`,
  personGroup: 'G1'
});

const availability = (
  variable: JobDefinitionVariable,
  availableCases: number
) => ({
  unitName: variable.unitName,
  variableId: variable.variableId,
  responseCount: availableCases,
  casesInJobs: 0,
  availableCases,
  uniqueCasesAfterAggregation: availableCases
});

describe('JobDefinitionService realistic manual-coding edit scenarios', () => {
  let codingJobService: CodingJobService;
  let service: JobDefinitionService;
  let jobDefinitionRepository: ReturnType<typeof createRepo>;
  let codingValidationService: { getCodingIncompleteVariables: jest.Mock };
  let existingDefinition: ScenarioJobDefinition;

  const mv14828 = { unitName: 'MV14828', variableId: '01' };
  const mv14855 = { unitName: 'MV14855', variableId: '01' };
  const mv14868 = { unitName: 'MV14868', variableId: '01' };
  const mv15484 = { unitName: 'MV15484', variableId: '01' };

  const scenarioResponses: ScenarioResponse[] = [
    manualCodingResponse(1, mv14828, 1, 'same-value'),
    manualCodingResponse(2, mv14828, 1, 'same-value'),
    manualCodingResponse(3, mv14828, 2, 'same-value'),
    manualCodingResponse(4, mv14828, 3, 'other-value'),
    manualCodingResponse(5, mv14855, 4, 'value-a'),
    manualCodingResponse(6, mv14855, 4, 'value-a'),
    manualCodingResponse(7, mv14855, 5, 'value-b'),
    manualCodingResponse(8, mv14868, 6, 'removed-variable-value'),
    manualCodingResponse(9, mv15484, 7, 'added-variable-value')
  ];

  const createExistingDefinition = (): ScenarioJobDefinition => ({
    id: 74,
    workspace_id: 12,
    status: 'pending_review',
    assigned_variables: [mv14828, mv14855, mv14868],
    assigned_variable_bundles: [],
    assigned_coders: [4, 7, 8],
    max_coding_cases: null,
    case_ordering_mode: 'continuous',
    distribution_seed: 'job-definition:12:realistic-edit'
  });

  const changedVariables = [mv14828, mv14855, mv15484];

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
    const usersService = {
      getUserIsAdmin: jest.fn().mockResolvedValue(false),
      getUserAccessLevel: jest.fn().mockResolvedValue(1),
      assertUsersCanCodeInWorkspace: jest.fn().mockResolvedValue(undefined)
    };

    existingDefinition = createExistingDefinition();

    codingJobService = new CodingJobService(
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

    jest.spyOn(codingJobService, 'getSlimResponsesForVariables').mockImplementation(
      async (_workspaceId, variables) => scenarioResponses.filter(response => variables.some(
        variable => variable.unitName === response.unitName &&
          variable.variableId === response.variableid
      )) as never
    );
    jest.spyOn(codingJobService, 'getResponseMatchingMode').mockResolvedValue([]);
    jest.spyOn(codingJobService, 'getAggregationThreshold').mockResolvedValue(2);
    jest.spyOn(
      codingJobService as unknown as AssignedResponseIdsOwner,
      'getAssignedResponseIdsForVariables'
    ).mockResolvedValue(new Set());
    jest.spyOn(codingJobService, 'getCodingJobCountsByDefinitionIds')
      .mockResolvedValue(new Map());
    jest.spyOn(codingJobService, 'assertDeriveErrorManualCodingEnabled')
      .mockResolvedValue(undefined);
    jest.spyOn(codingJobService, 'assertCodersCanCodeInWorkspace')
      .mockResolvedValue(undefined);
    jest.spyOn(codingJobService, 'calculateDistributionVariableUsageByStatusBatch');

    jobDefinitionRepository = createRepo();
    jobDefinitionRepository.findOne.mockResolvedValue(existingDefinition);
    jobDefinitionRepository.find.mockResolvedValue([existingDefinition]);

    const variableBundleRepositoryForDefinitions = createRepo();
    variableBundleRepositoryForDefinitions.find.mockResolvedValue([]);
    const usersRepository = createRepo();
    codingValidationService = {
      getCodingIncompleteVariables: jest.fn().mockResolvedValue([
        availability(mv14828, 2),
        availability(mv14855, 2),
        availability(mv15484, 1)
      ])
    };
    const missingsProfilesService = {
      resolveMissingsProfileId: jest.fn(async (_workspaceId, profileId?: number | null) => profileId || 55)
    };

    service = new JobDefinitionService(
      jobDefinitionRepository as never,
      variableBundleRepositoryForDefinitions as never,
      usersRepository as never,
      codingJobService as never,
      codingValidationService as never,
      missingsProfilesService as never
    );
  });

  it('updates a definition after variable changes when duplicate raw responses still leave enough effective cases', async () => {
    await expect(service.updateJobDefinition(74, 12, {
      assignedVariables: changedVariables,
      assignedVariableBundles: [],
      maxCodingCases: null,
      caseOrderingMode: 'continuous'
    })).resolves.toMatchObject({
      id: 74,
      assigned_variables: changedVariables
    });

    expect(codingValidationService.getCodingIncompleteVariables).toHaveBeenCalledWith(
      12,
      undefined,
      undefined,
      false,
      74
    );
    expect(codingJobService.calculateDistributionVariableUsageByStatusBatch).toHaveBeenCalledWith(12, [
      expect.objectContaining({
        key: 'requested',
        excludeJobDefinitionId: 74,
        selectedVariables: changedVariables
      })
    ]);
    expect(jobDefinitionRepository.save).toHaveBeenCalled();
  });

  it('still rejects the same realistic edit when another unstarted definition reserves the effective cases', async () => {
    const competingDefinition: ScenarioJobDefinition = {
      id: 75,
      workspace_id: 12,
      status: 'approved',
      assigned_variables: [mv14828, mv14855],
      assigned_variable_bundles: [],
      assigned_coders: [9],
      max_coding_cases: null,
      case_ordering_mode: 'continuous',
      distribution_seed: 'job-definition:12:competing'
    };
    jobDefinitionRepository.find.mockResolvedValue([
      existingDefinition,
      competingDefinition
    ]);

    let thrownError: unknown;
    try {
      await service.updateJobDefinition(74, 12, {
        assignedVariables: changedVariables,
        assignedVariableBundles: [],
        maxCodingCases: null,
        caseOrderingMode: 'continuous'
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(BadRequestException);
    expect((thrownError as BadRequestException).message).toContain('MV14828:01');
    expect(jobDefinitionRepository.save).not.toHaveBeenCalled();
  });
});
