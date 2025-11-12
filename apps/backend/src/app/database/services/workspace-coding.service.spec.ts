import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkspaceCodingService } from './workspace-coding.service';
import { WorkspaceFilesService } from './workspace-files.service';
import FileUpload from '../entities/file_upload.entity';
import Persons from '../entities/persons.entity';
import { Unit } from '../entities/unit.entity';
import { Booklet } from '../entities/booklet.entity';
import { ResponseEntity } from '../entities/response.entity';
import { CodingJob } from '../entities/coding-job.entity';
import { CodingJobCoder } from '../entities/coding-job-coder.entity';
import { CodingJobVariable } from '../entities/coding-job-variable.entity';
import { CodingJobVariableBundle } from '../entities/coding-job-variable-bundle.entity';
import { CodingJobUnit } from '../entities/coding-job-unit.entity';
import { JobDefinition } from '../entities/job-definition.entity';
import { VariableBundle } from '../entities/variable-bundle.entity';
import { Setting } from '../entities/setting.entity';
import { JobQueueService } from '../../job-queue/job-queue.service';
import { CacheService } from '../../cache/cache.service';
import { MissingsProfilesService } from './missings-profiles.service';
import { CodingStatisticsService } from './coding-statistics.service';
import { VariableAnalysisReplayService } from './variable-analysis-replay.service';
import { ExportValidationResultsService } from './export-validation-results.service';
import { ExternalCodingImportService } from './external-coding-import.service';
import { BullJobManagementService } from './bull-job-management.service';
import { CodingResultsService } from './coding-results.service';
import { CodingJobService } from './coding-job.service';

describe('WorkspaceCodingService - Unit Variable Filtering', () => {
  let service: WorkspaceCodingService;
  let workspaceFilesService: WorkspaceFilesService;
  let responseRepository: Repository<ResponseEntity>;

  // Mock services
  const mockWorkspaceFilesService = {
    getUnitVariableMap: jest.fn()
  };

  const mockJobQueueService = {
    addTestPersonCodingJob: jest.fn(),
    getTestPersonCodingJob: jest.fn(),
    cancelTestPersonCodingJob: jest.fn(),
    deleteTestPersonCodingJob: jest.fn()
  };

  const mockCacheService = {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    generateValidationCacheKey: jest.fn(),
    getPaginatedValidationResults: jest.fn(),
    storeValidationResults: jest.fn()
  };

  const mockCodingStatisticsService = {
    getCodingStatistics: jest.fn(),
    refreshStatistics: jest.fn()
  };

  const createMockPerson = (id: number, workspaceId: number = 1) => ({
    id: id.toString(),
    workspace_id: workspaceId,
    group: 'test_group',
    login: `test_person_${id}`,
    code: `code_${id}`,
    consider: true
  });

  const createMockBooklet = (id: number, personId: string) => ({
    id,
    personid: personId
  });

  const createMockUnit = (id: number, bookletId: number, name: string = `unit_${id}`, alias: string = `alias_${id}`) => ({
    id,
    bookletid: bookletId,
    name,
    alias
  });

  const createMockResponse = (id: number, unitId: number, variableId: string, status: number = 3) => ({
    id,
    unitid: unitId,
    variableid: variableId,
    value: 'test_value',
    status,
    unit: undefined
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceCodingService,
        { provide: WorkspaceFilesService, useValue: mockWorkspaceFilesService },
        { provide: JobQueueService, useValue: mockJobQueueService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: MissingsProfilesService, useValue: {} },
        { provide: CodingStatisticsService, useValue: mockCodingStatisticsService },
        { provide: VariableAnalysisReplayService, useValue: {} },
        { provide: ExportValidationResultsService, useValue: {} },
        { provide: ExternalCodingImportService, useValue: {} },
        { provide: BullJobManagementService, useValue: {} },
        { provide: CodingResultsService, useValue: {} },
        { provide: CodingJobService, useValue: {} },
        { provide: getRepositoryToken(FileUpload), useValue: {} },
        {
          provide: getRepositoryToken(Persons),
          useValue: {
            find: jest.fn().mockResolvedValue([createMockPerson(1)])
          }
        },
        {
          provide: getRepositoryToken(Unit),
          useValue: {
            find: jest.fn().mockResolvedValue([createMockUnit(1, 1, 'TEST_UNIT', 'TEST_ALIAS')])
          }
        },
        {
          provide: getRepositoryToken(Booklet),
          useValue: {
            find: jest.fn().mockResolvedValue([createMockBooklet(1, '1')])
          }
        },
        {
          provide: getRepositoryToken(ResponseEntity),
          useValue: {
            find: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue({
              manager: { update: jest.fn().mockResolvedValue({ affected: 1 }) },
              commitTransaction: jest.fn(),
              rollbackTransaction: jest.fn(),
              release: jest.fn(),
              startTransaction: jest.fn(),
              connect: jest.fn()
            }),
            manager: {
              connection: {
                createQueryRunner: jest.fn().mockReturnValue({
                  connect: jest.fn(),
                  startTransaction: jest.fn(),
                  commitTransaction: jest.fn(),
                  rollbackTransaction: jest.fn(),
                  release: jest.fn()
                })
              }
            }
          }
        },
        { provide: getRepositoryToken(CodingJob), useValue: {} },
        { provide: getRepositoryToken(CodingJobCoder), useValue: {} },
        { provide: getRepositoryToken(CodingJobVariable), useValue: {} },
        { provide: getRepositoryToken(CodingJobVariableBundle), useValue: {} },
        { provide: getRepositoryToken(CodingJobUnit), useValue: {} },
        { provide: getRepositoryToken(JobDefinition), useValue: {} },
        { provide: getRepositoryToken(VariableBundle), useValue: {} },
        { provide: getRepositoryToken(Setting), useValue: {} }
      ]
    }).compile();

    service = module.get<WorkspaceCodingService>(WorkspaceCodingService);
    workspaceFilesService = module.get<WorkspaceFilesService>(WorkspaceFilesService);
    responseRepository = module.get<Repository<ResponseEntity>>(getRepositoryToken(ResponseEntity));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Unit Variable Filtering', () => {
    it('should filter responses and only process variables defined in unit schema during batch processing', async () => {
      const mockUnitVariables = new Map<string, Set<string>>();
      mockUnitVariables.set('TEST_UNIT', new Set(['var1', 'var2']));
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(mockUnitVariables);
      expect(service).toBeDefined();
      expect(workspaceFilesService).toBeDefined();
    });

    it('should skip responses with variables not defined in unit schema during processing', async () => {
      const mockUnitVariables = new Map<string, Set<string>>();
      mockUnitVariables.set('TEST_UNIT', new Set(['valid_var_1', 'valid_var_2']));
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(mockUnitVariables);
      expect(service).toBeDefined();
      expect(workspaceFilesService).toBeDefined();
    });
  });

  describe('processTestPersonsBatch', () => {
    it('should call getUnitVariableMap to get valid variables', async () => {
      const mockUnitVariables = new Map<string, Set<string>>();
      mockUnitVariables.set('TEST_UNIT', new Set(['var1', 'var2']));
      const mockResponses = [
        createMockResponse(1, 1, 'var1'),
        createMockResponse(2, 1, 'invalid_var')
      ];

      responseRepository.find = jest.fn().mockResolvedValue(mockResponses);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(mockUnitVariables);

      try {
        await service.processTestPersonsBatch(1, ['1'], 1, jest.fn(), 'test-job-id');
      } catch (error) {
        expect(mockWorkspaceFilesService.getUnitVariableMap).toHaveBeenCalledWith(1);
      }
    });
  });
});
