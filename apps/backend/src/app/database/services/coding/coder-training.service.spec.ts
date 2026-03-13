import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CoderTrainingService } from './coder-training.service';
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
import { CoderTrainingDiscussionResult } from '../../entities/coder-training-discussion-result.entity';
import User from '../../entities/user.entity';
import { MissingsProfilesService } from './missings-profiles.service';
import type { CaseSelectionMode } from '../../entities/coder-training.entity';

describe('CoderTrainingService', () => {
  let service: CoderTrainingService;
  let coderTrainingRepository: Repository<CoderTraining>;
  let coderTrainingVariableRepository: Repository<CoderTrainingVariable>;
  let coderTrainingBundleRepository: Repository<CoderTrainingBundle>;
  let coderTrainingCoderRepository: Repository<CoderTrainingCoder>;

  const mockRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    create: jest.fn()
  };

  const mockCodingJobService = {
    getAggregationThreshold: jest.fn().mockResolvedValue(null),
    getResponseMatchingMode: jest.fn().mockResolvedValue([ResponseMatchingFlag.IGNORE_WHITESPACE]),
    aggregateResponsesByValue: jest.fn().mockReturnValue([]),
    normalizeValue: jest.fn().mockReturnValue('normalized')
  };

  const mockWorkspaceFilesService = {
    getDerivedVariableMap: jest.fn().mockResolvedValue(new Map())
  };

  beforeEach(async () => {
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
        { provide: MissingsProfilesService, useValue: { getMissingsProfileDetails: jest.fn() } }
      ]
    }).compile();

    service = module.get<CoderTrainingService>(CoderTrainingService);
    coderTrainingRepository = module.get<Repository<CoderTraining>>(getRepositoryToken(CoderTraining));
    coderTrainingVariableRepository = module.get<Repository<CoderTrainingVariable>>(getRepositoryToken(CoderTrainingVariable));
    coderTrainingBundleRepository = module.get<Repository<CoderTrainingBundle>>(getRepositoryToken(CoderTrainingBundle));
    coderTrainingCoderRepository = module.get<Repository<CoderTrainingCoder>>(getRepositoryToken(CoderTrainingCoder));
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

    const getSampleResponses = (svc: CoderTrainingService): SampleResponsesFn =>
      (svc as unknown as { sampleResponses: SampleResponsesFn }).sampleResponses.bind(svc);

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
          { unitKey: 'unitA', variableId: 'v1', responseId: 5 },
          { unitKey: 'unitA', variableId: 'v1', responseId: 5 },
          { unitKey: 'unitA', variableId: 'v1', responseId: 7 },
          { unitKey: 'unitB', variableId: 'v2', responseId: 3 }
        ])
      };

      (mockRepository as { createQueryBuilder?: jest.Mock }).createQueryBuilder = jest.fn().mockReturnValue(qb);

      const result = await service.getTrainingResponseIds(1, [10, 20]);

      expect((mockRepository as { createQueryBuilder?: jest.Mock }).createQueryBuilder).toHaveBeenCalledWith('cju');
      expect(result).toEqual({
        'unitA:v1': [5, 7],
        'unitB:v2': [3]
      });
    });
  });
});
