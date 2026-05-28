import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { CoderTrainingDiscussionResult } from '../../entities/coder-training-discussion-result.entity';
import User from '../../entities/user.entity';
import { MissingsProfilesService } from './missings-profiles.service';
import type { CaseSelectionMode, ReferenceMode } from '../../entities/coder-training.entity';
import { statusStringToNumber } from '../../utils/response-status-converter';

describe('CoderTrainingService', () => {
  let service: CoderTrainingService;
  let coderTrainingRepository: Repository<CoderTraining>;
  let codingJobRepository: Repository<CodingJob>;
  let coderTrainingVariableRepository: Repository<CoderTrainingVariable>;
  let coderTrainingBundleRepository: Repository<CoderTrainingBundle>;
  let coderTrainingCoderRepository: Repository<CoderTrainingCoder>;
  let codingJobVariableBundleRepository: Repository<CodingJobVariableBundle>;

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
    assertCodersCanCodeInWorkspace: jest.fn().mockResolvedValue(undefined)
  };

  const mockWorkspaceFilesService = {
    getDerivedVariableMap: jest.fn().mockResolvedValue(new Map())
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRepository.count.mockResolvedValue(0);

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
        { provide: MissingsProfilesService, useValue: { getMissingsProfileDetails: jest.fn() } },
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
      const assignedVariables = [{ variableId: 'v1', unitName: 'u1', sampleCount: 5 }];
      const assignedVariableBundles = [{ id: 2, name: 'Bundle 1', sampleCount: 20 }];

      mockRepository.find.mockResolvedValue([]); // For responses query
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
        sample_count: 5
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
        true
      );

      expect(coderTrainingRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        suppress_general_instructions: true
      }));
      expect(codingJobRepository.save).toHaveBeenCalledWith(expect.objectContaining({
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
          variable_id: 'VAR',
          unit_name: 'UNIT',
          variable_bundle_id: null
        }),
        expect.objectContaining({
          response_id: 202,
          variable_id: 'VAR2',
          unit_name: 'UNIT2',
          variable_bundle_id: 5
        })
      ]));

      generatePackagesSpy.mockRestore();
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
      const existingJob = { id: 100, suppressGeneralInstructions: false };
      const existingTraining = {
        id: 1,
        workspace_id: 1,
        label: 'Old Label',
        case_selection_mode: 'random',
        reference_training_ids: [44],
        reference_mode: 'same',
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
        true
      );

      expect(coderTrainingRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        suppress_general_instructions: true,
        reference_training_ids: [44],
        reference_mode: 'same'
      }));
      expect(coderTrainingCoderRepository.delete).not.toHaveBeenCalled();
      expect(mockRepository.count).not.toHaveBeenCalled();
      expect(codingJobRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        id: 100,
        suppressGeneralInstructions: true
      }));
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
      expect(savedUnits.map(unit => unit.person_group)).toEqual(['group-1', 'group-1', 'group-2', 'group-2']);

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
      expect(result[0].suppress_general_instructions).toBe(true);
    });
  });

  describe('generateCoderTrainingPackages', () => {
    const makeResponseEntity = (responseId: number) => ({
      id: responseId,
      variableid: 'var1',
      value: `value-${responseId}`,
      unitid: responseId + 100,
      unit: {
        alias: 'Alias Unit',
        name: 'Real Unit',
        booklet: {
          person: {
            login: `person-${responseId}`,
            code: `${responseId}`,
            group: 'Group'
          },
          bookletinfo: {
            name: 'Booklet'
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
