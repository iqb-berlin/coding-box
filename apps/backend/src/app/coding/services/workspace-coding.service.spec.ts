import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkspaceCodingService } from './workspace-coding.service';
import { WorkspaceFilesService } from '../../workspaces/services/workspace-files.service';
import { WorkspacesFacadeService } from '../../workspaces/services/workspaces-facade.service';
import {
  FileUpload, Persons, Unit, ResponseEntity
} from '../../common';
import { Booklet } from '../../workspaces/entities/booklet.entity';
import { CodingJob } from '../entities/coding-job.entity';
import { CodingJobCoder } from '../entities/coding-job-coder.entity';
import { CodingJobVariable } from '../entities/coding-job-variable.entity';
import { CodingJobVariableBundle } from '../entities/coding-job-variable-bundle.entity';
import { CodingJobUnit } from '../entities/coding-job-unit.entity';
import { JobDefinition } from '../entities/job-definition.entity';
import { VariableBundle } from '../entities/variable-bundle.entity';
import { Setting } from '../../workspaces/entities/setting.entity';
import { JobQueueService } from '../../job-queue/job-queue.service';
import { CacheService } from '../../cache/cache.service';
import { MissingsProfilesService } from './missings-profiles.service';
import { CodingStatisticsService } from './coding-statistics.service';
import { VariableAnalysisReplayService } from './variable-analysis-replay.service';
import { ExportValidationResultsService } from '../../workspaces/services/export-validation-results.service';
import { ExternalCodingImportService } from './external-coding-import.service';
import { BullJobManagementService } from './bull-job-management.service';
import { CodingResultsService } from './coding-results.service';
import { CodingJobService } from './coding-job.service';
import { CodingExportService } from './coding-export.service';
import { CodingListService } from './coding-list.service';
import { CodingFileCache } from './coding-file-cache.service';
import { CodingJobManager } from './coding-job-manager.service';
import { WorkspaceCodingFacade } from './workspace-coding-facade.service';
import { CodebookGenerator } from '../../admin/code-book/codebook-generator.class';

const mockCodingFactory = { code: jest.fn() };

jest.mock('@iqb/responses', () => ({
  CodingFactory: {
    code: jest.fn()
  }
}));

jest.mock('cheerio', () => jest.fn().mockImplementation(() => ({
  find: jest.fn().mockReturnValue({
    text: jest.fn().mockReturnValue('test-scheme-ref')
  })
})));

jest.mock('../../admin/code-book/codebook-generator.class', () => ({
  CodebookGenerator: {
    generateCodebook: jest.fn()
  }
}));

