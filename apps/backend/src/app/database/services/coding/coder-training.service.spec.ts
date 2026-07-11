import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { CoderTrainingService, TrainingResponseIdsMap } from './coder-training.service';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobCoder } from '../../entities/coding-job-coder.entity';
import { CodingJobVariable } from '../../entities/coding-job-variable.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CodingJobVariableBundle } from '../../entities/coding-job-variable-bundle.entity';
import { CoderTraining } from '../../entities/coder-training.entity';
import { CoderTrainingVariable } from '../../entities/coder-training-variable.entity';
import { CoderTrainingBundle } from '../../entities/coder-training-bundle.entity';
import { CoderTrainingCoder } from '../../entities/coder-training-coder.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import { ChunkEntity } from '../../entities/chunk.entity';
import { CodingJobService, ResponseMatchingFlag } from './coding-job.service';
import { CodingStatisticsService } from './coding-statistics.service';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { CoderTrainingDiscussionResult } from '../../entities/coder-training-discussion-result.entity';
import User from '../../entities/user.entity';
import { MissingsProfilesService } from './missings-profiles.service';
import type { CaseSelectionMode, ReferenceMode } from '../../entities/coder-training.entity';
import { statusStringToNumber } from '../../utils/response-status-converter';

jest.mock('../workspace/workspace-files.service', () => ({
  WorkspaceFilesService: class {}
}));

