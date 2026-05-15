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
  let codingJobService: { createCodingJob: jest.Mock; createDistributedCodingJobs: jest.Mock };
  let codingValidationService: { getCodingIncompleteVariables: jest.Mock };
  let service: JobDefinitionService;

  beforeEach(() => {
    jobDefinitionRepository = createRepo();
    variableBundleRepository = createRepo();
    usersRepository = createRepo();
    codingJobService = {
      createCodingJob: jest.fn(),
      createDistributedCodingJobs: jest.fn().mockResolvedValue({ success: true, jobsCreated: 0, jobs: [] })
    };
    codingValidationService = {
      getCodingIncompleteVariables: jest.fn().mockResolvedValue([
        { unitName: 'Unit 1', variableId: 'Var 1', availableCases: 5 },
        { unitName: 'Unit 2', variableId: 'Var 2', availableCases: 4 }
      ])
    };

    jobDefinitionRepository.find.mockResolvedValue([]);
    variableBundleRepository.find.mockResolvedValue([]);
    usersRepository.find.mockResolvedValue([]);

    service = new JobDefinitionService(
      jobDefinitionRepository as never,
      variableBundleRepository as never,
      usersRepository as never,
      codingJobService as never,
      codingValidationService as never
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

  it('creates distributed coding jobs from an approved definition', async () => {
    jobDefinitionRepository.findOne.mockResolvedValue({
      id: 12,
      workspace_id: 7,
      status: 'approved',
      assigned_variables: [
        { unitName: 'Unit 1', variableId: 'Var 1' },
        { unitName: 'Unit 2', variableId: 'Var 2' }
      ],
      assigned_variable_bundles: [{ id: 9, name: 'Saved Bundle', caseOrderingMode: 'alternating' }],
      assigned_coders: [3, 1],
      duration_seconds: 30,
      max_coding_cases: 7,
      double_coding_absolute: 2,
      double_coding_percentage: null,
      case_ordering_mode: 'continuous',
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
      selectedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      selectedVariableBundles: [{
        id: 9,
        name: 'Hydrated Bundle',
        variables: [{ unitName: 'Unit 2', variableId: 'Var 2' }],
        caseOrderingMode: 'alternating'
      }],
      selectedCoders: [
        { id: 3, name: 'Chris', username: 'Chris' },
        { id: 1, name: 'Ada', username: 'Ada' }
      ],
      doubleCodingAbsolute: 2,
      doubleCodingPercentage: undefined,
      caseOrderingMode: 'continuous',
      maxCodingCases: 7,
      jobDefinitionId: 12,
      suppressGeneralInstructions: true
    });
  });
});