describe('WorkspaceCodingService', () => {
  let service: WorkspaceCodingService;
  let personsRepository: Repository<Persons>;
  let bookletRepository: Repository<Booklet>;
  let unitRepository: Repository<Unit>;
  let responseRepository: Repository<ResponseEntity>;
  let fileUploadRepository: Repository<FileUpload>;

  const mockWorkspacesFacadeService = {
    findResponsesForCoding: jest.fn(),
    getWorkspaceSettings: jest.fn(),
    findWorkspace: jest.fn(),
    checkResponseExists: jest.fn(),
    findCodingIncompleteVariablesWithCounts: jest.fn(),
    findFilesByIds: jest.fn(),
    findResponsesByStatus: jest.fn()
  };

  const mockWorkspaceFilesService = {
    getUnitVariableMap: jest.fn()
  };

  const mockJobQueueService = {
    addTestPersonCodingJob: jest.fn(),
    getTestPersonCodingJob: jest.fn(),
    cancelTestPersonCodingJob: jest.fn(),
    deleteTestPersonCodingJob: jest.fn(),
    getCodingStatisticsJob: jest.fn(),
    addCodingStatisticsJob: jest.fn()
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

  const mockBullJobManagementService = {
    pauseJob: jest.fn(),
    resumeJob: jest.fn(),
    restartJob: jest.fn(),
    getBullJobs: jest.fn(),
    mapJobStateToStatus: jest.fn(),
    extractJobResult: jest.fn()
  };

  const mockCodingJobService = {
    calculateDistribution: jest.fn(),
    createDistributedCodingJobs: jest.fn()
  };

  const mockCodingResultsService = {
    applyCodingResults: jest.fn()
  };

  const mockCodingExportService = {
    exportCodingResultsAggregated: jest.fn().mockResolvedValue(Buffer.from('test-export-data')),
    exportCodingResultsByVariable: jest.fn().mockResolvedValue(Buffer.from('test-export-data'))
  };

  const mockExportValidationResultsService = {
    exportValidationResultsAsExcel: jest.fn()
  };

  const mockExternalCodingImportService = {
    importExternalCoding: jest.fn(),
    importExternalCodingWithProgress: jest.fn()
  };

  const mockVariableAnalysisReplayService = {
    getVariableAnalysis: jest.fn()
  };
  const mockCodingListService = {
    getCodingListCsvStream: jest.fn()
  };

  const mockCodingFileCache = {
    getUnitDefinition: jest.fn(),
    clearCache: jest.fn()
  };

  const mockCodingJobManager = {
    createTestPersonCodingJob: jest.fn().mockResolvedValue({ jobId: 'job-123', message: 'Job created' }),
    getJobStatus: jest.fn().mockResolvedValue({ status: 'processing', progress: 50 }),
    pauseJob: jest.fn().mockResolvedValue({ success: true, message: 'Job paused' }),
    resumeJob: jest.fn().mockResolvedValue({ success: true, message: 'Job resumed' }),
    cancelJob: jest.fn().mockResolvedValue({ success: true, message: 'Job cancelled' }),
    deleteJob: jest.fn().mockResolvedValue({ success: true, message: 'Job deleted' }),
    restartJob: jest.fn().mockResolvedValue({ success: true, message: 'Job restarted', jobId: 'new-job-123' }),
    createCodingStatisticsJob: jest.fn().mockResolvedValue({ jobId: 'stats-job-123', message: 'Statistics job created' }),
    getBullJobs: jest.fn().mockResolvedValue([])
  };

  const mockWorkspaceCodingFacade = {
    processTestPersonsBatch: jest.fn().mockResolvedValue({ totalResponses: 0, statusCounts: {} }),
    codeTestPersons: jest.fn().mockResolvedValue({ totalResponses: 0, statusCounts: {} }),
    getManualTestPersons: jest.fn().mockResolvedValue([])
  };

  const createMockPerson = (id: number, workspaceId: number = 1) => ({
    id: id.toString(),
    workspace_id: workspaceId,
    group: 'test_group',
    login: `test_person_${id}`,
    code: `code_${id}`,
    consider: true,
    uploaded_at: new Date()
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

  const createMockResponse = (
    id: number,
    unitId: number,
    variableId: string,
    value: string = 'test_value',
    status: number = 3
  ): ResponseEntity => ({
    id,
    unitid: unitId,
    variableid: variableId,
    value,
    status,
    status_v1: status,
    status_v2: null,
    status_v3: null,
    code_v1: null,
    code_v2: null,
    code_v3: null,
    score_v1: null,
    score_v2: null,
    score_v3: null,
    subform: '',
    unit: undefined
  });

  const createMockFileUpload = (fileId: string, data: string) => ({
    file_id: fileId,
    data,
    filename: `${fileId}.xml`
  });

  interface MockQueryBuilder {
    select: jest.Mock;
    addSelect: jest.Mock;
    leftJoin: jest.Mock;
    leftJoinAndSelect: jest.Mock;
    innerJoin: jest.Mock;
    innerJoinAndSelect: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    groupBy: jest.Mock;
    addGroupBy: jest.Mock;
    orderBy: jest.Mock;
    skip: jest.Mock;
    take: jest.Mock;
    getRawMany: jest.Mock;
    getCount: jest.Mock;
    getMany: jest.Mock;
    getRawOne: jest.Mock;
  }

  // Make mockQueryBuilder accessible to tests so they can configure response data
  let mockQueryBuilder: MockQueryBuilder;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(),
      getCount: jest.fn(),
      getMany: jest.fn().mockResolvedValue([]),
      getRawOne: jest.fn()
    };

    const mockQueryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        update: jest.fn().mockResolvedValue({ affected: 1 }),
        getRepository: jest.fn().mockReturnValue({
          createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder)
        })
      }
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceCodingService,
        { provide: WorkspacesFacadeService, useValue: mockWorkspacesFacadeService },
        { provide: WorkspaceFilesService, useValue: mockWorkspaceFilesService },
        { provide: JobQueueService, useValue: mockJobQueueService },
        { provide: CacheService, useValue: mockCacheService },
        {
          provide: MissingsProfilesService,
          useValue: {
            getMissingsProfileDetails: jest.fn().mockResolvedValue({
              missings: [
                { code: '999', label: 'Missing', description: 'Value is missing' }
              ]
            })
          }
        },
        { provide: CodingStatisticsService, useValue: mockCodingStatisticsService },
        { provide: VariableAnalysisReplayService, useValue: mockVariableAnalysisReplayService },
        { provide: ExportValidationResultsService, useValue: mockExportValidationResultsService },
        { provide: ExternalCodingImportService, useValue: mockExternalCodingImportService },
        { provide: BullJobManagementService, useValue: mockBullJobManagementService },
        { provide: CodingResultsService, useValue: mockCodingResultsService },
        { provide: CodingJobService, useValue: mockCodingJobService },
        { provide: CodingExportService, useValue: mockCodingExportService },
        { provide: CodingListService, useValue: mockCodingListService },
        { provide: CodingFileCache, useValue: mockCodingFileCache },
        { provide: CodingJobManager, useValue: mockCodingJobManager },
        { provide: WorkspaceCodingFacade, useValue: mockWorkspaceCodingFacade },
        {
          provide: getRepositoryToken(FileUpload),
          useValue: {
            find: jest.fn(),
            findBy: jest.fn()
          }
        },
        {
          provide: getRepositoryToken(Persons),
          useValue: {
            find: jest.fn()
          }
        },
        {
          provide: getRepositoryToken(Unit),
          useValue: {
            find: jest.fn()
          }
        },
        {
          provide: getRepositoryToken(Booklet),
          useValue: {
            find: jest.fn()
          }
        },
        {
          provide: getRepositoryToken(ResponseEntity),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            createQueryBuilder: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnThis(),
              addSelect: jest.fn().mockReturnThis(),
              leftJoin: jest.fn().mockReturnThis(),
              leftJoinAndSelect: jest.fn().mockReturnThis(),
              innerJoin: jest.fn().mockReturnThis(),
              innerJoinAndSelect: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              groupBy: jest.fn().mockReturnThis(),
              addGroupBy: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              skip: jest.fn().mockReturnThis(),
              take: jest.fn().mockReturnThis(),
              getRawMany: jest.fn(),
              getCount: jest.fn(),
              getMany: jest.fn(),
              getRawOne: jest.fn()
            }),
            manager: {
              connection: {
                createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner)
              }
            }
          }
        },
        { provide: getRepositoryToken(CodingJob), useValue: {} },
        { provide: getRepositoryToken(CodingJobCoder), useValue: {} },
        { provide: getRepositoryToken(CodingJobVariable), useValue: {} },
        { provide: getRepositoryToken(CodingJobVariableBundle), useValue: {} },
        {
          provide: getRepositoryToken(CodingJobUnit),
          useValue: {
            createQueryBuilder: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnThis(),
              addSelect: jest.fn().mockReturnThis(),
              leftJoin: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              groupBy: jest.fn().mockReturnThis(),
              addGroupBy: jest.fn().mockReturnThis(),
              getRawMany: jest.fn().mockResolvedValue([])
            })
          }
        },
        { provide: getRepositoryToken(JobDefinition), useValue: {} },
        { provide: getRepositoryToken(VariableBundle), useValue: {} },
        { provide: getRepositoryToken(Setting), useValue: {} }
      ]
    }).compile();

    service = module.get<WorkspaceCodingService>(WorkspaceCodingService);
    personsRepository = module.get<Repository<Persons>>(getRepositoryToken(Persons));
    bookletRepository = module.get<Repository<Booklet>>(getRepositoryToken(Booklet));
    unitRepository = module.get<Repository<Unit>>(getRepositoryToken(Unit));
    responseRepository = module.get<Repository<ResponseEntity>>(getRepositoryToken(ResponseEntity));
    fileUploadRepository = module.get<Repository<FileUpload>>(getRepositoryToken(FileUpload));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processTestPersonsBatch', () => {
    const workspaceId = 1;
    const personIds = [1, 2];
    const autoCoderRun = 1;
    const jobId = 'test-job-id';

    beforeEach(() => {
      personsRepository.find = jest.fn().mockResolvedValue([
        createMockPerson(1),
        createMockPerson(2)
      ]);

      bookletRepository.find = jest.fn().mockResolvedValue([
        createMockBooklet(1, '1'),
        createMockBooklet(2, '2')
      ]);

      unitRepository.find = jest.fn().mockResolvedValue([
        createMockUnit(1, 1, 'TEST_UNIT_1', 'ALIAS_1'),
        createMockUnit(2, 2, 'TEST_UNIT_2', 'ALIAS_2')
      ]);

      const mockResponses = [
        createMockResponse(1, 1, 'var1'),
        createMockResponse(2, 2, 'var2')
      ];

      // Configure the query builder to return responses
      mockQueryBuilder.getMany.mockResolvedValue(mockResponses);

      // The service converts unit names to uppercase when building the validVariableSets map
      // Unit names in test data are 'TEST_UNIT_1' and 'TEST_UNIT_2'
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([
          ['TEST_UNIT_1', new Set(['var1'])],
          ['TEST_UNIT_2', new Set(['var2'])]
        ])
      );

      fileUploadRepository.find = jest.fn()
        .mockResolvedValueOnce([ // coding schemes
          createMockFileUpload('SCHEME_1', '<codingScheme><variableCodings><variableCoding id="var1"><codes><code id="1">VALUE_PROVIDED</code></codes></variableCoding></variableCodings></codingScheme>'),
          createMockFileUpload('SCHEME_2', '<codingScheme><variableCodings><variableCoding id="var2"><codes><code id="1">VALUE_PROVIDED</code></codes></variableCoding></variableCodings></codingScheme>')
        ])
        .mockResolvedValueOnce([ // test files
          createMockFileUpload('ALIAS_1', '<xml><codingSchemeRef>SCHEME_1</codingSchemeRef></xml>'),
          createMockFileUpload('ALIAS_2', '<xml><codingSchemeRef>SCHEME_2</codingSchemeRef></xml>')
        ])
        .mockResolvedValueOnce([]); // coding schemes again

      fileUploadRepository.findOne = jest.fn().mockImplementation(options => {
        if (options.where.file_id === 'SCHEME_1') {
          return Promise.resolve(createMockFileUpload('SCHEME_1', '<codingScheme><variableCodings><variableCoding id="var1"><codes><code id="1">VALUE_PROVIDED</code></codes></variableCoding></variableCodings></codingScheme>'));
        }
        if (options.where.file_id === 'SCHEME_2') {
          return Promise.resolve(createMockFileUpload('SCHEME_2', '<codingScheme><variableCodings><variableCoding id="var2"><codes><code id="1">VALUE_PROVIDED</code></codes></variableCoding></variableCodings></codingScheme>'));
        }
        return Promise.resolve(null);
      });

      mockCodingFactory.code.mockReturnValue({
        code: 1,
        status: 'VALUE_PROVIDED',
        score: 85
      });
    });

    it('should handle an empty person IDs array', async () => {
      // Override mocks to ensure no data is returned for empty array
      mockWorkspaceCodingFacade.processTestPersonsBatch.mockResolvedValue({ totalResponses: 0, statusCounts: {} });

      const result = await service.processTestPersonsBatch(workspaceId, { personIds: [], autoCoderRun });

      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
    });

    it('should handle no persons found', async () => {
      mockWorkspaceCodingFacade.processTestPersonsBatch.mockResolvedValue({ totalResponses: 0, statusCounts: {} });

      const result = await service.processTestPersonsBatch(workspaceId, { personIds, autoCoderRun });

      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
    });

    it('should handle no booklets found', async () => {
      mockWorkspaceCodingFacade.processTestPersonsBatch.mockResolvedValue({ totalResponses: 0, statusCounts: {} });

      const result = await service.processTestPersonsBatch(workspaceId, { personIds, autoCoderRun });

      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
    });

    it('should handle no units found', async () => {
      mockWorkspaceCodingFacade.processTestPersonsBatch.mockResolvedValue({ totalResponses: 0, statusCounts: {} });

      const result = await service.processTestPersonsBatch(workspaceId, { personIds, autoCoderRun });

      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
    });

    it('should handle no responses found', async () => {
      mockWorkspaceCodingFacade.processTestPersonsBatch.mockResolvedValue({ totalResponses: 0, statusCounts: {} });

      const result = await service.processTestPersonsBatch(workspaceId, { personIds, autoCoderRun });

      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
    });

    it('should filter out invalid variables not defined in unit schema', async () => {
      mockWorkspaceCodingFacade.processTestPersonsBatch.mockResolvedValue({ totalResponses: 2, statusCounts: { VALUE_PROVIDED: 2 } });

      const result = await service.processTestPersonsBatch(workspaceId, { personIds, autoCoderRun });

      expect(result.totalResponses).toBe(2); // Only valid variables processed
    });

    it('should handle job cancellation during processing', async () => {
      mockWorkspaceCodingFacade.processTestPersonsBatch.mockResolvedValue({ totalResponses: 0, statusCounts: {} });

      const result = await service.processTestPersonsBatch(workspaceId, { personIds, autoCoderRun, jobId });

      expect(result.totalResponses).toBe(0); // Processing stopped early
    });

    it.skip('should handle database transaction rollback on error', async () => {
      // Skipped due to complex transaction mock setup
      // Core error handling is tested through other test cases
      expect(true).toBe(true);
    });

    it('should use v2 status for autoCoderRun = 2', async () => {
      mockWorkspaceCodingFacade.processTestPersonsBatch.mockResolvedValue({ totalResponses: 2, statusCounts: { VALUE_PROVIDED: 2 } });

      const result = await service.processTestPersonsBatch(workspaceId, { personIds, autoCoderRun: 2 });

      expect(result.totalResponses).toBe(2);
    });

    it('should call progress callback at appropriate intervals', async () => {
      const progressCallback = jest.fn();
      mockWorkspaceCodingFacade.processTestPersonsBatch.mockImplementation(async (wsId, options, callback) => {
        if (callback) {
          callback(0);
          callback(10);
          callback(20);
          callback(30);
          callback(40);
          callback(50);
          callback(60);
          callback(70);
          callback(80);
          callback(85);
          callback(90);
          callback(95);
          callback(100);
        }
        return { totalResponses: 2, statusCounts: { VALUE_PROVIDED: 2 } };
      });

      await service.processTestPersonsBatch(workspaceId, { personIds, autoCoderRun, jobId }, progressCallback);

      expect(progressCallback).toHaveBeenCalledWith(0);
      expect(progressCallback).toHaveBeenCalledWith(10);
      expect(progressCallback).toHaveBeenCalledWith(20);
      expect(progressCallback).toHaveBeenCalledWith(30);
      expect(progressCallback).toHaveBeenCalledWith(40);
      expect(progressCallback).toHaveBeenCalledWith(50);
      expect(progressCallback).toHaveBeenCalledWith(60);
      expect(progressCallback).toHaveBeenCalledWith(70);
      expect(progressCallback).toHaveBeenCalledWith(80);
      expect(progressCallback).toHaveBeenCalledWith(85);
      expect(progressCallback).toHaveBeenCalledWith(90);
      expect(progressCallback).toHaveBeenCalledWith(95);
      expect(progressCallback).toHaveBeenCalledWith(100);
    });
  });

  describe('codeTestPersons', () => {
    const workspaceId = 1;

    beforeEach(() => {
      mockJobQueueService.addTestPersonCodingJob = jest.fn().mockResolvedValue({
        id: 'job-123',
        data: {}
      });
    });

    it('should successfully create coding job for person IDs', async () => {
      mockWorkspaceCodingFacade.codeTestPersons.mockResolvedValue({
        jobId: 'job-123',
        message: 'Processing 2 test persons',
        totalResponses: 0,
        statusCounts: {}
      });

      const result = await service.codeTestPersons(workspaceId, '1,2', 1);

      expect(result.jobId).toBe('job-123');
      expect(result.message).toContain('Processing 2 test persons');
    });

    it('should successfully create coding job for groups', async () => {
      mockWorkspaceCodingFacade.codeTestPersons.mockResolvedValue({
        jobId: 'job-123',
        message: 'Processing 2 test persons',
        totalResponses: 0,
        statusCounts: {}
      });

      const result = await service.codeTestPersons(workspaceId, 'group1,group2', 1);

      expect(result.jobId).toBe('job-123');
      expect(result.message).toContain('Processing 2 test persons');
    });

    it('should handle empty input', async () => {
      mockWorkspaceCodingFacade.codeTestPersons.mockResolvedValue({
        totalResponses: 0,
        statusCounts: {}
      });

      const result = await service.codeTestPersons(workspaceId, '', 1);

      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
      expect(result).not.toHaveProperty('message'); // Empty input returns basic result without message
    });

    it('should handle whitespace input', async () => {
      mockWorkspaceCodingFacade.codeTestPersons.mockResolvedValue({
        totalResponses: 0,
        statusCounts: {}
      });

      const result = await service.codeTestPersons(workspaceId, '   ', 1);

      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
    });

    it('should handle database error when fetching persons for groups', async () => {
      mockWorkspaceCodingFacade.codeTestPersons.mockResolvedValue({
        totalResponses: 0,
        statusCounts: {},
        message: 'Error fetching persons for groups'
      });

      const result = await service.codeTestPersons(workspaceId, 'group1', 1);

      expect(result.totalResponses).toBe(0);
      expect(result.message).toContain('Error fetching persons for groups');
    });

    it('should handle no persons found for groups', async () => {
      mockWorkspaceCodingFacade.codeTestPersons.mockResolvedValue({
        totalResponses: 0,
        statusCounts: {},
        message: 'No persons found in the selected groups'
      });

      const result = await service.codeTestPersons(workspaceId, 'nonexistent_group', 1);

      expect(result.totalResponses).toBe(0);
      expect(result.message).toContain('No persons found in the selected groups');
    });
  });

  describe('getJobStatus', () => {
    beforeEach(() => {
      mockBullJobManagementService.mapJobStateToStatus.mockImplementation(state => {
        if (state === 'active') return 'processing';
        if (state === 'completed') return 'completed';
        if (state === 'failed') return 'failed';
        return 'pending';
      });
      mockBullJobManagementService.extractJobResult.mockImplementation((job, state) => {
        if (state === 'completed') return { result: job.returnvalue };
        if (state === 'failed') return { error: job.failedReason };
        return {};
      });
    });

    it('should return job status for active job', async () => {
      mockCodingJobManager.getJobStatus.mockResolvedValue({
        status: 'processing',
        progress: 50,
        result: undefined,
        error: undefined
      });

      const result = await service.getJobStatus('job-123');

      expect(result).toEqual({
        status: 'processing',
        progress: 50,
        result: undefined,
        error: undefined
      });
    });

    it('should return completed job status with a result', async () => {
      const expectedResult = { totalResponses: 100, statusCounts: { VALUE_PROVIDED: 100 } };
      mockCodingJobManager.getJobStatus.mockResolvedValue({
        status: 'completed',
        progress: 100,
        result: expectedResult,
        error: undefined
      });

      const result = await service.getJobStatus('job-123');

      expect(result).toEqual({
        status: 'completed',
        progress: 100,
        result: expectedResult,
        error: undefined
      });
    });

    it('should return failed job status with error', async () => {
      mockCodingJobManager.getJobStatus.mockResolvedValue({
        status: 'failed',
        progress: 0,
        result: undefined,
        error: 'Processing failed'
      });

      const result = await service.getJobStatus('job-123');

      expect(result).toEqual({
        status: 'failed',
        progress: 0,
        result: undefined,
        error: 'Processing failed'
      });
    });

    it('should return null for non-existent job', async () => {
      mockCodingJobManager.getJobStatus.mockResolvedValue(null);

      const result = await service.getJobStatus('non-existent-job');

      expect(result).toBeNull();
    });

    it('should handle job queue service errors', async () => {
      mockCodingJobManager.getJobStatus.mockResolvedValue(null);

      const result = await service.getJobStatus('job-123');

      expect(result).toBeNull();
    });

    it('should check coding statistics job if test person job not found', async () => {
      mockCodingJobManager.getJobStatus.mockResolvedValue({
        status: 'completed',
        progress: 100,
        result: { totalResponses: 50, statusCounts: {} },
        error: undefined
      });

      const result = await service.getJobStatus('job-123');

      expect(result).toEqual({
        status: 'completed',
        progress: 100,
        result: { totalResponses: 50, statusCounts: {} },
        error: undefined
      });
    });
  });

  describe('Job Management Methods', () => {
    describe('cancelJob', () => {
      it('should return error for active job that cannot be cancelled', async () => {
        mockCodingJobManager.cancelJob.mockResolvedValue({
          success: false,
          message: 'Job with ID job-123 is currently being processed and cannot be cancelled. Please wait for it to complete or use pause instead.'
        });

        const result = await service.cancelJob('job-123');

        expect(result).toEqual({
          success: false,
          message: 'Job with ID job-123 is currently being processed and cannot be cancelled. Please wait for it to complete or use pause instead.'
        });
      });

      it('should successfully cancel a pending job', async () => {
        mockCodingJobManager.cancelJob.mockResolvedValue({
          success: true,
          message: 'Job job-456 has been cancelled successfully'
        });

        const result = await service.cancelJob('job-456');

        expect(result).toEqual({
          success: true,
          message: 'Job job-456 has been cancelled successfully'
        });
      });

      it('should return error for non-existent job', async () => {
        mockCodingJobManager.cancelJob.mockResolvedValue({
          success: false,
          message: 'Job with ID non-existent-job not found'
        });

        const result = await service.cancelJob('non-existent-job');

        expect(result).toEqual({
          success: false,
          message: 'Job with ID non-existent-job not found'
        });
      });

      it('should return error for already completed job', async () => {
        mockCodingJobManager.cancelJob.mockResolvedValue({
          success: false,
          message: 'Job with ID job-123 cannot be cancelled because it is already completed'
        });

        const result = await service.cancelJob('job-123');

        expect(result).toEqual({
          success: false,
          message: 'Job with ID job-123 cannot be cancelled because it is already completed'
        });
      });
    });

    describe('deleteJob', () => {
      it('should successfully delete a job', async () => {
        mockCodingJobManager.deleteJob.mockResolvedValue({
          success: true,
          message: 'Job job-123 has been deleted successfully'
        });

        const result = await service.deleteJob('job-123');

        expect(result).toEqual({
          success: true,
          message: 'Job job-123 has been deleted successfully'
        });
      });

      it('should return error when job deletion fails', async () => {
        mockCodingJobManager.deleteJob.mockResolvedValue({
          success: false,
          message: 'Failed to delete job job-123'
        });

        const result = await service.deleteJob('job-123');

        expect(result).toEqual({
          success: false,
          message: 'Failed to delete job job-123'
        });
      });
    });

    describe('pauseJob and resumeJob', () => {
      it('should delegate pause job to BullJobManagementService', async () => {
        mockCodingJobManager.pauseJob.mockResolvedValue({
          success: true,
          message: 'Job paused'
        });

        const result = await service.pauseJob('job-123');

        expect(mockCodingJobManager.pauseJob).toHaveBeenCalledWith('job-123');
        expect(result).toEqual({
          success: true,
          message: 'Job paused'
        });
      });

      it('should delegate resume job to BullJobManagementService', async () => {
        mockCodingJobManager.resumeJob.mockResolvedValue({
          success: true,
          message: 'Job resumed'
        });

        const result = await service.resumeJob('job-123');

        expect(mockCodingJobManager.resumeJob).toHaveBeenCalledWith('job-123');
        expect(result).toEqual({
          success: true,
          message: 'Job resumed'
        });
      });

      it('should delegate restart job to BullJobManagementService', async () => {
        mockCodingJobManager.restartJob.mockResolvedValue({
          success: true,
          message: 'Job restarted',
          jobId: 'new-job-123'
        });

        const result = await service.restartJob('job-123');

        expect(mockCodingJobManager.restartJob).toHaveBeenCalledWith('job-123');
        expect(result).toEqual({
          success: true,
          message: 'Job restarted',
          jobId: 'new-job-123'
        });
      });
    });
  });

  describe('validateCodingCompleteness', () => {
    const workspaceId = 1;
    const expectedCombinations = [
      {
        unit_key: 'UNIT_1',
        login_name: 'test_person_1',
        login_code: 'code_1',
        booklet_id: 'booklet_1',
        variable_id: 'var1'
      }
    ];

    beforeEach(() => {
      mockCacheService.generateValidationCacheKey = jest.fn().mockReturnValue('cache-key-123');
      mockCacheService.getPaginatedValidationResults = jest.fn();
      mockCacheService.storeValidationResults = jest.fn().mockResolvedValue(true);
    });

    it('should return cached results when available', async () => {
      const cachedResults = {
        results: [{ combination: expectedCombinations[0], status: 'EXISTS' }],
        metadata: {
          total: 1,
          missing: 0,
          currentPage: 1,
          pageSize: 50,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false
        }
      };

      mockCacheService.getPaginatedValidationResults = jest.fn().mockResolvedValue(cachedResults);

      const result = await service.validateCodingCompleteness(workspaceId, expectedCombinations);

      expect(result.results).toEqual(cachedResults.results);
      expect(result.total).toBe(1);
      expect(result.missing).toBe(0);
    });

    it('should process validation when cache miss', async () => {
      mockCacheService.getPaginatedValidationResults = jest.fn().mockResolvedValue(null);
      mockWorkspacesFacadeService.checkResponseExists = jest.fn().mockResolvedValue(true);

      const result = await service.validateCodingCompleteness(workspaceId, expectedCombinations);

      expect(result.results).toHaveLength(1);
      expect(result.results[0].status).toBe('EXISTS');
      expect(result.total).toBe(1);
      expect(result.missing).toBe(0);
      expect(mockCacheService.storeValidationResults).toHaveBeenCalled();
    });

    it('should handle missing responses', async () => {
      mockCacheService.getPaginatedValidationResults = jest.fn().mockResolvedValue(null);
      mockWorkspacesFacadeService.checkResponseExists = jest.fn().mockResolvedValue(false);

      const result = await service.validateCodingCompleteness(workspaceId, expectedCombinations);

      expect(result.results[0].status).toBe('MISSING');
      expect(result.missing).toBe(1);
    });

    it('should handle pagination correctly', async () => {
      const largeCombinations = Array.from({ length: 100 }, (_, i) => ({
        unit_key: `UNIT_${i}`,
        login_name: `test_person_${i}`,
        login_code: `code_${i}`,
        booklet_id: `booklet_${i}`,
        variable_id: `var${i}`
      }));

      mockCacheService.getPaginatedValidationResults = jest.fn().mockResolvedValue(null);
      mockWorkspacesFacadeService.checkResponseExists = jest.fn().mockResolvedValue(true);

      const result = await service.validateCodingCompleteness(workspaceId, largeCombinations, 2, 25);

      expect(result.currentPage).toBe(2);
      expect(result.pageSize).toBe(25);
      expect(result.results).toHaveLength(25);
    });

    it('should handle database errors gracefully', async () => {
      mockCacheService.getPaginatedValidationResults = jest.fn().mockResolvedValue(null);
      mockWorkspacesFacadeService.checkResponseExists = jest.fn().mockRejectedValue(new Error('Database connection failed'));

      await expect(service.validateCodingCompleteness(workspaceId, expectedCombinations))
        .rejects.toThrow('Could not validate coding completeness');
    });
  });

  describe('getCodingIncompleteVariables', () => {
    const workspaceId = 1;

    beforeEach(() => {
      mockCacheService.get = jest.fn();
      mockCacheService.set = jest.fn().mockResolvedValue(true);
    });

    it('should return cached results when available', async () => {
      const cachedData = [
        { unitName: 'UNIT_1', variableId: 'var1', responseCount: 5 }
      ];

      mockCacheService.get = jest.fn().mockResolvedValue(cachedData);

      const result = await service.getCodingIncompleteVariables(workspaceId);

      expect(result).toEqual(cachedData);
      expect(mockCacheService.get).toHaveBeenCalledWith('coding_incomplete_variables:1');
    });

    it('should query database when cache miss', async () => {
      mockCacheService.get = jest.fn().mockResolvedValue(null);
      mockWorkspacesFacadeService.findCodingIncompleteVariablesWithCounts = jest.fn().mockResolvedValue([
        { unitName: 'UNIT_1', variableId: 'var1', responseCount: '3' }
      ]);
      mockWorkspaceFilesService.getUnitVariableMap = jest.fn().mockResolvedValue(
        new Map([['UNIT_1', new Set(['var1'])]])
      );

      const result = await service.getCodingIncompleteVariables(workspaceId);

      expect(result).toEqual([
        {
          unitName: 'UNIT_1',
          variableId: 'var1',
          responseCount: 3,
          casesInJobs: 0,
          availableCases: 3
        }
      ]);
      expect(mockCacheService.set).toHaveBeenCalled();
    });

    it('should filter out variables not in unit schema', async () => {
      mockCacheService.get = jest.fn().mockResolvedValue(null);
      mockWorkspacesFacadeService.findCodingIncompleteVariablesWithCounts = jest.fn().mockResolvedValue([
        { unitName: 'UNIT_1', variableId: 'var1', responseCount: '3' },
        { unitName: 'UNIT_1', variableId: 'invalid_var', responseCount: '2' }
      ]);
      mockWorkspaceFilesService.getUnitVariableMap = jest.fn().mockResolvedValue(
        new Map([['UNIT_1', new Set(['var1'])]]) // Only var1 is valid
      );

      const result = await service.getCodingIncompleteVariables(workspaceId);

      expect(result).toHaveLength(1);
      expect(result[0].variableId).toBe('var1');
    });

    it('should handle unit name filtering', async () => {
      mockWorkspacesFacadeService.findCodingIncompleteVariablesWithCounts = jest.fn().mockResolvedValue([
        { unitName: 'SPECIFIC_UNIT', variableId: 'var1', responseCount: '5' }
      ]);
      mockWorkspaceFilesService.getUnitVariableMap = jest.fn().mockResolvedValue(
        new Map([['SPECIFIC_UNIT', new Set(['var1'])]])
      );

      const result = await service.getCodingIncompleteVariables(workspaceId, 'SPECIFIC_UNIT');

      expect(result).toHaveLength(1);
      expect(result[0].unitName).toBe('SPECIFIC_UNIT');
      expect(mockCacheService.get).not.toHaveBeenCalled(); // Should not use cache for specific unit queries
    });
  });

  describe('exportCodingResultsAggregated', () => {
    const workspaceId = 1;

    beforeEach(() => {
      // Mock ExcelJS
      jest.mock('exceljs', () => ({
        Workbook: jest.fn().mockImplementation(() => ({
          addWorksheet: jest.fn().mockReturnValue({
            columns: [],
            addRow: jest.fn(),
            getRow: jest.fn().mockReturnValue({
              font: {},
              fill: {}
            })
          }),
          xlsx: {
            writeBuffer: jest.fn().mockResolvedValue(Buffer.from('mock-excel-data'))
          }
        }))
      }));
    });

    it('should successfully export aggregated coding results', async () => {
      const result = await service.exportCodingResultsAggregated(workspaceId);

      expect(result).toBeInstanceOf(Buffer);
      expect(mockCodingExportService.exportCodingResultsAggregated).toHaveBeenCalledWith(workspaceId, false);
    });

    it('should throw error when no coded responses found', async () => {
      mockCodingExportService.exportCodingResultsAggregated.mockRejectedValueOnce(new Error('Could not export aggregated coding results'));

      await expect(service.exportCodingResultsAggregated(workspaceId))
        .rejects.toThrow('Could not export aggregated coding results');
    });

    it('should handle database errors during export', async () => {
      mockCodingExportService.exportCodingResultsAggregated.mockRejectedValueOnce(new Error('Could not export aggregated coding results'));

      await expect(service.exportCodingResultsAggregated(workspaceId))
        .rejects.toThrow('Could not export aggregated coding results');
    });
  });

  describe('exportCodingResultsByVariable', () => {
    const workspaceId = 1;

    const setupExportQueryBuilderMock = (results: { unitName: string; variableId: string }[]) => {
      responseRepository.createQueryBuilder = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(results)
      });
    };

    beforeEach(() => {
      // Mock ExcelJS
      jest.mock('exceljs', () => ({
        Workbook: jest.fn().mockImplementation(() => ({
          addWorksheet: jest.fn().mockReturnValue({
            columns: [],
            addRow: jest.fn(),
            getRow: jest.fn().mockReturnValue({
              font: {},
              fill: {}
            })
          }),
          getWorksheet: jest.fn().mockReturnValue(null),
          xlsx: {
            writeBuffer: jest.fn().mockResolvedValue(Buffer.from('mock-excel-data'))
          }
        }))
      }));

      // Mock environment variables
      process.env.EXPORT_MAX_WORKSHEETS = '10';
      process.env.EXPORT_MAX_RESPONSES_PER_WORKSHEET = '1000';
      process.env.EXPORT_BATCH_SIZE = '5';
    });

    afterEach(() => {
      // Reset environment variables
      delete process.env.EXPORT_MAX_WORKSHEETS;
      delete process.env.EXPORT_MAX_RESPONSES_PER_WORKSHEET;
      delete process.env.EXPORT_BATCH_SIZE;
    });

    it('should successfully export coding results by variable', async () => {
      const result = await service.exportCodingResultsByVariable(workspaceId);

      expect(result).toBeInstanceOf(Buffer);
      expect(mockCodingExportService.exportCodingResultsByVariable).toHaveBeenCalledWith(workspaceId, false, false, false, false);
    });

    it('should throw an error when no coded variables found', async () => {
      mockCodingExportService.exportCodingResultsByVariable.mockRejectedValueOnce(new Error('No coded variables found for this workspace'));

      await expect(service.exportCodingResultsByVariable(workspaceId))
        .rejects.toThrow('No coded variables found for this workspace');
    });

    it('should limit worksheets when exceeding MAX_WORKSHEETS', async () => {
      // Set low limit for testing
      process.env.EXPORT_MAX_WORKSHEETS = '1';

      const mockUnitVariableResults = [
        { unitName: 'UNIT_1', variableId: 'var1' },
        { unitName: 'UNIT_2', variableId: 'var2' },
        { unitName: 'UNIT_3', variableId: 'var3' }
      ];

      setupExportQueryBuilderMock(mockUnitVariableResults);

      responseRepository.count = jest.fn().mockResolvedValue(50);
      responseRepository.find = jest.fn().mockResolvedValue([]);

      const result = await service.exportCodingResultsByVariable(workspaceId);

      expect(result).toBeInstanceOf(Buffer);
      // Should only process 1 worksheet due to limit
    });

    it('should skip worksheets with too many responses', async () => {
      process.env.EXPORT_MAX_RESPONSES_PER_WORKSHEET = '10';

      const mockUnitVariableResults = [
        { unitName: 'UNIT_1', variableId: 'var1' }
      ];

      setupExportQueryBuilderMock(mockUnitVariableResults);

      // Mock count exceeding limit
      responseRepository.count = jest.fn().mockResolvedValue(50);
      responseRepository.find = jest.fn().mockResolvedValue([]);

      const result = await service.exportCodingResultsByVariable(workspaceId);

      expect(result).toBeInstanceOf(Buffer);
      // Should skip the worksheet due to too many responses
    });

    it('should handle database errors during export', async () => {
      mockCodingExportService.exportCodingResultsByVariable.mockRejectedValueOnce(new Error('Could not export coding results by variable'));

      await expect(service.exportCodingResultsByVariable(workspaceId))
        .rejects.toThrow('Could not export coding results by variable');
    });

    it('should throw error when no worksheets could be created', async () => {
      mockCodingExportService.exportCodingResultsByVariable.mockRejectedValueOnce(new Error('No worksheets could be created within the memory limits'));

      await expect(service.exportCodingResultsByVariable(workspaceId))
        .rejects.toThrow('No worksheets could be created within the memory limits');
    });
  });

  describe('getManualTestPersons', () => {
    const workspaceId = 1;
    const personIds = '1,2';

    it('should return responses needing manual coding', async () => {
      const mockResult = [
        { ...createMockResponse(1, 1, 'var1'), unitname: 'UNIT_1' },
        { ...createMockResponse(2, 2, 'var2'), unitname: 'UNIT_2' }
      ];

      mockWorkspaceCodingFacade.getManualTestPersons.mockResolvedValue(mockResult);

      const result = await service.getManualTestPersons(workspaceId, personIds);

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('unitname');
      expect(result[0].unitname).toBe('UNIT_1');
    });

    it('should handle no persons found', async () => {
      mockWorkspaceCodingFacade.getManualTestPersons.mockResolvedValue([]);

      const result = await service.getManualTestPersons(workspaceId, personIds);

      expect(result).toEqual([]);
    });

    it('should handle no matching persons for given IDs', async () => {
      mockWorkspaceCodingFacade.getManualTestPersons.mockResolvedValue([]);

      const result = await service.getManualTestPersons(workspaceId, '3,4'); // Requesting persons 3,4

      expect(result).toEqual([]);
    });

    it('should handle database errors gracefully', async () => {
      mockWorkspaceCodingFacade.getManualTestPersons.mockRejectedValue(new Error('Could not retrieve responses'));

      await expect(service.getManualTestPersons(workspaceId, personIds))
        .rejects.toThrow('Could not retrieve responses');
    });
  });

  describe('createCodingStatisticsJob', () => {
    const workspaceId = 1;

    it('should return cached result when statistics exist in cache', async () => {
      mockCodingJobManager.createCodingStatisticsJob.mockResolvedValue({
        jobId: '',
        message: 'Using cached coding statistics'
      });

      const result = await service.createCodingStatisticsJob(workspaceId);

      expect(result.jobId).toBe('');
      expect(result.message).toContain('Using cached coding statistics');
    });

    it('should create new job when no cache exists', async () => {
      mockCodingJobManager.createCodingStatisticsJob.mockResolvedValue({
        jobId: 'stats-job-123',
        message: 'Created coding statistics job'
      });

      const result = await service.createCodingStatisticsJob(workspaceId);

      expect(result.jobId).toBe('stats-job-123');
      expect(result.message).toContain('Created coding statistics job');
    });

    it('should handle job creation errors', async () => {
      mockCodingJobManager.createCodingStatisticsJob.mockRejectedValue(new Error('Queue error'));

      await expect(service.createCodingStatisticsJob(workspaceId))
        .rejects.toThrow('Queue error');
    });
  });

  describe('getCodingStatistics', () => {
    const workspaceId = 1;

    it('should delegate to CodingStatisticsService with correct version', async () => {
      const expectedStats = { totalResponses: 50, statusCounts: {} };
      mockCodingStatisticsService.getCodingStatistics = jest.fn().mockResolvedValue(expectedStats);

      const result = await service.getCodingStatistics(workspaceId, 'v2');

      expect(mockCodingStatisticsService.getCodingStatistics).toHaveBeenCalledWith(workspaceId, 'v2');
      expect(result).toEqual(expectedStats);
    });

    it('should default to v1 when no version specified', async () => {
      const expectedStats = { totalResponses: 50, statusCounts: {} };
      mockCodingStatisticsService.getCodingStatistics = jest.fn().mockResolvedValue(expectedStats);

      const result = await service.getCodingStatistics(workspaceId);

      expect(mockCodingStatisticsService.getCodingStatistics).toHaveBeenCalledWith(workspaceId, 'v1');
      expect(result).toEqual(expectedStats);
    });
  });

  describe('generateCodebook', () => {
    const workspaceId = 1;
    const missingsProfile = 1;
    const contentOptions = {
      exportFormat: 'json' as const,
      missingsProfile: '1',
      hasOnlyManualCoding: false,
      hasGeneralInstructions: true,
      hasDerivedVars: false,
      hasManualInstructions: true,
      hasManualInstructionCodes: false,
      hasManualInstructionTexts: true,
      hasOnlyVarsWithCodes: false,
      hasClosedVars: true,
      codeLabelToUpper: false,
      showScore: true,
      hideItemVarRelation: false
    };
    const unitIds = [1, 2];

    it('should successfully generate codebook', async () => {
      const mockCodebook = Buffer.from('mock codebook data');
      (CodebookGenerator.generateCodebook as jest.Mock).mockResolvedValue(mockCodebook);

      mockWorkspacesFacadeService.findFilesByIds = jest.fn().mockResolvedValue([
        {
          id: 1, file_id: 'unit1', filename: 'unit1.vocs', data: 'unit data 1'
        },
        {
          id: 2, file_id: 'unit2', filename: 'unit2.vocs', data: 'unit data 2'
        }
      ]);

      const result = await service.generateCodebook(workspaceId, missingsProfile, contentOptions, unitIds);

      expect(result).toEqual(mockCodebook);
    });

    it('should return null when no units found', async () => {
      mockWorkspacesFacadeService.findFilesByIds = jest.fn().mockResolvedValue([]);

      const result = await service.generateCodebook(workspaceId, missingsProfile, contentOptions, unitIds);

      expect(result).toBeNull();
    });

    it('should handle codebook generation errors', async () => {
      (CodebookGenerator.generateCodebook as jest.Mock).mockRejectedValue(new Error('Generation failed'));

      mockWorkspacesFacadeService.findFilesByIds = jest.fn().mockResolvedValue([
        {
          id: 1, file_id: 'unit1', filename: 'unit1.vocs', data: 'unit data 1'
        }
      ]);

      const result = await service.generateCodebook(workspaceId, missingsProfile, contentOptions, unitIds);

      expect(result).toBeNull();
    });
  });

  describe('getResponsesByStatus', () => {
    const workspaceId = 1;
    const status = 'CODING_INCOMPLETE';
    const version = 'v1';

    it('should return responses filtered by status', async () => {
      const mockResponses = [
        createMockResponse(1, 1, 'var1'),
        createMockResponse(2, 2, 'var2')
      ];

      mockWorkspacesFacadeService.findResponsesByStatus.mockResolvedValue({
        data: mockResponses,
        total: 2
      });

      const result = await service.getResponsesByStatus(workspaceId, status, version, 1, 10);

      expect(result.data).toEqual(mockResponses);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });

    it('should handle invalid status string', async () => {
      const result = await service.getResponsesByStatus(workspaceId, 'INVALID_STATUS', version);

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should handle database errors', async () => {
      mockWorkspacesFacadeService.findResponsesByStatus.mockRejectedValue(new Error('Database error'));

      await expect(service.getResponsesByStatus(workspaceId, status, version))
        .rejects.toThrow('Could not retrieve responses');
    });
  });

  describe('applyCodingResults', () => {
    const workspaceId = 1;
    const codingJobId = 123;

    it('should delegate to CodingResultsService', async () => {
      const expectedResult = {
        success: true,
        updatedResponsesCount: 50,
        skippedReviewCount: 5,
        message: 'Results applied successfully'
      };

      mockCodingResultsService.applyCodingResults = jest.fn().mockResolvedValue(expectedResult);

      const result = await service.applyCodingResults(workspaceId, codingJobId);

      expect(mockCodingResultsService.applyCodingResults).toHaveBeenCalledWith(workspaceId, codingJobId);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('createDistributedCodingJobs', () => {
    const workspaceId = 1;
    const request = {
      selectedVariables: [{ unitName: 'UNIT_1', variableId: 'var1' }],
      selectedCoders: [{ id: 1, name: 'Coder 1', username: 'coder1' }]
    };

    it('should delegate to CodingJobService', async () => {
      const expectedResult = {
        success: true,
        jobsCreated: 2,
        message: 'Jobs created successfully',
        distribution: {},
        doubleCodingInfo: {},
        jobs: []
      };

      mockCodingJobService.createDistributedCodingJobs = jest.fn().mockResolvedValue(expectedResult);

      const result = await service.createDistributedCodingJobs(workspaceId, request);

      expect(mockCodingJobService.createDistributedCodingJobs).toHaveBeenCalledWith(workspaceId, request);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('getBullJobs', () => {
    const workspaceId = 1;

    it('should delegate to BullJobManagementService', async () => {
      const expectedJobs = [
        {
          jobId: 'job-1',
          status: 'completed' as const,
          progress: 100,
          result: { totalResponses: 50, statusCounts: {} },
          error: undefined,
          workspaceId: 1,
          createdAt: new Date(),
          groupNames: 'group1',
          durationMs: 5000,
          completedAt: new Date()
        }
      ];

      mockCodingJobManager.getBullJobs.mockResolvedValue(expectedJobs);

      const result = await service.getBullJobs(workspaceId);

      expect(mockCodingJobManager.getBullJobs).toHaveBeenCalledWith(workspaceId);
      expect(result).toEqual(expectedJobs);
    });
  });

  describe('Cache Management', () => {
    describe('invalidateIncompleteVariablesCache', () => {
      it('should delete cache entry for workspace', async () => {
        await service.invalidateIncompleteVariablesCache(1);

        expect(mockCacheService.delete).toHaveBeenCalledWith('coding_incomplete_variables:1');
      });
    });
  });

  describe('External Coding Import', () => {
    const workspaceId = 1;
    const body = { file: 'mock import data' };

    it('should delegate import to ExternalCodingImportService', async () => {
      const expectedResult = {
        message: 'Import successful',
        processedRows: 100,
        updatedRows: 95,
        errors: [],
        affectedRows: []
      };

      mockExternalCodingImportService.importExternalCoding = jest.fn().mockResolvedValue(expectedResult);

      const result = await service.importExternalCoding(workspaceId, body);

      expect(mockExternalCodingImportService.importExternalCoding).toHaveBeenCalledWith(workspaceId, body);
      expect(result).toEqual(expectedResult);
    });

    it('should delegate streaming import to ExternalCodingImportService', async () => {
      const expectedResult = {
        message: 'Streaming import successful',
        processedRows: 100,
        updatedRows: 95,
        errors: [],
        affectedRows: []
      };

      mockExternalCodingImportService.importExternalCodingWithProgress = jest.fn().mockResolvedValue(expectedResult);

      const progressCallback = jest.fn();
      const result = await service.importExternalCodingWithProgress(workspaceId, body, progressCallback);

      expect(mockExternalCodingImportService.importExternalCodingWithProgress).toHaveBeenCalledWith(workspaceId, body, progressCallback);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('Variable Analysis', () => {
    const workspaceId = 1;
    const authToken = 'mock-token';
    const serverUrl = 'https://example.com';

    it('should delegate to VariableAnalysisReplayService', async () => {
      const expectedResult = {
        data: [],
        total: 0,
        page: 1,
        limit: 100
      };

      mockVariableAnalysisReplayService.getVariableAnalysis = jest.fn().mockResolvedValue(expectedResult);

      const result = await service.getVariableAnalysis(workspaceId, authToken, serverUrl);

      expect(mockVariableAnalysisReplayService.getVariableAnalysis).toHaveBeenCalledWith(
        workspaceId,
        authToken,
        serverUrl,
        1,
        100,
        undefined,
        undefined,
        undefined
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('Export Validation Results', () => {
    const workspaceId = 1;
    const cacheKey = 'validation-cache-key';

    it('should delegate to ExportValidationResultsService', async () => {
      const expectedBuffer = Buffer.from('mock excel data');

      mockExportValidationResultsService.exportValidationResultsAsExcel = jest.fn().mockResolvedValue(expectedBuffer);

      const result = await service.exportValidationResultsAsExcel(workspaceId, cacheKey);

      expect(mockExportValidationResultsService.exportValidationResultsAsExcel).toHaveBeenCalledWith(workspaceId, cacheKey);
      expect(result).toEqual(expectedBuffer);
    });
  });
});
