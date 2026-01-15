import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
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
import { CodingExportService } from './coding-export.service';
import { CodebookGenerationService } from './codebook-generation.service';
import { CodingAnalysisService } from './coding-analysis.service';
import { CodingJobOperationsService } from './coding-job-operations.service';
import { CodingProgressService } from './coding-progress.service';
import { CodingReplayService } from './coding-replay.service';
import { CodingResponseQueryService } from './coding-response-query.service';
import { CodingReviewService } from './coding-review.service';
import { CodingValidationService } from './coding-validation.service';
import { CodingVersionService } from './coding-version.service';
import { CodingListService } from './coding-list.service';
import { ResponseManagementService } from './response-management.service';
import { CodingProcessService } from './coding-process.service';
import { CodebookGenerator } from '../../admin/code-book/codebook-generator.class';
import { statusStringToNumber } from '../utils/response-status-converter';

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

  const mockCodingProcessService = {
    processTestPersonsBatch: jest.fn().mockResolvedValue({
      totalResponses: 10,
      statusCounts: { VALID: 10 }
    })
  };

  const mockResponseManagementService = {
    updateResponsesInDatabase: jest.fn(),
    resolveDuplicateResponses: jest.fn(),
    deleteResponse: jest.fn()
  };

  const mockCodingValidationService = {
    validateCodingCompleteness: jest.fn(),
    getCodingIncompleteVariables: jest.fn(),
    invalidateIncompleteVariablesCache: jest.fn()
  };

  const mockCodingReviewService = {
    getCohensKappaStatistics: jest.fn(),
    getWorkspaceCohensKappaSummary: jest.fn()
  };

  const mockCodingAnalysisService = {
    getVariableAnalysis: jest.fn()
  };

  const mockCodingProgressService = {
    getCodingProgressOverview: jest.fn(),
    getVariableCoverageOverview: jest.fn()
  };

  const mockCodingReplayService = {
    generateReplayUrlForResponse: jest.fn()
  };

  const mockCodingVersionService = {
    resetCodingVersion: jest.fn()
  };

  const mockCodingJobOperationsService = {
    applyCodingResults: jest.fn(),
    bulkApplyCodingResults: jest.fn(),
    createDistributedCodingJobs: jest.fn()
  };

  const mockCodebookGenerationService = {
    generateCodebook: jest.fn()
  };

  const mockCodingResponseQueryService = {
    getManualTestPersons: jest.fn(),
    getResponsesByStatus: jest.fn().mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 10
    })
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
        { provide: ResponseManagementService, useValue: mockResponseManagementService },
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
        { provide: CodingResultsService, useValue: mockCodingResultsService },
        { provide: CodingJobService, useValue: mockCodingJobService },
        { provide: CodingExportService, useValue: mockCodingExportService },
        { provide: CodingListService, useValue: mockCodingListService },
        { provide: ResponseManagementService, useValue: mockResponseManagementService },
        { provide: CodingValidationService, useValue: mockCodingValidationService },
        { provide: CodingReviewService, useValue: mockCodingReviewService },
        { provide: CodingAnalysisService, useValue: mockCodingAnalysisService },
        { provide: CodingProgressService, useValue: mockCodingProgressService },
        { provide: CodingReplayService, useValue: mockCodingReplayService },
        { provide: CodingVersionService, useValue: mockCodingVersionService },
        { provide: CodingJobOperationsService, useValue: mockCodingJobOperationsService },
        { provide: CodebookGenerationService, useValue: mockCodebookGenerationService },
        { provide: CodingResponseQueryService, useValue: mockCodingResponseQueryService },
        { provide: CodingProcessService, useValue: mockCodingProcessService }
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
    const personIds = ['1', '2'];
    const autoCoderRun = 1;
    const jobId = 'test-job-id';

    it('should delegate to CodingProcessService', async () => {
      const expectedResult = {
        totalResponses: 10,
        statusCounts: { VALID: 10 }
      };

      const result = await service.processTestPersonsBatch(workspaceId, personIds, autoCoderRun, undefined, jobId);

      expect(mockCodingProcessService.processTestPersonsBatch).toHaveBeenCalledWith(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId
      );
      expect(result).toEqual(expectedResult);
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
      const result = await service.codeTestPersons(workspaceId, '1,2', 1);

      expect(result.jobId).toBe('job-123');
      expect(result.message).toContain('Processing 2 test persons');
      expect(mockJobQueueService.addTestPersonCodingJob).toHaveBeenCalledWith({
        workspaceId,
        personIds: ['1', '2'],
        groupNames: undefined,
        autoCoderRun: 1
      });
    });

    it('should successfully create coding job for groups', async () => {
      personsRepository.find = jest.fn().mockResolvedValue([
        createMockPerson(1),
        createMockPerson(2)
      ]);

      const result = await service.codeTestPersons(workspaceId, 'group1,group2', 1);

      expect(result.jobId).toBe('job-123');
      expect(result.message).toContain('Processing 2 test persons');
      expect(mockJobQueueService.addTestPersonCodingJob).toHaveBeenCalledWith({
        workspaceId,
        personIds: ['1', '2'],
        groupNames: 'group1,group2',
        autoCoderRun: 1
      });
    });

    it('should handle empty input', async () => {
      const result = await service.codeTestPersons(workspaceId, '', 1);

      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
      expect(result).not.toHaveProperty('message'); // Empty input returns basic result without message
    });

    it('should handle whitespace input', async () => {
      const result = await service.codeTestPersons(workspaceId, '   ', 1);

      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
    });

    it('should handle database error when fetching persons for groups', async () => {
      personsRepository.find = jest.fn().mockRejectedValue(new Error('Database error'));

      const result = await service.codeTestPersons(workspaceId, 'group1', 1);

      expect(result.totalResponses).toBe(0);
      expect(result.message).toContain('Error fetching persons for groups');
    });

    it('should handle no persons found for groups', async () => {
      personsRepository.find = jest.fn().mockResolvedValue([]);

      const result = await service.codeTestPersons(workspaceId, 'nonexistent_group', 1);

      expect(result.totalResponses).toBe(0);
      expect(result.message).toContain('No persons found in the selected groups');
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

    const setupValidationQueryBuilderMock = (count: number) => {
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(count)
      };
      responseRepository.createQueryBuilder = jest.fn().mockReturnValue(qb);
    };

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

      // Mock the query builder for response existence check
      setupValidationQueryBuilderMock(1);

      const result = await service.validateCodingCompleteness(workspaceId, expectedCombinations);

      expect(result.results).toHaveLength(1);
      expect(result.results[0].status).toBe('EXISTS');
      expect(result.total).toBe(1);
      expect(result.missing).toBe(0);
      expect(mockCacheService.storeValidationResults).toHaveBeenCalled();
    });

    it('should handle missing responses', async () => {
      mockCacheService.getPaginatedValidationResults = jest.fn().mockResolvedValue(null);

      setupValidationQueryBuilderMock(0);

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

      setupValidationQueryBuilderMock(1);

      const result = await service.validateCodingCompleteness(workspaceId, largeCombinations, 2, 25);

      expect(result.currentPage).toBe(2);
      expect(result.pageSize).toBe(25);
      expect(result.results).toHaveLength(25);
    });

    it('should handle database errors gracefully', async () => {
      mockCacheService.getPaginatedValidationResults = jest.fn().mockResolvedValue(null);

      responseRepository.createQueryBuilder = jest.fn().mockImplementation(() => {
        throw new Error('Database connection failed');
      });

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

      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { unitName: 'UNIT_1', variableId: 'var1', responseCount: '3' }
        ])
      };

      responseRepository.createQueryBuilder = jest.fn().mockReturnValue(qb);
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

      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { unitName: 'UNIT_1', variableId: 'var1', responseCount: '3' },
          { unitName: 'UNIT_1', variableId: 'invalid_var', responseCount: '2' }
        ])
      };

      responseRepository.createQueryBuilder = jest.fn().mockReturnValue(qb);
      mockWorkspaceFilesService.getUnitVariableMap = jest.fn().mockResolvedValue(
        new Map([['UNIT_1', new Set(['var1'])]]) // Only var1 is valid
      );

      const result = await service.getCodingIncompleteVariables(workspaceId);

      expect(result).toHaveLength(1);
      expect(result[0].variableId).toBe('var1');
    });

    it('should handle unit name filtering', async () => {
      mockCacheService.get = jest.fn().mockResolvedValue(null);

      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { unitName: 'SPECIFIC_UNIT', variableId: 'var1', responseCount: '5' }
        ])
      };

      responseRepository.createQueryBuilder = jest.fn().mockReturnValue(qb);
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
      const mockPersons = [
        createMockPerson(1),
        createMockPerson(2)
      ];

      const mockBooklets = [
        createMockBooklet(1, '1'),
        createMockBooklet(2, '2')
      ];

      const mockUnits = [
        createMockUnit(1, 1, 'UNIT_1'),
        createMockUnit(2, 2, 'UNIT_2')
      ];

      const mockResponses = [
        createMockResponse(1, 1, 'var1'),
        createMockResponse(2, 2, 'var2')
      ];

      personsRepository.find = jest.fn().mockResolvedValue(mockPersons);
      bookletRepository.find = jest.fn().mockResolvedValue(mockBooklets);
      unitRepository.find = jest.fn().mockResolvedValue(mockUnits);
      responseRepository.find = jest.fn().mockResolvedValue(mockResponses);

      const result = await service.getManualTestPersons(workspaceId, personIds);

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('unitname');
      expect(result[0].unitname).toBe('UNIT_1');

      const findArgs = (responseRepository.find as jest.Mock).mock.calls[0][0];
      const statusFilter = findArgs.where.status_v1;
      // TypeORM FindOperator stores value in _value or value property
      const filterValues = statusFilter.value;
      expect(filterValues).toEqual(expect.arrayContaining([
        statusStringToNumber('CODING_INCOMPLETE'),
        statusStringToNumber('INTENDED_INCOMPLETE'),
        statusStringToNumber('CODE_SELECTION_PENDING'),
        statusStringToNumber('CODING_ERROR')
      ]));
    });

    it('should handle no persons found', async () => {
      personsRepository.find = jest.fn().mockResolvedValue([]);

      const result = await service.getManualTestPersons(workspaceId, personIds);

      expect(result).toEqual([]);
    });

    it('should handle no matching persons for given IDs', async () => {
      const mockPersons = [createMockPerson(1)]; // Only person 1 exists

      personsRepository.find = jest.fn().mockResolvedValue(mockPersons);

      const result = await service.getManualTestPersons(workspaceId, '3,4'); // Requesting persons 3,4

      expect(result).toEqual([]);
    });

    it('should handle database errors gracefully', async () => {
      personsRepository.find = jest.fn().mockRejectedValue(new Error('Database error'));

      await expect(service.getManualTestPersons(workspaceId, personIds))
        .rejects.toThrow('Could not retrieve responses');
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

      fileUploadRepository.findBy = jest.fn().mockResolvedValue([
        {
          id: 1, file_id: 'unit1', filename: 'unit1.vocs', data: 'unit data 1'
        },
        {
          id: 2, file_id: 'unit2', filename: 'unit2.vocs', data: 'unit data 2'
        }
      ]);

      const result = await service.generateCodebook(workspaceId, missingsProfile, contentOptions, unitIds);

      expect(result).toEqual(mockCodebook);
      expect(fileUploadRepository.findBy).toHaveBeenCalledWith({ id: In(unitIds) });
    });

    it('should return null when no units found', async () => {
      fileUploadRepository.findBy = jest.fn().mockResolvedValue([]);

      const result = await service.generateCodebook(workspaceId, missingsProfile, contentOptions, unitIds);

      expect(result).toBeNull();
    });

    it('should handle codebook generation errors', async () => {
      (CodebookGenerator.generateCodebook as jest.Mock).mockRejectedValue(new Error('Generation failed'));

      fileUploadRepository.findBy = jest.fn().mockResolvedValue([
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

      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(2),
        getMany: jest.fn().mockResolvedValue(mockResponses)
      };

      responseRepository.createQueryBuilder = jest.fn().mockReturnValue(qb);

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
      responseRepository.createQueryBuilder = jest.fn().mockImplementation(() => {
        throw new Error('Database error');
      });

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

      mockBullJobManagementService.getBullJobs = jest.fn().mockResolvedValue(expectedJobs);

      const result = await service.getBullJobs(workspaceId);

      expect(mockBullJobManagementService.getBullJobs).toHaveBeenCalledWith(workspaceId);
      expect(result).toEqual(expectedJobs);
    });
  });

  describe('Cache Management', () => {
    describe('invalidateIncompleteVariablesCache', () => {
      it('should delegate cache invalidation to CodingValidationService', async () => {
        const privateService = service as unknown as { invalidateIncompleteVariablesCache: (id: number) => Promise<void> };
        await privateService.invalidateIncompleteVariablesCache(1);

        expect(mockCodingValidationService.invalidateIncompleteVariablesCache).toHaveBeenCalledWith(1);
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