describe('CoderTrainingService', () => {
  let service: CoderTrainingService;
  let coderTrainingRepository: Repository<CoderTraining>;
  let codingJobRepository: Repository<CodingJob>;
  let coderTrainingVariableRepository: Repository<CoderTrainingVariable>;
  let coderTrainingBundleRepository: Repository<CoderTrainingBundle>;
  let coderTrainingCoderRepository: Repository<CoderTrainingCoder>;
  let codingJobVariableBundleRepository: Repository<CodingJobVariableBundle>;
  let coderTrainingDiscussionResultRepository: Repository<CoderTrainingDiscussionResult>;
  let codingStatisticsService: {
    calculateCohensKappa: jest.Mock;
    calculateKappaVariableSummary: jest.Mock;
    calculateFleissKappa: jest.Mock;
    roundKappaCalculationResult: jest.Mock;
  };
  let missingsProfilesService: {
    getMissingsProfileDetails: jest.Mock;
    ensureDefaultMissingsProfile: jest.Mock;
    getNegativeMissingCodesForProfileOrDefault: jest.Mock;
    getMissingByIdForProfileOrDefault: jest.Mock;
    getMissingByCodeForProfileOrDefault: jest.Mock;
    resolveMissingsProfileId: jest.Mock;
  };

  const mockRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    save: jest.fn(),
    delete: jest.fn(),
    create: jest.fn()
  };

  const mockCodingJobService = {
    getAggregationThreshold: jest.fn().mockResolvedValue(null),
    getResponseMatchingMode: jest.fn().mockResolvedValue([ResponseMatchingFlag.IGNORE_WHITESPACE]),
    aggregateResponsesByValue: jest.fn().mockReturnValue([]),
    normalizeValue: jest.fn().mockReturnValue('normalized'),
    assertCodersCanCodeInWorkspace: jest.fn().mockResolvedValue(undefined),
    getCodingSchemeScoreForUnitCode: jest.fn().mockResolvedValue(null)
  };

  const mockWorkspaceFilesService = {
    getDerivedVariableMap: jest.fn().mockResolvedValue(new Map())
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRepository.count.mockResolvedValue(0);
    codingStatisticsService = {
      calculateCohensKappa: jest.fn(),
      calculateKappaVariableSummary: jest.fn(),
      roundKappaCalculationResult: jest.fn(result => result),
      calculateFleissKappa: jest.fn().mockReturnValue({
        fleissKappa: null,
        completeCaseCount: 0,
        raterCount: 0
      })
    };
    missingsProfilesService = {
      getMissingsProfileDetails: jest.fn(),
      ensureDefaultMissingsProfile: jest.fn().mockResolvedValue({
        parseMissings: () => [
          {
            id: 'mci', label: 'missing coding impossible', code: -97, score: 0
          },
          {
            id: 'mir', label: 'missing invalid response', code: -98, score: 0
          },
          {
            id: 'mbi_mbo', label: 'mbi / mbo', code: -99, score: 0
          }
        ]
      }),
      getNegativeMissingCodesForProfileOrDefault: jest.fn().mockResolvedValue(new Set([-97, -98, -99])),
      getMissingByIdForProfileOrDefault: jest.fn(async (_workspaceId, _profileId, missingId: string) => {
        if (missingId === 'mir') {
          return {
            id: 'mir', label: 'missing invalid response', code: -98, score: 0
          };
        }
        if (missingId === 'mci') {
          return {
            id: 'mci', label: 'missing coding impossible', code: -97, score: 0
          };
        }
        throw new BadRequestException(`Missing '${missingId}' not found`);
      }),
      getMissingByCodeForProfileOrDefault: jest.fn(async (_workspaceId, _profileId, code: number) => {
        if ([-97, -98, -99].includes(code)) {
          return {
            id: `missing-${code}`, label: `Missing ${code}`, code, score: 0
          };
        }
        throw new BadRequestException(`Missing code ${code} not found`);
      }),
      resolveMissingsProfileId: jest.fn(async (_workspaceId, profileId?: number | null) => profileId || 1)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoderTrainingService,
        { provide: getRepositoryToken(CodingJob), useValue: mockRepository },
        { provide: getRepositoryToken(CodingJobCoder), useValue: mockRepository },
        { provide: getRepositoryToken(CodingJobVariable), useValue: mockRepository },
        { provide: getRepositoryToken(CodingJobUnit), useValue: mockRepository },
        { provide: getRepositoryToken(CoderTraining), useValue: { ...mockRepository, save: jest.fn().mockResolvedValue({ id: 1 }) } },
        { provide: getRepositoryToken(CoderTrainingVariable), useValue: mockRepository },
        { provide: getRepositoryToken(CoderTrainingBundle), useValue: mockRepository },
        { provide: getRepositoryToken(CoderTrainingCoder), useValue: mockRepository },
        { provide: getRepositoryToken(CoderTrainingDiscussionResult), useValue: mockRepository },
        { provide: getRepositoryToken(CodingJobVariableBundle), useValue: mockRepository },
        { provide: getRepositoryToken(User), useValue: mockRepository },
        { provide: getRepositoryToken(ResponseEntity), useValue: mockRepository },
        { provide: getRepositoryToken(VariableBundle), useValue: mockRepository },
        { provide: getRepositoryToken(ChunkEntity), useValue: mockRepository },
        { provide: CodingJobService, useValue: mockCodingJobService },
        { provide: WorkspaceFilesService, useValue: mockWorkspaceFilesService },
        { provide: MissingsProfilesService, useValue: missingsProfilesService },
        { provide: CodingStatisticsService, useValue: codingStatisticsService },
        {
          provide: WorkspaceExclusionService,
          useValue: {
            resolveExclusionsForQueries: jest.fn().mockResolvedValue({
              globalIgnoredUnits: [],
              ignoredBooklets: [],
              testletIgnoredUnits: []
            })
          }
        }
      ]
    }).compile();

    service = module.get<CoderTrainingService>(CoderTrainingService);
    coderTrainingRepository = module.get<Repository<CoderTraining>>(getRepositoryToken(CoderTraining));
    codingJobRepository = module.get<Repository<CodingJob>>(getRepositoryToken(CodingJob));
    coderTrainingVariableRepository = module.get<Repository<CoderTrainingVariable>>(getRepositoryToken(CoderTrainingVariable));
    coderTrainingBundleRepository = module.get<Repository<CoderTrainingBundle>>(getRepositoryToken(CoderTrainingBundle));
    coderTrainingCoderRepository = module.get<Repository<CoderTrainingCoder>>(getRepositoryToken(CoderTrainingCoder));
    codingJobVariableBundleRepository = module.get<Repository<CodingJobVariableBundle>>(getRepositoryToken(CodingJobVariableBundle));
    coderTrainingDiscussionResultRepository = module.get<Repository<CoderTrainingDiscussionResult>>(getRepositoryToken(CoderTrainingDiscussionResult));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createCoderTrainingJobs', () => {
    it('should save configuration to relational tables with sample counts', async () => {
      const workspaceId = 1;
      const selectedCoders = [{ id: 10, name: 'Coder 1' }];
      const variableConfigs = [];
      const trainingLabel = 'Test Training';
      const assignedVariables = [{
        variableId: 'v1',
        unitName: 'u1',
        sampleCount: 5,
        includeDeriveError: true
      }];
      const assignedVariableBundles = [{ id: 2, name: 'Bundle 1', sampleCount: 20 }];

      mockRepository.find.mockResolvedValue([{
        id: 2,
        workspace_id: workspaceId,
        variables: []
      }]);
      mockRepository.save.mockResolvedValue({ id: 1 }); // For all saves

      await service.createCoderTrainingJobs(
        workspaceId,
        selectedCoders,
        variableConfigs,
        trainingLabel,
        undefined,
        assignedVariables,
        assignedVariableBundles
      );

      // Verify CoderTraining save
      expect(coderTrainingRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        workspace_id: workspaceId,
        label: trainingLabel
      }));

      // Verify CoderTrainingVariable save
      expect(coderTrainingVariableRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        coder_training_id: 1,
        variable_id: 'v1',
        unit_name: 'u1',
        sample_count: 5,
        include_derive_error: true
      }));

      // Verify CoderTrainingBundle save
      expect(coderTrainingBundleRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        coder_training_id: 1,
        variable_bundle_id: 2,
        sample_count: 20
      }));

      // Verify CoderTrainingCoder save
      expect(coderTrainingCoderRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        coder_training_id: 1,
        user_id: 10
      }));
    });

    it('should persist display options on the training and created jobs', async () => {
      const generatePackagesSpy = jest.spyOn(service, 'generateCoderTrainingPackages')
        .mockResolvedValue([{
          coderId: 10,
          coderName: 'Coder 1',
          responses: [{
            responseId: 101,
            unitAlias: 'Unit Alias',
            variableId: 'v1',
            unitName: 'u1',
            value: 'value',
            personLogin: 'login',
            personCode: 'code',
            personGroup: 'group',
            bookletName: 'booklet',
            variable: 'v1'
          }]
        }]);
      (coderTrainingRepository.save as jest.Mock).mockClear();
      (codingJobRepository.save as jest.Mock).mockClear();
      mockRepository.save.mockResolvedValue({ id: 100 });

      await service.createCoderTrainingJobs(
        1,
        [{ id: 10, name: 'Coder 1' }],
        [{ variableId: 'v1', unitId: 'u1', sampleCount: 1 }],
        'Training with display option',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
        false,
        true
      );

      expect(coderTrainingRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        show_score: true,
        allow_comments: false,
        suppress_general_instructions: true
      }));
      expect(codingJobRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        showScore: true,
        allowComments: false,
        suppressGeneralInstructions: true
      }));

      generatePackagesSpy.mockRestore();
    });

    it('should create job metadata and units for mixed manual and bundled training variables', async () => {
      const generatePackagesSpy = jest.spyOn(service, 'generateCoderTrainingPackages')
        .mockResolvedValue([{
          coderId: 10,
          coderName: 'Coder 1',
          responses: [
            {
              responseId: 101,
              unitAlias: 'Manual Unit',
              variableId: 'VAR',
              unitName: 'UNIT',
              value: 'manual value',
              personLogin: 'login-1',
              personCode: 'code-1',
              personGroup: 'group-1',
              bookletName: 'booklet-1',
              variable: 'VAR'
            },
            {
              responseId: 202,
              unitAlias: 'Bundle Unit',
              variableId: 'VAR2',
              unitName: 'UNIT2',
              value: 'bundle value',
              personLogin: 'login-2',
              personCode: 'code-2',
              personGroup: 'group-2',
              bookletName: 'booklet-2',
              variable: 'VAR2'
            }
          ]
        }]);
      const assignedVariables = [{ variableId: 'VAR', unitName: 'UNIT', sampleCount: 8 }];
      const assignedVariableBundles = [{ id: 5, name: 'Bundle', sampleCount: 4 }];

      mockRepository.find.mockReset();
      mockRepository.find.mockResolvedValue([{
        id: 5,
        name: 'Bundle',
        variables: [{ unitName: 'UNIT2', variableId: 'VAR2' }]
      }]);
      mockRepository.save.mockReset();
      mockRepository.save.mockImplementation(async entity => {
        if (entity instanceof CodingJob) {
          return { ...entity, id: 200 };
        }
        return entity;
      });

      const result = await service.createCoderTrainingJobs(
        1,
        [{ id: 10, name: 'Coder 1' }],
        [
          { variableId: 'VAR', unitId: 'UNIT', sampleCount: 8 },
          { variableId: 'VAR2', unitId: 'UNIT2', sampleCount: 4 }
        ],
        'Mixed Training',
        undefined,
        assignedVariables,
        assignedVariableBundles
      );

      expect(result.success).toBe(true);
      expect(result.jobsCreated).toBe(1);
      expect(coderTrainingVariableRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        variable_id: 'VAR',
        unit_name: 'UNIT',
        sample_count: 8
      }));
      expect(coderTrainingBundleRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        variable_bundle_id: 5,
        sample_count: 4
      }));
      expect(mockRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        coding_job_id: 200,
        variable_bundle_id: 5
      }));
      expect(mockRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        coding_job_id: 200,
        variable_id: 'VAR',
        unit_name: 'UNIT'
      }));
      expect(mockRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        coding_job_id: 200,
        variable_id: 'VAR2',
        unit_name: 'UNIT2'
      }));
      expect(mockRepository.save).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({
          response_id: 101,
          workspace_id: 1,
          variable_id: 'VAR',
          unit_name: 'UNIT',
          variable_bundle_id: null
        }),
        expect.objectContaining({
          response_id: 202,
          workspace_id: 1,
          variable_id: 'VAR2',
          unit_name: 'UNIT2',
          variable_bundle_id: 5
        })
      ]));

      generatePackagesSpy.mockRestore();
    });

    it('should generate packages from normalized selections when variable configs are missing bundle variables', async () => {
      const generatePackagesSpy = jest.spyOn(service, 'generateCoderTrainingPackages')
        .mockResolvedValue([]);
      mockRepository.find.mockResolvedValue([{
        id: 5,
        workspace_id: 1,
        variables: [{ unitName: 'UNIT2', variableId: 'VAR2' }]
      }]);
      const assignedVariableBundles = [{
        id: 5,
        name: 'Bundle',
        sampleCount: 4,
        variables: [{
          unitName: 'UNIT2',
          variableId: 'VAR2',
          includeDeriveError: true
        }]
      }];

      await service.createCoderTrainingJobs(
        1,
        [{ id: 10, name: 'Coder 1' }],
        [],
        'Bundle Training',
        undefined,
        [],
        assignedVariableBundles
      );

      expect(coderTrainingVariableRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        variable_id: 'VAR2',
        unit_name: 'UNIT2',
        sample_count: 4,
        include_derive_error: true
      }));
      expect(generatePackagesSpy).toHaveBeenCalledWith(
        1,
        [{ id: 10, name: 'Coder 1' }],
        [{
          variableId: 'VAR2',
          unitId: 'UNIT2',
          sampleCount: 4,
          includeDeriveError: true
        }],
        {
          caseSelectionMode: 'oldest_first',
          referenceTrainingIds: undefined,
          referenceMode: undefined,
          assignedVariableBundles
        }
      );

      generatePackagesSpy.mockRestore();
    });

    it('should reject variable bundles outside the workspace before creating the training', async () => {
      mockRepository.find.mockResolvedValue([]);
      (coderTrainingRepository.save as jest.Mock).mockClear();

      const result = await service.createCoderTrainingJobs(
        1,
        [{ id: 10, name: 'Coder 1' }],
        [],
        'Invalid Bundle Training',
        undefined,
        [],
        [{ id: 99, name: 'Foreign Bundle', sampleCount: 4 }]
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown variable bundle IDs for workspace 1: 99');
      expect(mockRepository.find).toHaveBeenCalledWith({
        where: {
          id: expect.any(Object),
          workspace_id: 1
        }
      });
      expect(coderTrainingRepository.save).not.toHaveBeenCalled();
    });

    it('should reject invalid variable bundle ids before creating the training', async () => {
      (coderTrainingRepository.save as jest.Mock).mockClear();

      const result = await service.createCoderTrainingJobs(
        1,
        [{ id: 10, name: 'Coder 1' }],
        [],
        'Invalid Bundle Training',
        undefined,
        [],
        [{ id: '99' as unknown as number, name: 'Invalid Bundle', sampleCount: 4 }]
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid variable bundle IDs: 99');
      expect(mockRepository.find).not.toHaveBeenCalled();
      expect(coderTrainingRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('updateCoderTraining', () => {
    it('should update configuration and recreate jobs when config changes', async () => {
      const workspaceId = 1;
      const trainingId = 1;
      const trainingLabel = 'Updated Training';
      const selectedCoders = [{ id: 11, name: 'Coder 2' }]; // Changed coder
      const variableConfigs = [];
      const assignedVariables = [];
      const assignedVariableBundles = [{ id: 3, name: 'Bundle 2', sampleCount: 15 }];

      const existingTraining = {
        id: trainingId,
        workspace_id: workspaceId,
        label: 'Old Label',
        coders: [{ user_id: 10 }], // Old coder
        variables: [],
        bundles: [],
        codingJobs: [{ id: 100 }]
      };

      mockRepository.findOne.mockResolvedValue(existingTraining);
      mockRepository.find.mockResolvedValue([{
        id: 3,
        workspace_id: workspaceId,
        variables: []
      }]);
      mockRepository.save.mockResolvedValue({ id: trainingId });

      await service.updateCoderTraining(
        workspaceId,
        trainingId,
        trainingLabel,
        selectedCoders,
        variableConfigs,
        undefined,
        assignedVariables,
        assignedVariableBundles
      );

      // Verify deletion of old relations
      expect(coderTrainingCoderRepository.delete).toHaveBeenCalledWith({ coder_training_id: trainingId });

      // Verify saving of new bundle with sample count
      expect(coderTrainingBundleRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        coder_training_id: trainingId,
        variable_bundle_id: 3,
        sample_count: 15
      }));
    });

    it('should update display options on an existing training without recreating jobs', async () => {
      const existingJob = {
        id: 100,
        showScore: false,
        allowComments: true,
        suppressGeneralInstructions: false
      };
      const existingTraining = {
        id: 1,
        workspace_id: 1,
        label: 'Old Label',
        case_selection_mode: 'random',
        reference_training_ids: [44],
        reference_mode: 'same',
        show_score: false,
        allow_comments: true,
        suppress_general_instructions: false,
        coders: [{ user_id: 10 }],
        variables: [{ variable_id: 'v1', unit_name: 'u1', sample_count: 5 }],
        bundles: [],
        codingJobs: [existingJob]
      };

      mockRepository.findOne.mockResolvedValue(existingTraining);
      mockRepository.count.mockRejectedValue(new Error('Display-only update must not check coding progress'));
      (coderTrainingRepository.save as jest.Mock).mockClear();
      (coderTrainingCoderRepository.delete as jest.Mock).mockClear();
      (codingJobRepository.save as jest.Mock).mockClear();
      mockRepository.save.mockResolvedValue({ id: 100 });

      await service.updateCoderTraining(
        1,
        1,
        'Updated Label',
        [{ id: 10, name: 'Coder 1' }],
        [{ variableId: 'v1', unitId: 'u1', sampleCount: 5 }],
        undefined,
        [{ variableId: 'v1', unitName: 'u1', sampleCount: 5 }],
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        true,
        false,
        true
      );

      expect(coderTrainingRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        show_score: true,
        allow_comments: false,
        suppress_general_instructions: true,
        reference_training_ids: [44],
        reference_mode: 'same'
      }));
      expect(coderTrainingCoderRepository.delete).not.toHaveBeenCalled();
      expect(mockRepository.count).not.toHaveBeenCalled();
      expect(codingJobRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        id: 100,
        showScore: true,
        allowComments: false,
        suppressGeneralInstructions: true
      }));
    });

    it('should treat legacy default and explicit default profile as the same training profile', async () => {
      const existingTraining = {
        id: 1,
        workspace_id: 1,
        label: 'Old Label',
        coders: [{ user_id: 10 }],
        variables: [],
        bundles: [],
        codingJobs: [
          { id: 100, missings_profile_id: null },
          { id: 101, missings_profile_id: 1 }
        ]
      };

      mockRepository.findOne.mockResolvedValue(existingTraining);
      mockRepository.count.mockRejectedValue(new Error('Equivalent profiles must not trigger recreation'));

      const result = await service.updateCoderTraining(
        1,
        1,
        'Updated Label',
        [{ id: 10, name: 'Coder 1' }],
        [],
        undefined,
        [],
        []
      );

      expect(result.success).toBe(true);
      expect(mockRepository.count).not.toHaveBeenCalled();
      expect(coderTrainingCoderRepository.delete).not.toHaveBeenCalled();
    });

    it('should normalize mixed training job profiles when an explicit target profile is selected', async () => {
      const generatePackagesSpy = jest.spyOn(service, 'generateCoderTrainingPackages')
        .mockResolvedValue([]);
      const existingTraining = {
        id: 1,
        workspace_id: 1,
        label: 'Old Label',
        coders: [{ user_id: 10 }],
        variables: [],
        bundles: [],
        codingJobs: [
          { id: 100, missings_profile_id: null },
          { id: 101, missings_profile_id: 77 }
        ]
      };

      mockRepository.findOne.mockResolvedValue(existingTraining);
      mockRepository.delete.mockClear();

      const result = await service.updateCoderTraining(
        1,
        1,
        'Updated Label',
        [{ id: 10, name: 'Coder 1' }],
        [],
        1,
        [],
        []
      );

      expect(result.success).toBe(true);
      expect(mockRepository.delete).toHaveBeenCalledWith({ coding_job_id: 100 });
      expect(mockRepository.delete).toHaveBeenCalledWith({ coding_job_id: 101 });
      expect(mockRepository.delete).toHaveBeenCalledWith(100);
      expect(mockRepository.delete).toHaveBeenCalledWith(101);
      expect(generatePackagesSpy).toHaveBeenCalledWith(
        1,
        [{ id: 10, name: 'Coder 1' }],
        [],
        {
          caseSelectionMode: 'oldest_first',
          referenceTrainingIds: [],
          referenceMode: undefined
        }
      );

      generatePackagesSpy.mockRestore();
    });

    it('should recreate jobs when only the case selection mode changes', async () => {
      const generatePackagesSpy = jest.spyOn(service, 'generateCoderTrainingPackages')
        .mockResolvedValue([]);
      const existingTraining = {
        id: 1,
        workspace_id: 1,
        label: 'Old Label',
        case_selection_mode: 'oldest_first',
        coders: [{ user_id: 10 }],
        variables: [{ variable_id: 'v1', unit_name: 'u1', sample_count: 5 }],
        bundles: [],
        codingJobs: [{ id: 100 }]
      };

      mockRepository.findOne.mockResolvedValue(existingTraining);
      mockRepository.delete.mockClear();
      (coderTrainingRepository.save as jest.Mock).mockClear();

      const result = await service.updateCoderTraining(
        1,
        1,
        'Updated Label',
        [{ id: 10, name: 'Coder 1' }],
        [{ variableId: 'v1', unitId: 'u1', sampleCount: 5 }],
        undefined,
        [{ variableId: 'v1', unitName: 'u1', sampleCount: 5 }],
        [],
        undefined,
        'newest_first'
      );

      expect(result.success).toBe(true);
      expect(coderTrainingRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        case_selection_mode: 'newest_first'
      }));
      expect(mockRepository.count).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.arrayContaining([
          expect.objectContaining({ coding_job_id: expect.any(Object), code: expect.any(Object) })
        ])
      }));
      expect(mockRepository.delete).toHaveBeenCalledWith({ coding_job_id: 100 });
      expect(mockRepository.delete).toHaveBeenCalledWith(100);
      expect(generatePackagesSpy).toHaveBeenCalledWith(
        1,
        [{ id: 10, name: 'Coder 1' }],
        [{ variableId: 'v1', unitId: 'u1', sampleCount: 5 }],
        {
          caseSelectionMode: 'newest_first',
          referenceTrainingIds: [],
          referenceMode: undefined
        }
      );

      generatePackagesSpy.mockRestore();
    });

    it('should reject destructive updates when the training already has coding progress', async () => {
      const generatePackagesSpy = jest.spyOn(service, 'generateCoderTrainingPackages')
        .mockResolvedValue([]);
      const existingTraining = {
        id: 1,
        workspace_id: 1,
        label: 'Old Label',
        case_selection_mode: 'oldest_first',
        coders: [{ user_id: 10 }],
        variables: [{ variable_id: 'v1', unit_name: 'u1', sample_count: 5 }],
        bundles: [],
        codingJobs: [{ id: 100 }]
      };

      mockRepository.findOne.mockResolvedValue(existingTraining);
      mockRepository.count.mockResolvedValueOnce(1);
      mockRepository.delete.mockClear();
      (coderTrainingRepository.save as jest.Mock).mockClear();

      const result = await service.updateCoderTraining(
        1,
        1,
        'Updated Label',
        [{ id: 10, name: 'Coder 1' }],
        [{ variableId: 'v1', unitId: 'u1', sampleCount: 5 }],
        undefined,
        [{ variableId: 'v1', unitName: 'u1', sampleCount: 5 }],
        [],
        undefined,
        'newest_first'
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('bereits bearbeitet');
      expect(coderTrainingRepository.save).not.toHaveBeenCalled();
      expect(mockRepository.delete).not.toHaveBeenCalled();
      expect(generatePackagesSpy).not.toHaveBeenCalled();

      generatePackagesSpy.mockRestore();
    });

    it('should reject destructive updates when discussion results already exist', async () => {
      const generatePackagesSpy = jest.spyOn(service, 'generateCoderTrainingPackages')
        .mockResolvedValue([]);
      const existingTraining = {
        id: 1,
        workspace_id: 1,
        label: 'Old Label',
        case_selection_mode: 'oldest_first',
        coders: [{ user_id: 10 }],
        variables: [{ variable_id: 'v1', unit_name: 'u1', sample_count: 5 }],
        bundles: [],
        codingJobs: [{ id: 100 }]
      };

      mockRepository.findOne.mockResolvedValue(existingTraining);
      mockRepository.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1);
      mockRepository.delete.mockClear();
      (coderTrainingRepository.save as jest.Mock).mockClear();

      const result = await service.updateCoderTraining(
        1,
        1,
        'Updated Label',
        [{ id: 10, name: 'Coder 1' }],
        [{ variableId: 'v1', unitId: 'u1', sampleCount: 5 }],
        undefined,
        [{ variableId: 'v1', unitName: 'u1', sampleCount: 5 }],
        [],
        undefined,
        'newest_first'
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('bereits bearbeitet');
      expect(mockRepository.count).toHaveBeenCalledWith({
        where: {
          workspace_id: 1,
          training_id: 1
        }
      });
      expect(coderTrainingRepository.save).not.toHaveBeenCalled();
      expect(mockRepository.delete).not.toHaveBeenCalled();
      expect(generatePackagesSpy).not.toHaveBeenCalled();

      generatePackagesSpy.mockRestore();
    });

    it('should recreate jobs when only the reference training selection changes', async () => {
      const generatePackagesSpy = jest.spyOn(service, 'generateCoderTrainingPackages')
        .mockResolvedValue([]);
      const existingTraining = {
        id: 1,
        workspace_id: 1,
        label: 'Old Label',
        case_selection_mode: 'oldest_first',
        reference_training_ids: null,
        reference_mode: null,
        coders: [{ user_id: 10 }],
        variables: [{ variable_id: 'v1', unit_name: 'u1', sample_count: 5 }],
        bundles: [],
        codingJobs: [{ id: 100 }]
      };

      mockRepository.findOne.mockResolvedValue(existingTraining);
      mockRepository.delete.mockClear();
      (coderTrainingRepository.save as jest.Mock).mockClear();

      const result = await service.updateCoderTraining(
        1,
        1,
        'Updated Label',
        [{ id: 10, name: 'Coder 1' }],
        [{ variableId: 'v1', unitId: 'u1', sampleCount: 5 }],
        undefined,
        [{ variableId: 'v1', unitName: 'u1', sampleCount: 5 }],
        [],
        undefined,
        'oldest_first',
        [44],
        'same'
      );

      expect(result.success).toBe(true);
      expect(coderTrainingRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        reference_training_ids: [44],
        reference_mode: 'same'
      }));
      expect(mockRepository.delete).toHaveBeenCalledWith({ coding_job_id: 100 });
      expect(mockRepository.delete).toHaveBeenCalledWith(100);
      expect(generatePackagesSpy).toHaveBeenCalledWith(
        1,
        [{ id: 10, name: 'Coder 1' }],
        [{ variableId: 'v1', unitId: 'u1', sampleCount: 5 }],
        {
          caseSelectionMode: 'oldest_first',
          referenceTrainingIds: [44],
          referenceMode: 'same'
        }
      );

      generatePackagesSpy.mockRestore();
    });

    it('should keep existing assignments when update omits optional assignment fields', async () => {
      const generatePackagesSpy = jest.spyOn(service, 'generateCoderTrainingPackages');
      const existingJob = { id: 100, suppressGeneralInstructions: false };
      const existingTraining = {
        id: 1,
        workspace_id: 1,
        label: 'Old Label',
        case_ordering_mode: 'alternating',
        suppress_general_instructions: false,
        coders: [{ user_id: 10 }],
        variables: [{ variable_id: 'v1', unit_name: 'u1', sample_count: 5 }],
        bundles: [{
          variable_bundle_id: 5,
          sample_count: 4,
          case_ordering_mode: 'alternating'
        }],
        codingJobs: [existingJob]
      };

      mockRepository.findOne.mockResolvedValue(existingTraining);
      mockRepository.find.mockResolvedValue([{
        id: 5,
        workspace_id: 1,
        variables: []
      }]);
      mockRepository.delete.mockClear();
      mockRepository.save.mockClear();

      const result = await service.updateCoderTraining(
        1,
        1,
        'Updated Label',
        [{ id: 10, name: 'Coder 1' }],
        [{ variableId: 'v1', unitId: 'u1', sampleCount: 5 }]
      );

      expect(result.success).toBe(true);
      expect(mockRepository.delete).not.toHaveBeenCalled();
      expect(generatePackagesSpy).not.toHaveBeenCalled();
      expect(codingJobRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        id: 100,
        suppressGeneralInstructions: false
      }));

      generatePackagesSpy.mockRestore();
    });

    it('should recreate jobs with existing assignments when only global ordering changes', async () => {
      const generatePackagesSpy = jest.spyOn(service, 'generateCoderTrainingPackages')
        .mockResolvedValue([{
          coderId: 10,
          coderName: 'Coder 1',
          responses: [
            {
              responseId: 2,
              unitAlias: 'Unit',
              variableId: 'b',
              unitName: 'Unit',
              value: 'value',
              personLogin: 'person-1',
              personCode: '1',
              personGroup: 'group-1',
              bookletName: 'booklet',
              variable: 'b'
            },
            {
              responseId: 1,
              unitAlias: 'Unit',
              variableId: 'a',
              unitName: 'Unit',
              value: 'value',
              personLogin: 'person-1',
              personCode: '1',
              personGroup: 'group-1',
              bookletName: 'booklet',
              variable: 'a'
            }
          ]
        }]);
      const existingTraining = {
        id: 1,
        workspace_id: 1,
        label: 'Old Label',
        case_ordering_mode: 'continuous',
        coders: [{ user_id: 10 }],
        variables: [{ variable_id: 'manual', unit_name: 'Manual Unit', sample_count: 3 }],
        bundles: [{
          variable_bundle_id: 5,
          sample_count: 4,
          case_ordering_mode: null
        }],
        codingJobs: [{ id: 100 }]
      };

      mockRepository.findOne.mockResolvedValue(existingTraining);
      mockRepository.find.mockResolvedValue([{
        id: 5,
        name: 'Bundle',
        variables: [
          { unitName: 'Unit', variableId: 'a' },
          { unitName: 'Unit', variableId: 'b' }
        ]
      }]);
      mockRepository.save.mockImplementation(async entity => {
        if (entity instanceof CodingJob) {
          return { ...entity, id: 200 };
        }
        return entity;
      });
      mockRepository.save.mockClear();
      mockRepository.delete.mockClear();

      const result = await service.updateCoderTraining(
        1,
        1,
        'Updated Label',
        [{ id: 10, name: 'Coder 1' }],
        [
          { variableId: 'a', unitId: 'Unit', sampleCount: 4 },
          { variableId: 'b', unitId: 'Unit', sampleCount: 4 }
        ],
        undefined,
        undefined,
        undefined,
        'alternating'
      );

      expect(result.success).toBe(true);
      expect(coderTrainingVariableRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        coder_training_id: 1,
        variable_id: 'manual',
        unit_name: 'Manual Unit',
        sample_count: 3
      }));
      expect(coderTrainingBundleRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        coder_training_id: 1,
        variable_bundle_id: 5,
        sample_count: 4,
        case_ordering_mode: null
      }));
      expect(codingJobRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        workspace_id: 1,
        training_id: 1,
        case_ordering_mode: 'alternating'
      }));
      expect(codingJobVariableBundleRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        coding_job_id: 200,
        variable_bundle_id: 5,
        case_ordering_mode: null
      }));

      generatePackagesSpy.mockRestore();
    });

    it('should recreate jobs when a bundle ordering mode changes', async () => {
      const generatePackagesSpy = jest.spyOn(service, 'generateCoderTrainingPackages')
        .mockResolvedValue([{
          coderId: 10,
          coderName: 'Coder 1',
          responses: [
            {
              responseId: 3,
              unitAlias: 'Unit',
              variableId: 'b',
              unitName: 'Unit',
              value: 'value',
              personLogin: 'person-2',
              personCode: '2',
              personGroup: 'group-2',
              bookletName: 'booklet',
              variable: 'b'
            },
            {
              responseId: 1,
              unitAlias: 'Unit',
              variableId: 'a',
              unitName: 'Unit',
              value: 'value',
              personLogin: 'person-1',
              personCode: '1',
              personGroup: 'group-1',
              bookletName: 'booklet',
              variable: 'a'
            },
            {
              responseId: 4,
              unitAlias: 'Unit',
              variableId: 'a',
              unitName: 'Unit',
              value: 'value',
              personLogin: 'person-2',
              personCode: '2',
              personGroup: 'group-2',
              bookletName: 'booklet',
              variable: 'a'
            },
            {
              responseId: 2,
              unitAlias: 'Unit',
              variableId: 'b',
              unitName: 'Unit',
              value: 'value',
              personLogin: 'person-1',
              personCode: '1',
              personGroup: 'group-1',
              bookletName: 'booklet',
              variable: 'b'
            }
          ]
        }]);
      const existingTraining = {
        id: 1,
        workspace_id: 1,
        label: 'Old Label',
        case_ordering_mode: 'continuous',
        coders: [{ user_id: 10 }],
        variables: [],
        bundles: [{
          variable_bundle_id: 5,
          sample_count: 4,
          case_ordering_mode: 'continuous'
        }],
        codingJobs: [{ id: 100 }]
      };

      mockRepository.findOne.mockResolvedValue(existingTraining);
      mockRepository.find.mockResolvedValue([{
        id: 5,
        name: 'Bundle',
        variables: [
          { unitName: 'Unit', variableId: 'a' },
          { unitName: 'Unit', variableId: 'b' }
        ]
      }]);
      mockRepository.save.mockImplementation(async entity => {
        if (entity instanceof CodingJob) {
          return { ...entity, id: 200 };
        }
        return entity;
      });
      mockRepository.save.mockClear();
      mockRepository.delete.mockClear();

      const result = await service.updateCoderTraining(
        1,
        1,
        'Updated Label',
        [{ id: 10, name: 'Coder 1' }],
        [
          { variableId: 'a', unitId: 'Unit', sampleCount: 4 },
          { variableId: 'b', unitId: 'Unit', sampleCount: 4 }
        ],
        undefined,
        [],
        [{
          id: 5,
          name: 'Bundle',
          sampleCount: 4,
          caseOrderingMode: 'alternating'
        }],
        'continuous'
      );

      expect(result.success).toBe(true);
      expect(coderTrainingBundleRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        coder_training_id: 1,
        variable_bundle_id: 5,
        sample_count: 4,
        case_ordering_mode: 'alternating'
      }));
      expect(mockRepository.delete).toHaveBeenCalledWith({ coding_job_id: 100 });
      expect(mockRepository.delete).toHaveBeenCalledWith(100);
      expect(mockRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        coding_job_id: 200,
        variable_bundle_id: 5,
        case_ordering_mode: 'alternating'
      }));

      const savedUnits = (mockRepository.save as jest.Mock).mock.calls
        .map(([arg]) => arg)
        .find(arg => Array.isArray(arg) && arg.every(unit => unit instanceof CodingJobUnit)) as CodingJobUnit[];
      expect(savedUnits.map(unit => unit.response_id)).toEqual([1, 2, 4, 3]);
      expect(savedUnits.map(unit => unit.workspace_id)).toEqual([1, 1, 1, 1]);
      expect(savedUnits.map(unit => unit.person_group)).toEqual(['group-1', 'group-1', 'group-2', 'group-2']);

      generatePackagesSpy.mockRestore();
    });

    it('should not treat legacy bundle variables as changed when editing without assignment changes', async () => {
      const existingTraining = {
        id: 1,
        workspace_id: 1,
        label: 'Old Label',
        case_ordering_mode: 'continuous',
        case_selection_mode: 'oldest_first',
        coders: [{ user_id: 10 }],
        variables: [],
        bundles: [{
          variable_bundle_id: 5,
          sample_count: 4,
          case_ordering_mode: null,
          bundle: {
            id: 5,
            name: 'Bundle',
            variables: [{ unitName: 'UNIT2', variableId: 'VAR2' }]
          }
        }],
        codingJobs: [{ id: 100 }]
      };

      mockRepository.findOne.mockResolvedValue(existingTraining);
      mockRepository.find.mockResolvedValue([{
        id: 5,
        workspace_id: 1,
        variables: [{ unitName: 'UNIT2', variableId: 'VAR2' }]
      }]);
      mockRepository.count.mockRejectedValue(new Error('Unchanged legacy bundle variables must not trigger progress checks'));
      (coderTrainingRepository.save as jest.Mock).mockClear();
      (coderTrainingCoderRepository.delete as jest.Mock).mockClear();
      const generatePackagesSpy = jest.spyOn(service, 'generateCoderTrainingPackages');

      const result = await service.updateCoderTraining(
        1,
        1,
        'Updated Label',
        [{ id: 10, name: 'Coder 1' }],
        [{ variableId: 'VAR2', unitId: 'UNIT2', sampleCount: 4 }],
        undefined,
        [],
        [{
          id: 5,
          name: 'Bundle',
          sampleCount: 4,
          variables: [{ unitName: 'UNIT2', variableId: 'VAR2', sampleCount: 4 }]
        }]
      );

      expect(result.success).toBe(true);
      expect(mockRepository.count).not.toHaveBeenCalled();
      expect(coderTrainingCoderRepository.delete).not.toHaveBeenCalled();
      expect(generatePackagesSpy).not.toHaveBeenCalled();

      generatePackagesSpy.mockRestore();
    });
  });

  describe('getCoderTrainings', () => {
    it('should map relations to DTO including sample counts', async () => {
      const workspaceId = 1;
      const trainings = [{
        id: 1,
        workspace_id: workspaceId,
        label: 'Training 1',
        created_at: new Date(),
        updated_at: new Date(),
        show_score: true,
        allow_comments: false,
        suppress_general_instructions: true,
        codingJobs: [],
        variables: [{ variable_id: 'v1', unit_name: 'u1', sample_count: 5 }],
        bundles: [{ variable_bundle_id: 2, sample_count: 25, bundle: { name: 'Bundle 1' } }],
        coders: [{ user_id: 10 }]
      }];

      mockRepository.find.mockResolvedValue(trainings);

      const result = await service.getCoderTrainings(workspaceId);

      expect(result).toHaveLength(1);
      expect(result[0].assigned_variables).toHaveLength(1);
      expect(result[0].assigned_variables[0]).toEqual({
        variableId: 'v1',
        unitName: 'u1',
        sampleCount: 5
      });
      expect(result[0].assigned_variable_bundles).toHaveLength(1);
      expect(result[0].assigned_variable_bundles[0]).toEqual({
        id: 2,
        name: 'Bundle 1',
        sampleCount: 25
      });
      expect(result[0].assigned_coders).toEqual([10]);
      expect(result[0].show_score).toBe(true);
      expect(result[0].allow_comments).toBe(false);
      expect(result[0].suppress_general_instructions).toBe(true);
    });
  });

  describe('getTrainingCodingComparison', () => {
    const emptyExclusions = {
      globalIgnoredUnits: [],
      ignoredBooklets: [],
      testletIgnoredUnits: []
    };

    const createRawQueryBuilder = <T>(rawRows: T[]) => ({
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(rawRows)
    });

    const createComparisonUnit = (
      responseId: number,
      overrides: Partial<CodingJobUnit> = {}
    ) => ({
      response_id: responseId,
      unit_name: 'Unit A',
      unit_alias: 'Unit A',
      variable_id: 'VAR',
      booklet_name: 'Booklet',
      person_login: `person-${responseId}`,
      person_code: `code-${responseId}`,
      person_group: 'group',
      code: null,
      score: null,
      notes: null,
      coding_issue_option: null,
      ...overrides
    } as CodingJobUnit);

    it('should apply missing profile scores to joke answers and technical problems in comparison rows', async () => {
      missingsProfilesService.getMissingsProfileDetails.mockResolvedValue({
        parseMissings: () => [
          {
            id: 'mci', label: 'technical problem', code: -41, score: 3
          },
          {
            id: 'mir', label: 'invalid joke answer', code: -31, score: 7
          },
          {
            id: 'mbi_mbo', label: 'missing by omission', code: -99, score: 1
          }
        ]
      });
      missingsProfilesService.getNegativeMissingCodesForProfileOrDefault
        .mockResolvedValueOnce(new Set([-97, -98, -99]))
        .mockResolvedValueOnce(new Set([-41, -31, -99]));
      mockRepository.find.mockResolvedValue([{
        id: 5,
        workspace_id: 1,
        label: 'Training A',
        codingJobs: [{
          id: 21,
          missings_profile_id: 77,
          codingJobCoders: [{ user: { username: 'Coder A' } }],
          codingJobUnits: [
            createComparisonUnit(101, { coding_issue_option: -3 }),
            createComparisonUnit(102, { coding_issue_option: -4 }),
            createComparisonUnit(103, { code: -99 })
          ]
        }]
      }]);

      const result = await service.getTrainingCodingComparison(1, [5]);

      const coderResultsByResponseId = new Map(
        result.map(row => [row.responseId, row.coders[0]])
      );
      expect(coderResultsByResponseId.get(101)).toEqual(expect.objectContaining({
        code: '-31',
        score: 7,
        codingIssueOption: -3
      }));
      expect(coderResultsByResponseId.get(102)).toEqual(expect.objectContaining({
        code: '-41',
        score: 3,
        codingIssueOption: -4
      }));
      expect(coderResultsByResponseId.get(103)).toEqual(expect.objectContaining({
        code: '-99',
        score: 1,
        codingIssueOption: null
      }));
    });

    it('returns a paged between-training comparison with global summary metrics', async () => {
      const fullComparisonSpy = jest.spyOn(service, 'getTrainingCodingComparison').mockResolvedValue([]);
      const serviceInternals = service as unknown as {
        getTrainingComparisonAvailableCodersForJobs: () => Promise<unknown>;
        getTrainingComparisonAggregateRows: () => Promise<unknown>;
        getTrainingComparisonRowsForResponseIds: () => Promise<unknown>;
      };
      (coderTrainingRepository.find as jest.Mock).mockResolvedValueOnce([
        {
          id: 1,
          label: 'Training A',
          codingJobs: [{
            id: 11,
            name: 'job-a',
            training_id: 1,
            missings_profile_id: null,
            codingJobCoders: [{ user: { username: 'Coder A' } }]
          }]
        },
        {
          id: 2,
          label: 'Training B',
          codingJobs: [{
            id: 21,
            name: 'job-b',
            training_id: 2,
            missings_profile_id: null,
            codingJobCoders: [{ user: { username: 'Coder B' } }]
          }]
        }
      ]);
      jest.spyOn(serviceInternals, 'getTrainingComparisonAvailableCodersForJobs').mockResolvedValue([
        {
          trainingId: 1,
          trainingLabel: 'Training A',
          coderId: 11,
          coderName: 'Coder A'
        },
        {
          trainingId: 2,
          trainingLabel: 'Training B',
          coderId: 21,
          coderName: 'Coder B'
        }
      ]);
      jest.spyOn(serviceInternals, 'getTrainingComparisonAggregateRows').mockResolvedValue([
        {
          responseId: 101,
          unitName: 'Unit A',
          variableId: 'VAR',
          personCode: 'P1',
          personLogin: 'login-a',
          personGroup: 'group',
          bookletName: 'booklet',
          completeCodeCount: 2,
          distinctCodeCount: 2,
          hasNotes: true
        },
        {
          responseId: 102,
          unitName: 'Unit B',
          variableId: 'VAR',
          personCode: 'P2',
          personLogin: 'login-b',
          personGroup: 'group',
          bookletName: 'booklet',
          completeCodeCount: 2,
          distinctCodeCount: 1,
          hasNotes: false
        },
        {
          responseId: 103,
          unitName: 'Unit C',
          variableId: 'VAR',
          personCode: 'P3',
          personLogin: 'login-c',
          personGroup: 'group',
          bookletName: 'booklet',
          completeCodeCount: 1,
          distinctCodeCount: 1,
          hasNotes: false
        }
      ]);
      const pageRowsSpy = jest.spyOn(serviceInternals, 'getTrainingComparisonRowsForResponseIds').mockResolvedValue([
        {
          responseId: 102,
          unitName: 'Unit B',
          variableId: 'VAR',
          personCode: 'P2',
          personLogin: 'login-b',
          personGroup: 'group',
          bookletName: 'booklet',
          testPerson: 'login-b (group) - booklet',
          coders: [
            {
              trainingId: 1,
              trainingLabel: 'Training A',
              coderId: 11,
              coderName: 'Coder A',
              code: '1',
              score: 1,
              notes: null,
              codingIssueOption: null
            },
            {
              trainingId: 2,
              trainingLabel: 'Training B',
              coderId: 21,
              coderName: 'Coder B',
              code: '1',
              score: 1,
              notes: null,
              codingIssueOption: null
            }
          ]
        }
      ]);

      const result = await service.getTrainingCodingComparisonPage(1, [1, 2], {
        page: 2,
        limit: 1,
        sortBy: 'unitName',
        sortDirection: 'desc',
        selectedCoderKeys: ['1_11', '2_21']
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].responseId).toBe(102);
      expect(result.total).toBe(3);
      expect(result.totalPages).toBe(3);
      expect(result.summary).toEqual({
        visibleRows: 3,
        comparableRows: 2,
        matchingRows: 1,
        matchingPercentage: 50,
        incompleteRows: 1,
        notComparableRows: 0,
        deviationRows: 1,
        completionRate: 67
      });
      expect(result.availableCoders).toEqual([
        {
          trainingId: 1,
          trainingLabel: 'Training A',
          coderId: 11,
          coderName: 'Coder A'
        },
        {
          trainingId: 2,
          trainingLabel: 'Training B',
          coderId: 21,
          coderName: 'Coder B'
        }
      ]);
      expect(fullComparisonSpy).not.toHaveBeenCalled();
      expect(pageRowsSpy).toHaveBeenCalledWith(
        1,
        [1, 2],
        [102],
        expect.any(Array),
        expect.any(Map),
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('normalizes selected coder keys before calculating between-training slots', () => {
      const serviceInternals = service as unknown as {
        getTrainingComparisonSelection: (
          selectedTrainingIds: number[],
          selectedCoderKeys: string[],
          availableCoders: Array<{
            trainingId: number;
            trainingLabel: string;
            coderId: number;
            coderName: string;
          }>
        ) => { selectedJobIds: number[]; slotCount: number };
      };

      const result = serviceInternals.getTrainingComparisonSelection(
        [1, 2, 2, 3],
        ['1_11', '1_11', '2_21', '2_999', '4_41', 'invalid'],
        [
          {
            trainingId: 1,
            trainingLabel: 'Training A',
            coderId: 11,
            coderName: 'Coder A'
          },
          {
            trainingId: 2,
            trainingLabel: 'Training B',
            coderId: 21,
            coderName: 'Coder B'
          }
        ]
      );

      expect(result).toEqual({
        selectedJobIds: [11, 21],
        slotCount: 3
      });
    });

    it('builds aggregate SQL for paged between-training comparison metrics', async () => {
      const rawRows = [{
        responseId: '101',
        unitName: 'Unit A',
        variableId: 'VAR',
        personCode: 'P1',
        personLogin: 'login-a',
        personGroup: 'group',
        bookletName: 'booklet',
        completeCodeCount: '2',
        distinctCodeCount: '1',
        hasNotes: 'true'
      }];
      const qb = createRawQueryBuilder(rawRows);
      const serviceInternals = service as unknown as {
        getTrainingComparisonAggregateRows: (
          workspaceId: number,
          trainingIds: number[],
          selectedJobIds: number[],
          missingCodesByJobId: Map<number, {
            mirCode: number;
            mciCode: number;
            negativeCodes: Set<number>;
            scoresByCode: Map<number, number | null>;
          }>,
          defaultMissingCodeContext: {
            mirCode: number;
            mciCode: number;
            negativeCodes: Set<number>;
            scoresByCode: Map<number, number | null>;
          },
          exclusions: typeof emptyExclusions
        ) => Promise<typeof rawRows>;
      };
      (mockRepository as { createQueryBuilder?: jest.Mock }).createQueryBuilder = jest.fn().mockReturnValue(qb);

      const result = await serviceInternals.getTrainingComparisonAggregateRows(
        1,
        [5],
        [11],
        new Map([
          [11, {
            mirCode: -31,
            mciCode: -41,
            negativeCodes: new Set([-31, -41]),
            scoresByCode: new Map([[-31, 7], [-41, 3]])
          }]
        ]),
        {
          mirCode: -98,
          mciCode: -97,
          negativeCodes: new Set([-98, -97, -99]),
          scoresByCode: new Map([[-98, 0], [-97, 0], [-99, 0]])
        },
        emptyExclusions
      );

      const aggregateSql = qb.addSelect.mock.calls.map(([sql]) => String(sql)).join('\n');
      expect(result).toEqual(rawRows);
      expect((mockRepository as { createQueryBuilder?: jest.Mock }).createQueryBuilder).toHaveBeenCalledWith('cju');
      expect(qb.groupBy).toHaveBeenCalledWith('cju.response_id');
      expect(qb.setParameter).toHaveBeenCalledWith('trainingComparisonSelectedJobIds', [11]);
      expect(aggregateSql).toContain('COUNT(DISTINCT cj.id) FILTER');
      expect(aggregateSql).toContain('COUNT(DISTINCT (CASE');
      expect(aggregateSql).toContain('WHEN cju.code = -3 OR cju.coding_issue_option = -3');
      expect(aggregateSql).toContain("WHEN 11 THEN '-31'");
      expect(aggregateSql).toContain("ELSE '-98'");
      expect(aggregateSql).toContain('BOOL_OR');
    });

    it('loads only requested between-training detail rows and maps display missing codes', async () => {
      const rawRows = [
        {
          trainingId: 1,
          trainingLabel: 'Training A',
          jobId: 11,
          coderName: null,
          missingsProfileId: null,
          responseId: 101,
          unitName: 'Unit A',
          variableId: 'VAR',
          personCode: 'P1',
          personLogin: 'login-a',
          personGroup: 'group',
          bookletName: 'booklet',
          code: null,
          score: null,
          notes: 'note',
          codingIssueOption: -3
        },
        {
          trainingId: 2,
          trainingLabel: 'Training B',
          jobId: 21,
          coderName: 'Coder B',
          missingsProfileId: null,
          responseId: 101,
          unitName: 'Unit A',
          variableId: 'VAR',
          personCode: 'P1',
          personLogin: 'login-a',
          personGroup: 'group',
          bookletName: 'booklet',
          code: -4,
          score: null,
          notes: null,
          codingIssueOption: null
        }
      ];
      const qb = createRawQueryBuilder(rawRows);
      const serviceInternals = service as unknown as {
        getTrainingComparisonRowsForResponseIds: (
          workspaceId: number,
          trainingIds: number[],
          responseIds: number[],
          pageCandidates: Array<{
            responseId: number;
            unitName: string;
            variableId: string;
            personCode: string;
            personLogin: string;
            personGroup: string;
            bookletName: string;
            testPerson: string;
            status: string;
            hasNotes: boolean;
          }>,
          missingCodesByJobId: Map<number, {
            mirCode: number;
            mciCode: number;
            negativeCodes: Set<number>;
            scoresByCode: Map<number, number | null>;
          }>,
          defaultMissingCodeContext: {
            mirCode: number;
            mciCode: number;
            negativeCodes: Set<number>;
            scoresByCode: Map<number, number | null>;
          },
          exclusions: typeof emptyExclusions
        ) => Promise<Array<{
          responseId: number;
          coders: Array<{
            coderId: number;
            coderName: string;
            code: string | null;
            score: number | null;
            notes: string | null;
          }>;
        }>>;
      };
      (mockRepository as { createQueryBuilder?: jest.Mock }).createQueryBuilder = jest.fn().mockReturnValue(qb);

      const result = await serviceInternals.getTrainingComparisonRowsForResponseIds(
        1,
        [1, 2],
        [101],
        [{
          responseId: 101,
          unitName: 'Unit A',
          variableId: 'VAR',
          personCode: 'P1',
          personLogin: 'login-a',
          personGroup: 'group',
          bookletName: 'booklet',
          testPerson: 'login-a (group) - booklet',
          status: 'match',
          hasNotes: true
        }],
        new Map([
          [11, {
            mirCode: -31,
            mciCode: -41,
            negativeCodes: new Set([-31, -41]),
            scoresByCode: new Map([[-31, 7], [-41, 3]])
          }]
        ]),
        {
          mirCode: -98,
          mciCode: -97,
          negativeCodes: new Set([-98, -97, -99]),
          scoresByCode: new Map([[-98, 0], [-97, 0], [-99, 0]])
        },
        emptyExclusions
      );

      expect(qb.andWhere).toHaveBeenCalledWith('cju.response_id IN (:...responseIds)', { responseIds: [101] });
      expect(result).toEqual([
        {
          responseId: 101,
          unitName: 'Unit A',
          variableId: 'VAR',
          personCode: 'P1',
          personLogin: 'login-a',
          personGroup: 'group',
          bookletName: 'booklet',
          testPerson: 'login-a (group) - booklet',
          coders: [
            {
              trainingId: 1,
              trainingLabel: 'Training A',
              coderId: 11,
              coderName: 'Job 11',
              code: '-31',
              score: 7,
              notes: 'note',
              codingIssueOption: -3
            },
            {
              trainingId: 2,
              trainingLabel: 'Training B',
              coderId: 21,
              coderName: 'Coder B',
              code: '-97',
              score: 0,
              notes: null,
              codingIssueOption: null
            }
          ]
        }
      ]);
    });
  });

  describe('generateCoderTrainingPackages', () => {
    const makeResponseEntity = (
      responseId: number,
      overrides: Partial<{
        value: string | null;
        unitid: number;
        variableid: string;
        unitAlias: string;
        unitName: string;
        bookletName: string;
        personLogin: string;
        personCode: string;
        personGroup: string;
      }> = {}
    ) => ({
      id: responseId,
      variableid: overrides.variableid ?? 'var1',
      value: overrides.value ?? `value-${responseId}`,
      unitid: overrides.unitid ?? responseId + 100,
      unit: {
        alias: overrides.unitAlias ?? 'Alias Unit',
        name: overrides.unitName ?? 'Real Unit',
        booklet: {
          person: {
            login: overrides.personLogin ?? `person-${responseId}`,
            code: overrides.personCode ?? `${responseId}`,
            group: overrides.personGroup ?? 'Group'
          },
          bookletinfo: {
            name: overrides.bookletName ?? 'Booklet'
          }
        }
      }
    });

    const mockResponseRepository = (responses: ReturnType<typeof makeResponseEntity>[]) => {
      const responseQb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(responses)
      };
      const responseRepository = {
        createQueryBuilder: jest.fn().mockReturnValue(responseQb)
      };

      (service as unknown as { responseRepository: typeof responseRepository }).responseRepository = responseRepository;

      return responseQb;
    };

    const mockReferenceQuery = (rows: Array<{
      unitName: string | null;
      unitAlias: string | null;
      variableId: string;
      responseId: number;
    }>) => {
      const referenceQb = {
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        distinct: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rows)
      };

      (mockRepository as { createQueryBuilder?: jest.Mock }).createQueryBuilder = jest.fn().mockReturnValue(referenceQb);

      return referenceQb;
    };

    it('should match configured units by alias or visible unit name', async () => {
      const responseQb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([])
      };
      const responseRepository = {
        createQueryBuilder: jest.fn().mockReturnValue(responseQb)
      };

      (service as unknown as { responseRepository: typeof responseRepository }).responseRepository = responseRepository;

      const result = await service.generateCoderTrainingPackages(
        1,
        [{ id: 10, name: 'Coder 1' }],
        [{ unitId: 'unit-visible-id', variableId: 'var1', sampleCount: 5 }]
      );

      expect(responseQb.andWhere).toHaveBeenCalledWith(
        '(unit.alias = :unitId OR unit.name = :unitId)',
        { unitId: 'unit-visible-id' }
      );
      expect(result).toEqual([
        {
          coderId: 10,
          coderName: 'Coder 1',
          responses: []
        }
      ]);
    });

    it('does not include DERIVE_ERROR responses in training package sampling', async () => {
      const responseQb = mockResponseRepository([]);

      await service.generateCoderTrainingPackages(
        1,
        [{ id: 10, name: 'Coder 1' }],
        [{ unitId: 'Alias Unit', variableId: 'var1', sampleCount: 5 }]
      );

      const statusFilterCall = responseQb.andWhere.mock.calls.find(
        ([condition]) => condition === 'response.status_v1 IN (:...statuses)'
      );
      const statuses = statusFilterCall?.[1]?.statuses;

      expect(statuses).toEqual([
        statusStringToNumber('CODING_INCOMPLETE'),
        statusStringToNumber('INTENDED_INCOMPLETE')
      ]);
      expect(statuses).not.toContain(statusStringToNumber('DERIVE_ERROR'));
    });

    it('includes DERIVE_ERROR responses in training package sampling when the variable opts in', async () => {
      const responseQb = mockResponseRepository([]);

      await service.generateCoderTrainingPackages(
        1,
        [{ id: 10, name: 'Coder 1' }],
        [{
          unitId: 'Alias Unit',
          variableId: 'var1',
          sampleCount: 5,
          includeDeriveError: true
        }]
      );

      const bracketCall = responseQb.andWhere.mock.calls.find(
        ([condition]) => condition instanceof Brackets
      );
      expect(bracketCall).toBeDefined();

      const bracketBuilder: Record<string, jest.Mock> = {
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis()
      };
      (bracketCall?.[0] as Brackets).whereFactory(bracketBuilder as never);

      expect(bracketBuilder.where).toHaveBeenCalledWith(
        'response.status_v1 IN (:...statuses)',
        {
          statuses: [
            statusStringToNumber('CODING_INCOMPLETE'),
            statusStringToNumber('INTENDED_INCOMPLETE')
          ]
        }
      );
      expect(bracketBuilder.orWhere).toHaveBeenCalledWith(
        'response.status_v1 = :deriveErrorStatus',
        { deriveErrorStatus: statusStringToNumber('DERIVE_ERROR') }
      );
    });

    it('uses the shared aggregation semantics for empty training responses', async () => {
      mockCodingJobService.getAggregationThreshold.mockResolvedValue(2);
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([]);
      mockResponseRepository([
        makeResponseEntity(1, { value: '' }),
        makeResponseEntity(2, { value: '' }),
        makeResponseEntity(3, { value: '[]' }),
        makeResponseEntity(4, { value: 'same' }),
        makeResponseEntity(5, { value: 'same' })
      ]);

      const result = await service.generateCoderTrainingPackages(
        1,
        [{ id: 10, name: 'Coder 1' }],
        [{ unitId: 'Alias Unit', variableId: 'var1', sampleCount: 10 }],
        { caseSelectionMode: 'random' }
      );

      expect(result[0].responses.map(response => response.responseId)).toEqual([
        1,
        2,
        3,
        4
      ]);
      expect(mockCodingJobService.aggregateResponsesByValue).not.toHaveBeenCalled();
    });

    it('deduplicates identical training responses before sampling', async () => {
      mockCodingJobService.getAggregationThreshold.mockResolvedValue(null);
      mockResponseRepository([
        makeResponseEntity(1, {
          value: 'same',
          personLogin: 'person',
          personCode: 'code',
          personGroup: 'group'
        }),
        makeResponseEntity(2, {
          value: 'same',
          personLogin: 'person',
          personCode: 'code',
          personGroup: 'group'
        }),
        makeResponseEntity(3, {
          value: 'other',
          personLogin: 'person',
          personCode: 'code',
          personGroup: 'group'
        })
      ]);

      const result = await service.generateCoderTrainingPackages(
        1,
        [{ id: 10, name: 'Coder 1' }],
        [{ unitId: 'Alias Unit', variableId: 'var1', sampleCount: 10 }],
        { caseSelectionMode: 'random' }
      );

      expect(result[0].responses.map(response => response.responseId)).toEqual([
        1,
        3
      ]);
    });

    it('samples bundle variables by shared case', async () => {
      mockCodingJobService.getAggregationThreshold.mockResolvedValue(null);
      mockRepository.find.mockResolvedValue([{
        id: 5,
        name: 'Bundle',
        workspace_id: 1,
        variables: [
          { unitName: 'Real Unit A', variableId: 'var1' },
          { unitName: 'Real Unit B', variableId: 'var2' }
        ]
      }]);
      const queryBuilders = [
        {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([
            makeResponseEntity(1, {
              unitName: 'Real Unit A',
              variableid: 'var1',
              personLogin: 'person-1',
              personCode: '1'
            }),
            makeResponseEntity(3, {
              unitName: 'Real Unit A',
              variableid: 'var1',
              personLogin: 'person-2',
              personCode: '2'
            })
          ])
        },
        {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([
            makeResponseEntity(2, {
              unitName: 'Real Unit B',
              variableid: 'var2',
              personLogin: 'person-1',
              personCode: '1'
            }),
            makeResponseEntity(4, {
              unitName: 'Real Unit B',
              variableid: 'var2',
              personLogin: 'person-2',
              personCode: '2'
            })
          ])
        }
      ];
      const responseRepository = {
        createQueryBuilder: jest.fn()
          .mockReturnValueOnce(queryBuilders[0])
          .mockReturnValueOnce(queryBuilders[1])
      };
      const chunkRepository = {
        createQueryBuilder: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([])
        })
      };

      (service as unknown as { responseRepository: typeof responseRepository }).responseRepository = responseRepository;
      (service as unknown as { chunkRepository: typeof chunkRepository }).chunkRepository = chunkRepository;

      const result = await service.generateCoderTrainingPackages(
        1,
        [{ id: 10, name: 'Coder 1' }],
        [
          { unitId: 'Real Unit A', variableId: 'var1', sampleCount: 1 },
          { unitId: 'Real Unit B', variableId: 'var2', sampleCount: 1 }
        ],
        {
          caseSelectionMode: 'oldest_first',
          assignedVariableBundles: [{
            id: 5,
            name: 'Bundle',
            sampleCount: 1
          }]
        }
      );

      expect(result[0].responses.map(response => response.responseId)).toEqual([1, 2]);
      expect(new Set(result[0].responses.map(response => response.personLogin))).toEqual(new Set(['person-1']));
    });

    it('should keep the same referenced cases when the training uses a unit alias', async () => {
      mockResponseRepository([makeResponseEntity(1), makeResponseEntity(2), makeResponseEntity(3)]);
      mockReferenceQuery([{
        unitName: 'Real Unit',
        unitAlias: 'Alias Unit',
        variableId: 'var1',
        responseId: 2
      }]);

      const result = await service.generateCoderTrainingPackages(
        1,
        [{ id: 10, name: 'Coder 1' }],
        [{ unitId: 'Alias Unit', variableId: 'var1', sampleCount: 5 }],
        {
          caseSelectionMode: 'random',
          referenceTrainingIds: [99],
          referenceMode: 'same'
        }
      );

      expect(result[0].responses.map(response => response.responseId)).toEqual([2]);
    });

    it('should return no cases for same mode when the reference training has no matching unit variable', async () => {
      mockResponseRepository([makeResponseEntity(1), makeResponseEntity(2)]);
      mockReferenceQuery([{
        unitName: 'Other Unit',
        unitAlias: null,
        variableId: 'otherVar',
        responseId: 2
      }]);

      const result = await service.generateCoderTrainingPackages(
        1,
        [{ id: 10, name: 'Coder 1' }],
        [{ unitId: 'Alias Unit', variableId: 'var1', sampleCount: 5 }],
        {
          caseSelectionMode: 'random',
          referenceTrainingIds: [99],
          referenceMode: 'same'
        }
      );

      expect(result[0].responses).toEqual([]);
    });
  });

  describe('sampleResponses', () => {
    type SampleResponse = {
      responseId: number;
      unitAlias: string;
      variableId: string;
      unitName: string;
      value: string;
      personLogin: string;
      personCode: string;
      personGroup: string;
      bookletName: string;
      variable: string;
      chunkTs?: number;
    };

    type SampleResponsesFn = (
      responses: SampleResponse[],
      sampleCount: number,
      caseSelectionMode?: CaseSelectionMode
    ) => SampleResponse[];

    const getSampleResponses = (svc: CoderTrainingService): SampleResponsesFn => (svc as unknown as { sampleResponses: SampleResponsesFn }).sampleResponses.bind(svc);

    const makeResponse = (responseId: number, chunkTs?: number, personGroup = '') => ({
      responseId,
      unitAlias: 'unit',
      variableId: 'var',
      unitName: 'unit',
      value: 'value',
      personLogin: 'login',
      personCode: 'code',
      personGroup,
      bookletName: 'booklet',
      variable: 'var',
      chunkTs
    });

    it('should select oldest responses by chunk timestamp for oldest_first', () => {
      const responses = [
        makeResponse(4, 90),
        makeResponse(2, 90),
        makeResponse(3, 100)
      ];

      const result = getSampleResponses(service)(responses, 2, 'oldest_first');

      expect(result.map((r: { responseId: number }) => r.responseId)).toEqual([2, 4]);
    });

    it('should select newest responses by chunk timestamp for newest_first', () => {
      const responses = [
        makeResponse(4, 90),
        makeResponse(2, 90),
        makeResponse(3, 100)
      ];

      const result = getSampleResponses(service)(responses, 2, 'newest_first');

      expect(result.map((r: { responseId: number }) => r.responseId)).toEqual([3, 4]);
    });

    it('should sample one response per group for random_per_testgroup when sampleCount matches groups', () => {
      const responses = [
        makeResponse(1, 10, 'A'),
        makeResponse(2, 20, 'A'),
        makeResponse(3, 10, 'B'),
        makeResponse(4, 20, 'B')
      ];

      const result = getSampleResponses(service)(responses, 2, 'random_per_testgroup');

      expect(result).toHaveLength(2);
      const groups = Array.from(new Set(result.map((r: { personGroup: string }) => r.personGroup))).sort();
      expect(groups).toEqual(['A', 'B']);
    });

    it('should fill the requested count for random_per_testgroup with uneven large groups', () => {
      const responses = [
        ...Array.from({ length: 90 }, (_, index) => makeResponse(1000 + index, index, 'A')),
        ...Array.from({ length: 9 }, (_, index) => makeResponse(2000 + index, index, 'B')),
        makeResponse(3000, 1, 'C')
      ];
      const shuffleSpy = jest.spyOn(service as unknown as { shuffle: <T>(arr: T[]) => T[] }, 'shuffle')
        .mockImplementation(<T>(arr: T[]) => [...arr]);

      const result = getSampleResponses(service)(responses, 10, 'random_per_testgroup');
      const groupCounts = result.reduce<Record<string, number>>((acc, response) => {
        acc[response.personGroup] = (acc[response.personGroup] || 0) + 1;
        return acc;
      }, {});

      expect(result).toHaveLength(10);
      expect(new Set(result.map(response => response.responseId)).size).toBe(10);
      expect(groupCounts).toEqual({ A: 5, B: 4, C: 1 });
      shuffleSpy.mockRestore();
    });

    it('should take cases from a randomly chosen test group before moving to the next for random_testgroups', () => {
      const responses = [
        makeResponse(1, 10, 'A'),
        makeResponse(2, 20, 'A'),
        makeResponse(3, 10, 'B'),
        makeResponse(4, 20, 'B')
      ];
      const shuffleSpy = jest.spyOn(service as unknown as { shuffle: <T>(arr: T[]) => T[] }, 'shuffle')
        .mockImplementation(<T>(arr: T[]) => [...arr]);

      const result = getSampleResponses(service)(responses, 3, 'random_testgroups');

      expect(result.map((r: { responseId: number }) => r.responseId)).toEqual([1, 2, 3]);
      expect(result.map((r: { personGroup: string }) => r.personGroup)).toEqual(['A', 'A', 'B']);
      shuffleSpy.mockRestore();
    });

    it('should take all requested random_testgroups cases from the first group when it has enough cases', () => {
      const responses = [
        ...Array.from({ length: 90 }, (_, index) => makeResponse(1000 + index, index, 'A')),
        ...Array.from({ length: 9 }, (_, index) => makeResponse(2000 + index, index, 'B')),
        makeResponse(3000, 1, 'C')
      ];
      const shuffleSpy = jest.spyOn(service as unknown as { shuffle: <T>(arr: T[]) => T[] }, 'shuffle')
        .mockImplementation(<T>(arr: T[]) => [...arr]);

      const result = getSampleResponses(service)(responses, 10, 'random_testgroups');

      expect(result).toHaveLength(10);
      expect(new Set(result.map(response => response.personGroup))).toEqual(new Set(['A']));
      expect(result.map(response => response.responseId)).toEqual([1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009]);
      shuffleSpy.mockRestore();
    });

    it('should return all cases when sampleCount is larger than the available pool', () => {
      const responses = [
        makeResponse(1, 10, 'A'),
        makeResponse(2, 20, 'B'),
        makeResponse(3, 30, 'C')
      ];

      const result = getSampleResponses(service)(responses, 10, 'random_per_testgroup');

      expect(result).toEqual(responses);
    });
  });

  describe('applyReferenceFilter', () => {
    type ReferenceResponse = {
      responseId: number;
      unitAlias: string;
      variableId: string;
      unitName: string;
      value: string;
      personLogin: string;
      personCode: string;
      personGroup: string;
      bookletName: string;
      variable: string;
    };

    type ApplyReferenceFilterFn = (
      responses: ReferenceResponse[],
      referenceMode: ReferenceMode | undefined,
      referenceResponseIdsByConfig: TrainingResponseIdsMap | null,
      configKey: string
    ) => ReferenceResponse[];

    const getApplyReferenceFilter = (svc: CoderTrainingService): ApplyReferenceFilterFn => (
      svc as unknown as { applyReferenceFilter: ApplyReferenceFilterFn }
    ).applyReferenceFilter.bind(svc);

    const responses: ReferenceResponse[] = [
      {
        responseId: 1,
        unitAlias: 'alias',
        variableId: 'var',
        unitName: 'unit',
        value: 'one',
        personLogin: 'login-1',
        personCode: 'code-1',
        personGroup: 'group',
        bookletName: 'booklet',
        variable: 'var'
      },
      {
        responseId: 2,
        unitAlias: 'alias',
        variableId: 'var',
        unitName: 'unit',
        value: 'two',
        personLogin: 'login-2',
        personCode: 'code-2',
        personGroup: 'group',
        bookletName: 'booklet',
        variable: 'var'
      }
    ];

    it('should keep only referenced cases for same mode', () => {
      const result = getApplyReferenceFilter(service)(responses, 'same', { 'unit:var': [2] }, 'unit:var');

      expect(result.map(r => r.responseId)).toEqual([2]);
    });

    it('should return no cases for same mode when the reference has no matching variable', () => {
      const result = getApplyReferenceFilter(service)(responses, 'same', { 'other:var': [2] }, 'unit:var');

      expect(result).toEqual([]);
    });

    it('should keep all cases for different mode when the reference has no matching variable', () => {
      const result = getApplyReferenceFilter(service)(responses, 'different', { 'other:var': [2] }, 'unit:var');

      expect(result).toEqual(responses);
    });
  });

  describe('deriveAutomaticDiscussionResult', () => {
    type DeriveAutomaticDiscussionResultFn = (
      coders: Array<{
        jobId: number;
        coderName: string;
        code: string | null;
        score: number | null;
        notes: string | null;
        codingIssueOption: number | null;
      }>
    ) => { code: number; score: number | null } | null;

    const getAutomaticDiscussionResult = (svc: CoderTrainingService): DeriveAutomaticDiscussionResultFn => {
      const serviceWithPrivateMethod = svc as unknown as { deriveAutomaticDiscussionResult: DeriveAutomaticDiscussionResultFn };
      return serviceWithPrivateMethod.deriveAutomaticDiscussionResult.bind(svc);
    };

    const coderResult = (jobId: number, code: string | null, score: number | null) => ({
      jobId,
      coderName: `Coder ${jobId}`,
      code,
      score,
      notes: null,
      codingIssueOption: null
    });

    const exclusions = {
      globalIgnoredUnits: [],
      ignoredBooklets: [],
      testletIgnoredUnits: []
    };

    const createTrainingWithResponseJobs = (profileIds: Array<number | null>) => ({
      id: 5,
      workspace_id: 1,
      codingJobs: profileIds.map((profileId, index) => ({
        id: 11 + index,
        missings_profile_id: profileId,
        codingJobUnits: [{
          response_id: 101,
          unit_name: 'UNIT',
          booklet_name: 'BOOKLET'
        }]
      }))
    } as CoderTraining);

    type DeriveAutomaticDiscussionResultForResponseFn = (
      workspaceId: number,
      training: CoderTraining,
      responseId: number,
      coders: Array<{
        jobId: number;
        coderName: string;
        code: string | null;
        score: number | null;
        notes: string | null;
        codingIssueOption: number | null;
      }>,
      resolvedExclusions: typeof exclusions
    ) => Promise<{ code: number; score: number | null } | null>;

    const getAutomaticDiscussionResultForResponse = (
      svc: CoderTrainingService
    ): DeriveAutomaticDiscussionResultForResponseFn => {
      const serviceWithPrivateMethod = svc as unknown as {
        deriveAutomaticDiscussionResultForResponse: DeriveAutomaticDiscussionResultForResponseFn
      };
      return serviceWithPrivateMethod.deriveAutomaticDiscussionResultForResponse.bind(svc);
    };

    type MapDisplayCodeAndScoreFn = (
      code: number | null,
      score: number | null,
      codingIssueOption: number | null,
      missingCodes: { mirCode: number; mciCode: number; negativeCodes: Set<number>; scoresByCode: Map<number, number | null> }
    ) => { code: string | null; score: number | null };

    const getMapDisplayCodeAndScore = (svc: CoderTrainingService): MapDisplayCodeAndScoreFn => {
      const serviceWithPrivateMethod = svc as unknown as { mapDisplayCodeAndScore: MapDisplayCodeAndScoreFn };
      return serviceWithPrivateMethod.mapDisplayCodeAndScore.bind(svc);
    };

    type GetMissingScoresByCodeFromMissingsFn = (
      missings: Array<{ id?: string; code: number; score?: unknown }>
    ) => Map<number, number | null>;

    const getMissingScoresByCodeFromMissings = (svc: CoderTrainingService): GetMissingScoresByCodeFromMissingsFn => {
      const serviceWithPrivateMethod = svc as unknown as {
        getMissingScoresByCodeFromMissings: GetMissingScoresByCodeFromMissingsFn
      };
      return serviceWithPrivateMethod.getMissingScoresByCodeFromMissings.bind(svc);
    };

    it('should derive a discussion result only when all coders fully agree', () => {
      const result = getAutomaticDiscussionResult(service)([
        coderResult(1, '7', 2),
        coderResult(2, '7', 2),
        coderResult(3, '7', 2)
      ]);

      expect(result).toEqual({ code: 7, score: 2 });
    });

    it('should leave conflicts and incomplete coder sets without automatic discussion result', () => {
      const derive = getAutomaticDiscussionResult(service);

      expect(derive([
        coderResult(1, '7', 2),
        coderResult(2, '8', 2)
      ])).toBeNull();
      expect(derive([
        coderResult(1, '7', 2),
        coderResult(2, '7', 3)
      ])).toBeNull();
      expect(derive([
        coderResult(1, '7', 2),
        coderResult(2, null, null)
      ])).toBeNull();
    });

    it('should normalize configured negative missing scores before automatic agreement', async () => {
      const mapDisplay = getMapDisplayCodeAndScore(service);
      const result = mapDisplay(-99, null, null, {
        mirCode: -98,
        mciCode: -97,
        negativeCodes: new Set([-97, -98, -99]),
        scoresByCode: new Map([[-97, 0], [-98, 0], [-99, 0]])
      });

      expect(result).toEqual({ code: '-99', score: 0 });
      await expect(getAutomaticDiscussionResultForResponse(service)(
        1,
        createTrainingWithResponseJobs([77, 77]),
        101,
        [
          coderResult(1, '-99', 0),
          coderResult(2, '-99', 0)
        ],
        exclusions
      )).resolves.toEqual({ code: -99, score: 0 });
    });

    it.each([
      ['empty string', ''],
      ['blank string', '  '],
      ['boolean false', false],
      ['empty array', []]
    ])('should reject missing profile scores that are %s during display normalization', (_label, score) => {
      expect(() => getMissingScoresByCodeFromMissings(service)([
        {
          id: 'mir',
          code: -98,
          score
        }
      ])).toThrow('score');
    });

    it('should keep explicit NA missing scores during display normalization', () => {
      const scoresByCode = getMissingScoresByCodeFromMissings(service)([
        {
          id: 'mci',
          code: -97,
          score: null
        }
      ]);
      const mapDisplay = getMapDisplayCodeAndScore(service);

      expect(scoresByCode.get(-97)).toBeNull();
      expect(mapDisplay(-97, null, null, {
        mirCode: -98,
        mciCode: -97,
        negativeCodes: new Set([-97, -98]),
        scoresByCode
      })).toEqual({ code: '-97', score: null });
    });

    it('should reject automatic missing agreement when response jobs use different missing profiles', async () => {
      await expect(getAutomaticDiscussionResultForResponse(service)(
        1,
        createTrainingWithResponseJobs([77, 78]),
        101,
        [
          coderResult(1, '-99', 0),
          coderResult(2, '-99', 0)
        ],
        exclusions
      )).rejects.toThrow('Conflicting missing profiles for response 101 in training 5');
    });
  });

  describe('getWithinTrainingCodingComparison', () => {
    const createFreshnessQueryBuilder = (
      row: Record<string, unknown> = {},
      rows: Record<string, unknown>[] = []
    ) => ({
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(rows),
      getRawOne: jest.fn().mockResolvedValue(row)
    });

    it('builds a within-training comparison freshness token from aggregate changes', async () => {
      (coderTrainingRepository.findOne as jest.Mock).mockResolvedValueOnce({
        id: 5,
        workspace_id: 1,
        updated_at: new Date('2026-06-01T10:00:00Z')
      });
      (codingJobRepository.find as jest.Mock).mockResolvedValueOnce([
        {
          id: 11,
          workspace_id: 1,
          training_id: 5,
          missings_profile_id: null,
          updated_at: new Date('2026-06-01T10:05:00Z')
        },
        {
          id: 12,
          workspace_id: 1,
          training_id: 5,
          missings_profile_id: 7,
          updated_at: new Date('2026-06-01T10:10:00Z')
        }
      ]);

      const unitQb = createFreshnessQueryBuilder({
        unitCount: '4',
        responseCount: '2',
        latestUnitChange: '2026-06-01T10:20:00.000Z'
      });
      const responseQb = createFreshnessQueryBuilder({}, [
        { responseId: '101', responseHash: 'response-hash-101' },
        { responseId: '102', responseHash: 'response-hash-102' }
      ]);
      const discussionQb = createFreshnessQueryBuilder({
        discussionResultCount: '1',
        latestDiscussionChange: '2026-06-01T10:30:00.000Z'
      });
      (mockRepository as { createQueryBuilder?: jest.Mock }).createQueryBuilder = jest.fn()
        .mockReturnValueOnce(unitQb)
        .mockReturnValueOnce(responseQb)
        .mockReturnValueOnce(discussionQb);

      const result = await service.getWithinTrainingComparisonFreshness(1, 5);

      expect(result).toMatchObject({
        workspaceId: 1,
        trainingId: 5,
        jobCount: 2,
        unitCount: 4,
        responseCount: 2,
        discussionResultCount: 1,
        latestTrainingChange: '2026-06-01T10:00:00.000Z',
        latestJobChange: '2026-06-01T10:10:00.000Z',
        latestUnitChange: '2026-06-01T10:20:00.000Z',
        latestDiscussionChange: '2026-06-01T10:30:00.000Z'
      });
      expect(result.version).toHaveLength(16);
      expect(unitQb.innerJoin).toHaveBeenCalledWith('cju.coding_job', 'cj');
      expect(unitQb.leftJoin).not.toHaveBeenCalledWith('cju.response', 'resp');
      expect(responseQb.leftJoin).toHaveBeenCalledWith('cju.response', 'resp');
      expect(responseQb.addSelect).toHaveBeenCalledWith(
        expect.stringContaining('resp.value'),
        'responseHash'
      );
      expect(responseQb.groupBy).toHaveBeenCalledWith('cju.response_id');
      expect(discussionQb.where).toHaveBeenCalledWith('ctdr.workspace_id = :workspaceId', { workspaceId: 1 });
    });

    it('changes the within-training freshness token when discussion results change', async () => {
      (coderTrainingRepository.findOne as jest.Mock).mockResolvedValue({
        id: 5,
        workspace_id: 1,
        updated_at: new Date('2026-06-01T10:00:00Z')
      });
      (codingJobRepository.find as jest.Mock).mockResolvedValue([
        {
          id: 11,
          workspace_id: 1,
          training_id: 5,
          missings_profile_id: null,
          updated_at: new Date('2026-06-01T10:05:00Z')
        }
      ]);

      (mockRepository as { createQueryBuilder?: jest.Mock }).createQueryBuilder = jest.fn()
        .mockReturnValueOnce(createFreshnessQueryBuilder({
          unitCount: '2',
          responseCount: '1',
          latestUnitChange: '2026-06-01T10:20:00.000Z'
        }))
        .mockReturnValueOnce(createFreshnessQueryBuilder({}, [
          { responseId: '101', responseHash: 'response-hash' }
        ]))
        .mockReturnValueOnce(createFreshnessQueryBuilder({
          discussionResultCount: '0',
          latestDiscussionChange: null
        }))
        .mockReturnValueOnce(createFreshnessQueryBuilder({
          unitCount: '2',
          responseCount: '1',
          latestUnitChange: '2026-06-01T10:20:00.000Z'
        }))
        .mockReturnValueOnce(createFreshnessQueryBuilder({}, [
          { responseId: '101', responseHash: 'response-hash' }
        ]))
        .mockReturnValueOnce(createFreshnessQueryBuilder({
          discussionResultCount: '1',
          latestDiscussionChange: '2026-06-01T10:35:00.000Z'
        }));

      const before = await service.getWithinTrainingComparisonFreshness(1, 5);
      const after = await service.getWithinTrainingComparisonFreshness(1, 5);

      expect(before.version).not.toBe(after.version);
    });

    it('changes the within-training freshness token when response data changes', async () => {
      (coderTrainingRepository.findOne as jest.Mock).mockResolvedValue({
        id: 5,
        workspace_id: 1,
        updated_at: new Date('2026-06-01T10:00:00Z')
      });
      (codingJobRepository.find as jest.Mock).mockResolvedValue([
        {
          id: 11,
          workspace_id: 1,
          training_id: 5,
          missings_profile_id: null,
          updated_at: new Date('2026-06-01T10:05:00Z')
        }
      ]);

      (mockRepository as { createQueryBuilder?: jest.Mock }).createQueryBuilder = jest.fn()
        .mockReturnValueOnce(createFreshnessQueryBuilder({
          unitCount: '2',
          responseCount: '1',
          latestUnitChange: '2026-06-01T10:20:00.000Z'
        }))
        .mockReturnValueOnce(createFreshnessQueryBuilder({}, [
          { responseId: '101', responseHash: 'response-hash-before' }
        ]))
        .mockReturnValueOnce(createFreshnessQueryBuilder({
          discussionResultCount: '0',
          latestDiscussionChange: null
        }))
        .mockReturnValueOnce(createFreshnessQueryBuilder({
          unitCount: '2',
          responseCount: '1',
          latestUnitChange: '2026-06-01T10:20:00.000Z'
        }))
        .mockReturnValueOnce(createFreshnessQueryBuilder({}, [
          { responseId: '101', responseHash: 'response-hash-after' }
        ]))
        .mockReturnValueOnce(createFreshnessQueryBuilder({
          discussionResultCount: '0',
          latestDiscussionChange: null
        }));

      const before = await service.getWithinTrainingComparisonFreshness(1, 5);
      const after = await service.getWithinTrainingComparisonFreshness(1, 5);

      expect(before.version).not.toBe(after.version);
    });

    it('groups raw coding rows by response and keeps manual discussion results authoritative', async () => {
      (coderTrainingRepository.findOne as jest.Mock).mockResolvedValueOnce({
        id: 5,
        workspace_id: 1
      });
      mockRepository.find
        .mockResolvedValueOnce([
          {
            id: 11,
            name: 'job-a',
            missings_profile_id: null,
            codingJobCoders: [{ user: { username: 'Alice' } }]
          },
          {
            id: 12,
            name: 'job-b',
            missings_profile_id: null,
            codingJobCoders: [{ user: { username: 'Bob' } }]
          }
        ])
        .mockResolvedValueOnce([
          {
            response_id: 102,
            code: 99,
            score: 4,
            notes: 'manual note',
            manager_user_id: 23,
            manager_name: 'Old Manager'
          }
        ])
        .mockResolvedValueOnce([
          { id: 23, username: 'Manager' }
        ]);

      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            jobId: 11,
            unitRowId: 1,
            responseId: 101,
            unitName: 'UNIT',
            variableId: 'VAR',
            personCode: 'P1',
            personLogin: 'login-1',
            personGroup: 'group',
            bookletName: 'booklet',
            givenAnswer: 'answer 1',
            replayCodeV1: null,
            replayCodeV2: null,
            replayCodeV3: 7,
            replayScoreV1: null,
            replayScoreV2: null,
            replayScoreV3: 2,
            code: 7,
            score: 2,
            notes: 'a',
            codingIssueOption: null
          },
          {
            jobId: 12,
            unitRowId: 2,
            responseId: 101,
            unitName: 'UNIT',
            variableId: 'VAR',
            personCode: 'P1',
            personLogin: 'login-1',
            personGroup: 'group',
            bookletName: 'booklet',
            givenAnswer: 'answer 1',
            replayCodeV1: null,
            replayCodeV2: null,
            replayCodeV3: 7,
            replayScoreV1: null,
            replayScoreV2: null,
            replayScoreV3: 2,
            code: 7,
            score: 2,
            notes: 'b',
            codingIssueOption: null
          },
          {
            jobId: 11,
            unitRowId: 3,
            responseId: 102,
            unitName: 'UNIT',
            variableId: 'VAR',
            personCode: 'P2',
            personLogin: 'login-2',
            personGroup: 'group',
            bookletName: 'booklet',
            givenAnswer: 'answer 2',
            replayCodeV1: null,
            replayCodeV2: null,
            replayCodeV3: null,
            replayScoreV1: null,
            replayScoreV2: null,
            replayScoreV3: null,
            code: 8,
            score: 2,
            notes: null,
            codingIssueOption: null
          },
          {
            jobId: 12,
            unitRowId: 4,
            responseId: 102,
            unitName: 'UNIT',
            variableId: 'VAR',
            personCode: 'P2',
            personLogin: 'login-2',
            personGroup: 'group',
            bookletName: 'booklet',
            givenAnswer: 'answer 2',
            replayCodeV1: null,
            replayCodeV2: null,
            replayCodeV3: null,
            replayScoreV1: null,
            replayScoreV2: null,
            replayScoreV3: null,
            code: 9,
            score: 3,
            notes: null,
            codingIssueOption: null
          }
        ])
      };
      (mockRepository as { createQueryBuilder?: jest.Mock }).createQueryBuilder = jest.fn().mockReturnValue(qb);

      const result = await service.getWithinTrainingCodingComparison(1, 5);

      expect(coderTrainingRepository.findOne).toHaveBeenCalledWith({
        where: { workspace_id: 1, id: 5 }
      });
      expect(codingJobRepository.find).toHaveBeenCalledWith({
        where: { workspace_id: 1, training_id: 5 },
        relations: ['codingJobCoders.user'],
        order: { id: 'ASC' }
      });
      expect(qb.getRawMany).toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        responseId: 101,
        givenAnswer: 'answer 1',
        replayCode: 7,
        replayScore: 2,
        discussionCode: 7,
        discussionScore: 2,
        discussionSource: 'auto_agreement',
        coders: [
          {
            jobId: 11, coderName: 'Alice', code: '7', score: 2, notes: 'a'
          },
          {
            jobId: 12, coderName: 'Bob', code: '7', score: 2, notes: 'b'
          }
        ]
      });
      expect(result[1]).toMatchObject({
        responseId: 102,
        discussionCode: 99,
        discussionScore: 4,
        discussionNotes: 'manual note',
        discussionManagerUserId: 23,
        discussionManagerName: 'Manager',
        discussionSource: 'manual'
      });
    });

    it('filters within-training comparison pages before calculating the returned summary', async () => {
      const fullComparisonSpy = jest.spyOn(service, 'getWithinTrainingCodingComparison').mockResolvedValue([]);
      const serviceInternals = service as unknown as {
        getWithinTrainingComparisonAggregateRows: () => Promise<unknown>;
        getWithinTrainingComparisonRowsForResponseIds: () => Promise<unknown>;
      };
      (coderTrainingRepository.findOne as jest.Mock).mockResolvedValueOnce({
        id: 5,
        workspace_id: 1
      });
      (codingJobRepository.find as jest.Mock).mockResolvedValueOnce([
        {
          id: 11,
          name: 'job-a',
          missings_profile_id: null,
          codingJobCoders: [{ user: { username: 'Coder A' } }]
        },
        {
          id: 12,
          name: 'job-b',
          missings_profile_id: null,
          codingJobCoders: [{ user: { username: 'Coder B' } }]
        }
      ]);
      const aggregateRowsSpy = jest.spyOn(serviceInternals, 'getWithinTrainingComparisonAggregateRows').mockResolvedValue([
        {
          responseId: 101,
          unitName: 'Unit A',
          variableId: 'VAR',
          personCode: 'P1',
          personLogin: 'login-a',
          personGroup: 'group',
          bookletName: 'booklet',
          completeCodeCount: 2,
          distinctCodeCount: 2,
          hasNotes: true
        },
        {
          responseId: 102,
          unitName: 'Unit B',
          variableId: 'VAR',
          personCode: 'P2',
          personLogin: 'login-b',
          personGroup: 'group',
          bookletName: 'booklet',
          completeCodeCount: 2,
          distinctCodeCount: 1,
          hasNotes: false
        }
      ]);
      const pageRowsSpy = jest.spyOn(serviceInternals, 'getWithinTrainingComparisonRowsForResponseIds').mockResolvedValue([
        {
          responseId: 101,
          unitName: 'Unit A',
          variableId: 'VAR',
          personCode: 'P1',
          personLogin: 'login-a',
          personGroup: 'group',
          bookletName: 'booklet',
          testPerson: 'login-a (group) - booklet',
          givenAnswer: 'answer a',
          replayCode: null,
          replayScore: null,
          discussionCode: null,
          discussionScore: null,
          discussionNotes: null,
          discussionManagerUserId: null,
          discussionManagerName: null,
          discussionSource: null,
          coders: []
        }
      ]);

      const result = await service.getWithinTrainingCodingComparisonPage(1, 5, {
        selectedJobIds: [11, 11, 12, 999],
        filters: {
          match: 'differ',
          notesMode: 'with-notes'
        }
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].responseId).toBe(101);
      expect(result.total).toBe(1);
      expect(result.summary).toEqual({
        visibleRows: 1,
        comparableRows: 1,
        matchingRows: 0,
        matchingPercentage: 0,
        incompleteRows: 0,
        notComparableRows: 0,
        deviationRows: 1,
        completionRate: 100
      });
      expect(result.availableCoders).toEqual([
        { jobId: 11, coderName: 'Coder A' },
        { jobId: 12, coderName: 'Coder B' }
      ]);
      expect(fullComparisonSpy).not.toHaveBeenCalled();
      expect(aggregateRowsSpy).toHaveBeenCalledWith(
        1,
        5,
        [11, 12],
        expect.any(Map),
        expect.any(Object),
        expect.any(Object)
      );
      expect(pageRowsSpy).toHaveBeenCalledWith(
        1,
        5,
        [101],
        expect.any(Array),
        expect.any(Array),
        expect.any(Map),
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('treats regex-enabled comparison text filters as literal text on the backend', async () => {
      const serviceInternals = service as unknown as {
        getWithinTrainingComparisonAggregateRows: () => Promise<unknown>;
        getWithinTrainingComparisonRowsForResponseIds: () => Promise<unknown>;
      };
      (coderTrainingRepository.findOne as jest.Mock).mockResolvedValueOnce({
        id: 5,
        workspace_id: 1
      });
      (codingJobRepository.find as jest.Mock).mockResolvedValueOnce([
        {
          id: 11,
          name: 'job-a',
          missings_profile_id: null,
          codingJobCoders: [{ user: { username: 'Coder A' } }]
        },
        {
          id: 12,
          name: 'job-b',
          missings_profile_id: null,
          codingJobCoders: [{ user: { username: 'Coder B' } }]
        }
      ]);
      jest.spyOn(serviceInternals, 'getWithinTrainingComparisonAggregateRows').mockResolvedValue([
        {
          responseId: 201,
          unitName: 'Unit .*',
          variableId: 'VAR',
          personCode: 'P1',
          personLogin: 'login-a',
          personGroup: 'group',
          bookletName: 'booklet',
          completeCodeCount: 2,
          distinctCodeCount: 1,
          hasNotes: false
        },
        {
          responseId: 202,
          unitName: 'Unit ABC',
          variableId: 'VAR',
          personCode: 'P2',
          personLogin: 'login-b',
          personGroup: 'group',
          bookletName: 'booklet',
          completeCodeCount: 2,
          distinctCodeCount: 1,
          hasNotes: false
        }
      ]);
      const pageRowsSpy = jest.spyOn(serviceInternals, 'getWithinTrainingComparisonRowsForResponseIds').mockResolvedValue([
        {
          responseId: 201,
          unitName: 'Unit .*',
          variableId: 'VAR',
          personCode: 'P1',
          personLogin: 'login-a',
          personGroup: 'group',
          bookletName: 'booklet',
          testPerson: 'login-a (group) - booklet',
          givenAnswer: 'answer a',
          replayCode: null,
          replayScore: null,
          discussionCode: null,
          discussionScore: null,
          discussionNotes: null,
          discussionManagerUserId: null,
          discussionManagerName: null,
          discussionSource: null,
          coders: []
        }
      ]);

      const result = await service.getWithinTrainingCodingComparisonPage(1, 5, {
        filters: {
          unitName: 'Unit .*',
          regexSearch: true
        }
      });

      expect(result.total).toBe(1);
      expect(result.data[0].responseId).toBe(201);
      expect(result.summary.visibleRows).toBe(1);
      expect(pageRowsSpy).toHaveBeenCalledWith(
        1,
        5,
        [201],
        expect.any(Array),
        expect.any(Array),
        expect.any(Map),
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('calculates within-training kappa from aggregate case rows and selected job values', async () => {
      const fullComparisonSpy = jest.spyOn(service, 'getWithinTrainingCodingComparison').mockResolvedValue([]);
      (coderTrainingRepository.findOne as jest.Mock).mockResolvedValueOnce({
        id: 5,
        workspace_id: 1
      });
      (codingJobRepository.find as jest.Mock).mockResolvedValueOnce([
        {
          id: 11,
          name: 'job-a',
          missings_profile_id: null,
          codingJobCoders: [{ user: { username: 'Coder A' } }]
        },
        {
          id: 12,
          name: 'job-b',
          missings_profile_id: null,
          codingJobCoders: [{ user: { username: 'Coder B' } }]
        },
        {
          id: 13,
          name: 'job-c',
          missings_profile_id: null,
          codingJobCoders: [{ user: { username: 'Coder C' } }]
        }
      ]);
      const createKappaQueryBuilder = <T>(rows: T[]) => ({
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rows)
      });
      const caseQb = createKappaQueryBuilder([
        {
          responseId: 101,
          unitName: 'U1',
          variableId: 'V1',
          validValueCount: '3'
        },
        {
          responseId: 102,
          unitName: 'U1',
          variableId: 'V1',
          validValueCount: '2'
        },
        {
          responseId: 101,
          unitName: 'U2',
          variableId: 'V2',
          validValueCount: '2'
        },
        {
          responseId: 201,
          unitName: 'U2',
          variableId: 'V2',
          validValueCount: '1'
        }
      ]);
      const valueQb = createKappaQueryBuilder([
        {
          responseId: 101, jobId: 11, unitName: 'U1', variableId: 'V1', code: '1', score: 1
        },
        {
          responseId: 101, jobId: 12, unitName: 'U1', variableId: 'V1', code: '1', score: 1
        },
        {
          responseId: 101, jobId: 13, unitName: 'U1', variableId: 'V1', code: '1', score: 1
        },
        {
          responseId: 101, jobId: 11, unitName: 'U2', variableId: 'V2', code: '2', score: 2
        },
        {
          responseId: 101, jobId: 12, unitName: 'U2', variableId: 'V2', code: '2', score: 2
        },
        {
          responseId: 102, jobId: 11, unitName: 'U1', variableId: 'V1', code: '1', score: 1
        },
        {
          responseId: 102, jobId: 12, unitName: 'U1', variableId: 'V1', code: null, score: null
        },
        {
          responseId: 102, jobId: 13, unitName: 'U1', variableId: 'V1', code: '2', score: 2
        },
        {
          responseId: 201, jobId: 11, unitName: 'U2', variableId: 'V2', code: '1', score: 1
        }
      ]);
      (mockRepository as { createQueryBuilder?: jest.Mock }).createQueryBuilder = jest.fn()
        .mockReturnValueOnce(caseQb)
        .mockReturnValueOnce(valueQb);
      codingStatisticsService.calculateCohensKappa.mockReturnValue([
        {
          coder1Id: 11,
          coder1Name: 'Coder A',
          coder2Id: 12,
          coder2Name: 'Coder B',
          unitName: 'U1',
          variableId: 'V1',
          kappa: 0.5,
          brennanPredigerKappa: 0.6,
          agreement: 0.8,
          totalItems: 2,
          validPairs: 1,
          interpretation: 'kappa.moderate'
        },
        {
          coder1Id: 11,
          coder1Name: 'Coder A',
          coder2Id: 13,
          coder2Name: 'Coder C',
          unitName: 'U1',
          variableId: 'V1',
          kappa: 0.7,
          brennanPredigerKappa: 0.9,
          agreement: 0.9,
          totalItems: 2,
          validPairs: 2,
          interpretation: 'kappa.substantial'
        },
        {
          coder1Id: 12,
          coder1Name: 'Coder B',
          coder2Id: 13,
          coder2Name: 'Coder C',
          unitName: 'U2',
          variableId: 'V2',
          kappa: null,
          brennanPredigerKappa: null,
          agreement: 0,
          totalItems: 1,
          validPairs: 0,
          interpretation: 'No valid coding pairs'
        }
      ]);
      codingStatisticsService.calculateKappaVariableSummary
        .mockReturnValueOnce({
          meanKappa: 0.6,
          meanBrennanPredigerKappa: 0.7,
          meanAgreement: 0.85,
          validPairCount: 3,
          coderPairCount: 2
        })
        .mockReturnValueOnce({
          meanKappa: null,
          meanBrennanPredigerKappa: null,
          meanAgreement: null,
          validPairCount: 0,
          coderPairCount: 0
        });
      codingStatisticsService.calculateFleissKappa
        .mockReturnValueOnce({ fleissKappa: 1, completeCaseCount: 1, raterCount: 3 })
        .mockReturnValueOnce({ fleissKappa: null, completeCaseCount: 0, raterCount: 3 });

      const result = await service.getWithinTrainingCohensKappa(1, 5, {
        weightedMean: false,
        level: 'code',
        selectedJobIds: [11, 12, 13]
      });

      expect(fullComparisonSpy).not.toHaveBeenCalled();
      expect(caseQb.addSelect).toHaveBeenCalledWith('cju.unit_name', 'unitName');
      expect(caseQb.addSelect).toHaveBeenCalledWith('cju.variable_id', 'variableId');
      expect(caseQb.groupBy).toHaveBeenCalledWith('cju.response_id');
      expect(caseQb.addGroupBy).toHaveBeenCalledWith('cju.unit_name');
      expect(caseQb.addGroupBy).toHaveBeenCalledWith('cju.variable_id');
      expect(caseQb.orderBy).toHaveBeenCalledWith('cju.unit_name', 'ASC');
      expect(caseQb.addOrderBy).toHaveBeenCalledWith('cju.variable_id', 'ASC');
      expect(caseQb.setParameter).toHaveBeenCalledWith('withinTrainingKappaCaseSelectedJobIds', [11, 12, 13]);
      expect(valueQb.andWhere).toHaveBeenCalledWith(
        'cj.id IN (:...withinTrainingKappaValueJobIds)',
        { withinTrainingKappaValueJobIds: [11, 12, 13] }
      );
      expect(codingStatisticsService.calculateCohensKappa).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            coder1Id: 11,
            coder2Id: 12,
            unitName: 'U1',
            variableId: 'V1',
            codes: [
              { code1: 1, code2: 1 },
              { code1: 1, code2: null }
            ]
          }),
          expect.objectContaining({
            coder1Id: 11,
            coder2Id: 12,
            unitName: 'U2',
            variableId: 'V2',
            codes: [
              { code1: 2, code2: 2 },
              { code1: 1, code2: null }
            ]
          })
        ]),
        'code'
      );
      expect(codingStatisticsService.calculateFleissKappa).toHaveBeenNthCalledWith(1, [
        [1, 1, 1],
        [1, null, 2]
      ]);
      expect(codingStatisticsService.calculateFleissKappa).toHaveBeenNthCalledWith(2, [
        [2, 2, null],
        [1, null, null]
      ]);
      expect(codingStatisticsService.calculateKappaVariableSummary)
        .toHaveBeenNthCalledWith(1, expect.any(Array), false);
      expect(codingStatisticsService.calculateKappaVariableSummary)
        .toHaveBeenNthCalledWith(2, expect.any(Array), false);
      expect(result.variables).toEqual([
        expect.objectContaining({
          unitName: 'U1',
          variableId: 'V1',
          meanKappa: 0.6,
          meanBrennanPredigerKappa: 0.7,
          fleissKappa: 1,
          fleissCaseCount: 1,
          caseCount: 2,
          validPairCount: 3,
          coderPairCount: 2
        }),
        expect.objectContaining({
          unitName: 'U2',
          variableId: 'V2',
          meanKappa: null,
          meanBrennanPredigerKappa: null,
          fleissKappa: null,
          fleissCaseCount: 0,
          caseCount: 1,
          validPairCount: 0,
          coderPairCount: 0
        })
      ]);
      expect(result.workspaceSummary).toMatchObject({
        totalDoubleCodedResponses: 3,
        totalCoderPairs: 3,
        averageKappa: 0.6,
        averageBrennanPredigerKappa: 0.75,
        variablesIncluded: 2,
        codersIncluded: 3,
        weightingMethod: 'unweighted',
        calculationLevel: 'code'
      });
    });

    it('uses missing profile score mapping for score-level within-training kappa', async () => {
      (coderTrainingRepository.findOne as jest.Mock).mockResolvedValueOnce({
        id: 5,
        workspace_id: 1
      });
      (codingJobRepository.find as jest.Mock).mockResolvedValueOnce([
        {
          id: 11,
          name: 'job-a',
          missings_profile_id: 77,
          codingJobCoders: [{ user: { username: 'Coder A' } }]
        },
        {
          id: 12,
          name: 'job-b',
          missings_profile_id: null,
          codingJobCoders: [{ user: { username: 'Coder B' } }]
        }
      ]);
      missingsProfilesService.getMissingsProfileDetails.mockResolvedValue({
        parseMissings: () => [
          {
            id: 'mir', label: 'custom invalid response', code: -41, score: 2
          },
          {
            id: 'mci', label: 'custom coding impossible', code: -42, score: null
          },
          {
            id: 'custom', label: 'custom missing', code: -43, score: 4
          }
        ]
      });
      missingsProfilesService.getNegativeMissingCodesForProfileOrDefault
        .mockImplementation(async (_workspaceId, profileId) => (
          profileId === 77 ? new Set([-41, -42, -43]) : new Set([-97, -98, -99])
        ));
      const createKappaQueryBuilder = <T>(rows: T[]) => ({
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rows)
      });
      const caseQb = createKappaQueryBuilder([
        {
          responseId: 101,
          unitName: 'U1',
          variableId: 'V1',
          validValueCount: '2'
        }
      ]);
      const valueQb = createKappaQueryBuilder([
        {
          responseId: 101, jobId: 11, unitName: 'U1', variableId: 'V1', code: '-41', score: '2'
        },
        {
          responseId: 101, jobId: 12, unitName: 'U1', variableId: 'V1', code: '-98', score: '0'
        }
      ]);
      (mockRepository as { createQueryBuilder?: jest.Mock }).createQueryBuilder = jest.fn()
        .mockReturnValueOnce(caseQb)
        .mockReturnValueOnce(valueQb);
      codingStatisticsService.calculateCohensKappa.mockReturnValue([
        {
          coder1Id: 11,
          coder1Name: 'Coder A',
          coder2Id: 12,
          coder2Name: 'Coder B',
          unitName: 'U1',
          variableId: 'V1',
          kappa: 1,
          agreement: 1,
          totalItems: 1,
          validPairs: 1,
          interpretation: 'kappa.almost_perfect'
        }
      ]);
      codingStatisticsService.calculateKappaVariableSummary.mockReturnValue({
        meanKappa: 1,
        meanBrennanPredigerKappa: null,
        meanAgreement: 1,
        validPairCount: 1,
        coderPairCount: 1
      });

      await service.getWithinTrainingCohensKappa(1, 5, {
        level: 'score',
        selectedJobIds: [11, 12]
      });

      const caseValidCountExpression = caseQb.addSelect.mock.calls
        .find(([, alias]) => alias === 'validValueCount')?.[0] as string;
      const valueScoreExpression = valueQb.addSelect.mock.calls
        .find(([, alias]) => alias === 'score')?.[0] as string;
      expect(caseValidCountExpression).toContain('WHEN cju.code = -3 OR cju.coding_issue_option = -3');
      expect(caseValidCountExpression).toContain('WHEN 11 THEN 2');
      expect(caseValidCountExpression).toContain('WHEN 11 THEN NULL::integer');
      expect(caseValidCountExpression).toContain('WHEN -43 THEN 4');
      expect(caseValidCountExpression).not.toContain('AND (cju.score) IS NOT NULL');
      expect(valueScoreExpression).toContain('WHEN cju.code = -3 OR cju.coding_issue_option = -3');
      expect(valueScoreExpression).toContain('WHEN 11 THEN 2');
      expect(valueScoreExpression).toContain('WHEN 11 THEN NULL::integer');
      expect(valueScoreExpression).toContain('WHEN -43 THEN 4');
      expect(valueScoreExpression).not.toBe('cju.score');
      expect(codingStatisticsService.calculateCohensKappa).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            coder1Id: 11,
            coder2Id: 12,
            unitName: 'U1',
            variableId: 'V1',
            codes: [{ code1: -41, code2: -98 }],
            scores: [{ score1: 2, score2: 0 }]
          })
        ]),
        'score'
      );
      expect(codingStatisticsService.calculateKappaVariableSummary)
        .toHaveBeenCalledWith(expect.any(Array), true);
    });

    it('rejects automatic missing agreement when raw comparison jobs use different missing profiles', async () => {
      (coderTrainingRepository.findOne as jest.Mock).mockResolvedValueOnce({
        id: 5,
        workspace_id: 1
      });
      missingsProfilesService.getMissingsProfileDetails.mockResolvedValue({
        parseMissings: () => [
          {
            id: 'mir', label: 'missing invalid response', code: -98, score: 0
          },
          {
            id: 'mci', label: 'missing coding impossible', code: -97, score: 0
          },
          {
            id: 'mbi_mbo', label: 'missing by omission', code: -99, score: 0
          }
        ]
      });
      mockRepository.find
        .mockResolvedValueOnce([
          {
            id: 11,
            name: 'job-a',
            missings_profile_id: 77,
            codingJobCoders: [{ user: { username: 'Alice' } }]
          },
          {
            id: 12,
            name: 'job-b',
            missings_profile_id: 78,
            codingJobCoders: [{ user: { username: 'Bob' } }]
          }
        ])
        .mockResolvedValueOnce([]);

      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            jobId: 11,
            unitRowId: 1,
            responseId: 101,
            unitName: 'UNIT',
            variableId: 'VAR',
            personCode: 'P1',
            personLogin: 'login-1',
            personGroup: 'group',
            bookletName: 'booklet',
            givenAnswer: 'answer 1',
            replayCodeV1: null,
            replayCodeV2: null,
            replayCodeV3: null,
            replayScoreV1: null,
            replayScoreV2: null,
            replayScoreV3: null,
            code: -99,
            score: null,
            notes: null,
            codingIssueOption: null
          },
          {
            jobId: 12,
            unitRowId: 2,
            responseId: 101,
            unitName: 'UNIT',
            variableId: 'VAR',
            personCode: 'P1',
            personLogin: 'login-1',
            personGroup: 'group',
            bookletName: 'booklet',
            givenAnswer: 'answer 1',
            replayCodeV1: null,
            replayCodeV2: null,
            replayCodeV3: null,
            replayScoreV1: null,
            replayScoreV2: null,
            replayScoreV3: null,
            code: -99,
            score: null,
            notes: null,
            codingIssueOption: null
          }
        ])
      };
      (mockRepository as { createQueryBuilder?: jest.Mock }).createQueryBuilder = jest.fn().mockReturnValue(qb);

      await expect(service.getWithinTrainingCodingComparison(1, 5))
        .rejects
        .toThrow('Conflicting missing profiles for response 101 in training 5');
    });
  });

  describe('saveDiscussionResult', () => {
    const createTrainingWithUnit = (unitOverrides: Partial<CodingJobUnit> = {}) => {
      const unit = {
        response_id: 101,
        unit_name: 'UNIT',
        unit_alias: 'UNIT_FILE',
        variable_id: 'VAR',
        booklet_name: 'booklet',
        person_login: 'login',
        person_code: 'person-code',
        person_group: 'group',
        code: null,
        score: null,
        coding_issue_option: null,
        response: null,
        ...unitOverrides
      } as CodingJobUnit;

      return {
        unit,
        training: {
          id: 5,
          workspace_id: 1,
          codingJobs: [{
            id: 11,
            missings_profile_id: null,
            codingJobUnits: [unit]
          }]
        } as CoderTraining
      };
    };

    const mockDiscussionSave = () => {
      (coderTrainingDiscussionResultRepository.create as jest.Mock).mockImplementationOnce(value => value);
      (coderTrainingDiscussionResultRepository.save as jest.Mock).mockImplementationOnce(async value => value);
    };

    it('should derive positive discussion scores from the coding scheme', async () => {
      const { training, unit } = createTrainingWithUnit();
      (coderTrainingRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(training)
        .mockResolvedValueOnce(null);
      mockCodingJobService.getCodingSchemeScoreForUnitCode.mockResolvedValueOnce(2);
      mockDiscussionSave();

      const result = await service.saveDiscussionResult(1, 5, 101, 99, 'Manager', 7, 'Replay note');

      expect(mockCodingJobService.getCodingSchemeScoreForUnitCode).toHaveBeenCalledWith(unit, 1, 7);
      expect(coderTrainingDiscussionResultRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        workspace_id: 1,
        training_id: 5,
        response_id: 101,
        code: 7,
        score: 2,
        notes: 'Replay note',
        manager_user_id: 99,
        manager_name: 'Manager'
      }));
      expect(result.score).toBe(2);
      expect(result.notes).toBe('Replay note');
      expect(result.source).toBe('manual');
    });

    it('should score negative discussion codes as missing results without coding scheme lookup', async () => {
      const { training } = createTrainingWithUnit();
      (coderTrainingRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(training)
        .mockResolvedValueOnce(null);
      mockDiscussionSave();

      const result = await service.saveDiscussionResult(1, 5, 101, 99, 'Manager', -99);

      expect(mockCodingJobService.getCodingSchemeScoreForUnitCode).not.toHaveBeenCalled();
      expect(missingsProfilesService.getMissingByCodeForProfileOrDefault).toHaveBeenCalledWith(1, 1, -99);
      expect(coderTrainingDiscussionResultRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        code: -99,
        score: 0
      }));
      expect(result.score).toBe(0);
      expect(result.source).toBe('manual');
    });

    it('should resolve MIR discussion issue option to the default profile missing code', async () => {
      const { training } = createTrainingWithUnit();
      (coderTrainingRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(training)
        .mockResolvedValueOnce(null);
      mockDiscussionSave();

      const result = await service.saveDiscussionResult(1, 5, 101, 99, 'Manager', -3);

      expect(missingsProfilesService.getMissingByIdForProfileOrDefault).toHaveBeenCalledWith(1, 1, 'mir');
      expect(missingsProfilesService.getMissingByCodeForProfileOrDefault).toHaveBeenCalledWith(1, 1, -98);
      expect(coderTrainingDiscussionResultRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        code: -98,
        score: 0
      }));
      expect(result.code).toBe(-98);
      expect(result.score).toBe(0);
      expect(result.source).toBe('manual');
    });

    it('should resolve MCI discussion issue option to the response job missing profile code', async () => {
      const { training } = createTrainingWithUnit();
      training.codingJobs[0].missings_profile_id = 77;
      (coderTrainingRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(training)
        .mockResolvedValueOnce(null);
      missingsProfilesService.getMissingByIdForProfileOrDefault.mockResolvedValueOnce({
        id: 'mci',
        label: 'Custom technical problem',
        code: -41,
        score: 3
      });
      missingsProfilesService.getMissingByCodeForProfileOrDefault.mockResolvedValueOnce({
        id: 'mci',
        label: 'Custom technical problem',
        code: -41,
        score: 3
      });
      mockDiscussionSave();

      const result = await service.saveDiscussionResult(1, 5, 101, 99, 'Manager', -4);

      expect(missingsProfilesService.getMissingByIdForProfileOrDefault).toHaveBeenCalledWith(1, 77, 'mci');
      expect(missingsProfilesService.getMissingByCodeForProfileOrDefault).toHaveBeenCalledWith(1, 77, -41);
      expect(coderTrainingDiscussionResultRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        code: -41,
        score: 3
      }));
      expect(result.code).toBe(-41);
      expect(result.score).toBe(3);
      expect(result.source).toBe('manual');
    });

    it('should reject negative discussion codes that are not configured as missings', async () => {
      const { training } = createTrainingWithUnit();
      (coderTrainingRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(training)
        .mockResolvedValueOnce(null);

      await expect(service.saveDiscussionResult(1, 5, 101, 99, 'Manager', -96))
        .rejects.toThrow('Unsupported missing code: -96');

      expect(mockCodingJobService.getCodingSchemeScoreForUnitCode).not.toHaveBeenCalled();
      expect(coderTrainingDiscussionResultRepository.save).not.toHaveBeenCalled();
    });

    it('should accept all negative codes from the response job missing profile', async () => {
      const { training } = createTrainingWithUnit();
      training.codingJobs[0].missings_profile_id = 77;
      (coderTrainingRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(training)
        .mockResolvedValueOnce(null);
      missingsProfilesService.getMissingByCodeForProfileOrDefault.mockResolvedValueOnce({
        id: 'custom',
        label: 'Custom missing',
        code: -96,
        score: 0
      });
      mockDiscussionSave();

      const result = await service.saveDiscussionResult(1, 5, 101, 99, 'Manager', -96);

      expect(missingsProfilesService.getMissingByCodeForProfileOrDefault).toHaveBeenCalledWith(1, 77, -96);
      expect(coderTrainingDiscussionResultRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        code: -96,
        score: 0
      }));
      expect(result.score).toBe(0);
      expect(result.source).toBe('manual');
    });

    it('should reject negative codes that are not part of the response job missing profile', async () => {
      const { training } = createTrainingWithUnit();
      training.codingJobs[0].missings_profile_id = 77;
      (coderTrainingRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(training)
        .mockResolvedValueOnce(null);
      missingsProfilesService.getMissingByCodeForProfileOrDefault.mockRejectedValueOnce(
        new BadRequestException('Missing code -98 not found')
      );

      await expect(service.saveDiscussionResult(1, 5, 101, 99, 'Manager', -98))
        .rejects.toThrow('Unsupported missing code: -98');

      expect(coderTrainingDiscussionResultRepository.save).not.toHaveBeenCalled();
    });

    it('should reject discussion missing codes when response jobs use different missing profiles with identical codes', async () => {
      const { training, unit } = createTrainingWithUnit();
      const secondUnit = {
        ...unit,
        coding_job_id: 12
      } as CodingJobUnit;
      training.codingJobs = [
        {
          id: 11,
          missings_profile_id: 77,
          codingJobUnits: [unit]
        } as CodingJob,
        {
          id: 12,
          missings_profile_id: 78,
          codingJobUnits: [secondUnit]
        } as CodingJob
      ];
      (coderTrainingRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(training)
        .mockResolvedValueOnce(null);

      await expect(service.saveDiscussionResult(1, 5, 101, 99, 'Manager', -96))
        .rejects.toThrow('Conflicting missing profiles for response 101 in training 5');

      expect(missingsProfilesService.getMissingsProfileDetails).not.toHaveBeenCalled();
      expect(missingsProfilesService.getNegativeMissingCodesForProfileOrDefault).not.toHaveBeenCalled();
      expect(missingsProfilesService.getMissingByCodeForProfileOrDefault).not.toHaveBeenCalled();
      expect(coderTrainingDiscussionResultRepository.save).not.toHaveBeenCalled();
    });

    it('should accept discussion missing codes when legacy default and explicit default profiles are mixed', async () => {
      const { training, unit } = createTrainingWithUnit();
      const secondUnit = {
        ...unit,
        coding_job_id: 12
      } as CodingJobUnit;
      training.codingJobs = [
        {
          id: 11,
          missings_profile_id: null,
          codingJobUnits: [unit]
        } as CodingJob,
        {
          id: 12,
          missings_profile_id: 1,
          codingJobUnits: [secondUnit]
        } as CodingJob
      ];
      (coderTrainingRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(training)
        .mockResolvedValueOnce(null);
      mockDiscussionSave();

      const result = await service.saveDiscussionResult(1, 5, 101, 99, 'Manager', -99);

      expect(missingsProfilesService.getMissingByCodeForProfileOrDefault).toHaveBeenCalledWith(1, 1, -99);
      expect(coderTrainingDiscussionResultRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        code: -99,
        score: 0
      }));
      expect(result.score).toBe(0);
      expect(result.source).toBe('manual');
    });

    it('should return authoritative automatic agreement when clearing a manual discussion result', async () => {
      const { training, unit } = createTrainingWithUnit({
        code: 7,
        score: 2
      });
      const secondUnit = {
        ...unit,
        coding_job_id: 12
      } as CodingJobUnit;
      training.codingJobs = [
        {
          id: 11,
          missings_profile_id: null,
          codingJobUnits: [unit]
        } as CodingJob,
        {
          id: 12,
          missings_profile_id: null,
          codingJobUnits: [secondUnit]
        } as CodingJob
      ];
      (coderTrainingRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(training)
        .mockResolvedValueOnce({ id: 44 });

      const result = await service.saveDiscussionResult(1, 5, 101, 99, 'Manager', null);

      expect(coderTrainingDiscussionResultRepository.delete).toHaveBeenCalledWith(44);
      expect(result).toEqual({
        success: true,
        code: 7,
        score: 2,
        notes: null,
        source: 'auto_agreement',
        managerUserId: null,
        managerName: null
      });
    });

    it('should reject discussion missing codes when default and explicit missing profiles are mixed', async () => {
      const { training, unit } = createTrainingWithUnit();
      const secondUnit = {
        ...unit,
        coding_job_id: 12
      } as CodingJobUnit;
      training.codingJobs = [
        {
          id: 11,
          missings_profile_id: null,
          codingJobUnits: [unit]
        } as CodingJob,
        {
          id: 12,
          missings_profile_id: 77,
          codingJobUnits: [secondUnit]
        } as CodingJob
      ];
      (coderTrainingRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(training)
        .mockResolvedValueOnce(null);

      await expect(service.saveDiscussionResult(1, 5, 101, 99, 'Manager', -99))
        .rejects.toThrow('Conflicting missing profiles for response 101 in training 5');

      expect(missingsProfilesService.getMissingsProfileDetails).not.toHaveBeenCalled();
      expect(missingsProfilesService.getNegativeMissingCodesForProfileOrDefault).not.toHaveBeenCalled();
      expect(missingsProfilesService.getMissingByCodeForProfileOrDefault).not.toHaveBeenCalled();
      expect(coderTrainingDiscussionResultRepository.save).not.toHaveBeenCalled();
    });

    it('should fall back to an existing coder score when no coding scheme score can be resolved', async () => {
      const { training } = createTrainingWithUnit({
        code: 7,
        score: 3
      });
      (coderTrainingRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(training)
        .mockResolvedValueOnce(null);
      mockCodingJobService.getCodingSchemeScoreForUnitCode.mockRejectedValueOnce(
        new BadRequestException('Coding scheme not found for coding job unit')
      );
      mockDiscussionSave();

      const result = await service.saveDiscussionResult(1, 5, 101, 99, 'Manager', 7);

      expect(coderTrainingDiscussionResultRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        code: 7,
        score: 3
      }));
      expect(result.score).toBe(3);
    });

    it('should reject unknown positive discussion codes without a stored fallback', async () => {
      const { training } = createTrainingWithUnit();
      (coderTrainingRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(training)
        .mockResolvedValueOnce(null);
      mockCodingJobService.getCodingSchemeScoreForUnitCode.mockRejectedValueOnce(
        new BadRequestException('Unsupported code for variable VAR: 999')
      );

      await expect(service.saveDiscussionResult(1, 5, 101, 99, 'Manager', 999))
        .rejects.toThrow('Unsupported code for variable VAR: 999');

      expect(coderTrainingDiscussionResultRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('getTrainingResponseIds', () => {
    it('should return empty map when no training IDs are provided', async () => {
      const result = await service.getTrainingResponseIds(1, []);

      expect(result).toEqual({});
    });

    it('should group response IDs by unit and variable and remove duplicates', async () => {
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        distinct: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            unitName: 'unitA',
            unitAlias: 'aliasA',
            variableId: 'v1',
            responseId: 5
          },
          {
            unitName: 'unitA',
            unitAlias: 'aliasA',
            variableId: 'v1',
            responseId: 5
          },
          {
            unitName: 'unitA',
            unitAlias: 'aliasA',
            variableId: 'v1',
            responseId: 7
          },
          {
            unitName: 'unitB',
            unitAlias: null,
            variableId: 'v2',
            responseId: 3
          }
        ])
      };

      (mockRepository as { createQueryBuilder?: jest.Mock }).createQueryBuilder = jest.fn().mockReturnValue(qb);

      const result = await service.getTrainingResponseIds(1, [10, 20]);

      expect((mockRepository as { createQueryBuilder?: jest.Mock }).createQueryBuilder).toHaveBeenCalledWith('cju');
      expect(result).toEqual({
        'unitA:v1': [5, 7],
        'aliasA:v1': [5, 7],
        'unitB:v2': [3]
      });
    });
  });
});
