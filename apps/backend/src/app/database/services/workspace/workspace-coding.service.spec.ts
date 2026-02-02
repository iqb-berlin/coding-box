import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceCodingService } from './workspace-coding.service';
import { WorkspaceFilesService } from './workspace-files.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodeBookContentSetting } from '../../../admin/code-book/codebook.interfaces';
import { JobQueueService } from '../../../job-queue/job-queue.service';
import { CacheService } from '../../../cache/cache.service';
import {
  CodebookGenerationService,
  CodingAnalysisService,
  CodingExportService,
  CodingJobOperationsService,
  CodingJobService,
  CodingListService,
  CodingProcessService,
  CodingProgressService,
  CodingReplayService,
  CodingResponseQueryService,
  CodingResultsService,
  CodingReviewService,
  CodingStatisticsService,
  CodingValidationService,
  CodingVersionService,
  ExternalCodingImportService,
  MissingsProfilesService
} from '../coding';
import { ResponseManagementService, VariableAnalysisReplayService } from '../test-results';
import { ExportValidationResultsService } from '../validation';
import { BullJobManagementService } from '../jobs';

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

jest.mock('../../../admin/code-book/codebook-generator.class', () => ({
  CodebookGenerator: {
    generateCodebook: jest.fn()
  }
}));

describe('WorkspaceCodingService', () => {
  let service: WorkspaceCodingService;

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
    }),
    codeTestPersons: jest.fn().mockResolvedValue({
      jobId: 'job-123',
      message: 'Processing 2 test persons',
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
    getResponseAnalysis: jest.fn(),
    invalidateCache: jest.fn()
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

  beforeEach(async () => {
    jest.clearAllMocks();

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

    it('should successfully delegate to CodingProcessService', async () => {
      const expectedResult = {
        jobId: 'job-123',
        message: 'Processing 2 test persons',
        totalResponses: 10,
        statusCounts: { VALID: 10 }
      };
      mockCodingProcessService.codeTestPersons.mockResolvedValue(expectedResult);

      const result = await service.codeTestPersons(workspaceId, '1,2', 1);

      expect(mockCodingProcessService.codeTestPersons).toHaveBeenCalledWith(workspaceId, '1,2', 1);
      expect(result).toEqual(expectedResult);
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

    it('should delegate to CodingValidationService', async () => {
      const expectedResult = {
        results: [{ status: 'EXISTS', combination: expectedCombinations[0] }],
        total: 1,
        missing: 0,
        page: 1,
        pageSize: 50,
        totalPages: 1
      };
      mockCodingValidationService.validateCodingCompleteness.mockResolvedValue(expectedResult);

      const result = await service.validateCodingCompleteness(workspaceId, expectedCombinations);

      expect(mockCodingValidationService.validateCodingCompleteness).toHaveBeenCalledWith(
        workspaceId,
        expectedCombinations,
        1,
        50
      );
      expect(result).toEqual(expectedResult);
    });

    it('should handle pagination parameters correctly', async () => {
      await service.validateCodingCompleteness(workspaceId, expectedCombinations, 2, 25);

      expect(mockCodingValidationService.validateCodingCompleteness).toHaveBeenCalledWith(
        workspaceId,
        expectedCombinations,
        2,
        25
      );
    });
  });

  describe('getCodingIncompleteVariables', () => {
    const workspaceId = 1;

    it('should delegate to CodingValidationService', async () => {
      const expectedResult = [
        {
          unitName: 'UNIT_1', variableId: 'var1', responseCount: 5, casesInJobs: 0, availableCases: 5
        }
      ];
      mockCodingValidationService.getCodingIncompleteVariables.mockResolvedValue(expectedResult);

      const result = await service.getCodingIncompleteVariables(workspaceId);

      expect(mockCodingValidationService.getCodingIncompleteVariables).toHaveBeenCalledWith(workspaceId, undefined);
      expect(result).toEqual(expectedResult);
    });

    it('should handle optional unitName filter', async () => {
      await service.getCodingIncompleteVariables(workspaceId, 'SPECIFIC_UNIT');

      expect(mockCodingValidationService.getCodingIncompleteVariables).toHaveBeenCalledWith(workspaceId, 'SPECIFIC_UNIT');
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

    it('should successfully export coding results by variable', async () => {
      const result = await service.exportCodingResultsByVariable(workspaceId);

      expect(result).toBeInstanceOf(Buffer);
      expect(mockCodingExportService.exportCodingResultsByVariable).toHaveBeenCalledWith(workspaceId, false, false, false, false);
    });

    it('should handle database errors during export', async () => {
      mockCodingExportService.exportCodingResultsByVariable.mockRejectedValueOnce(new Error('Could not export coding results by variable'));

      await expect(service.exportCodingResultsByVariable(workspaceId))
        .rejects.toThrow('Could not export coding results by variable');
    });
  });

  describe('getManualTestPersons', () => {
    const workspaceId = 1;
    const personIds = '1,2';

    it('should delegate to CodingResponseQueryService', async () => {
      const expectedResult = [{ id: 1, unitname: 'UNIT_1' } as unknown as ResponseEntity & { unitname: string }];
      mockCodingResponseQueryService.getManualTestPersons.mockResolvedValue(expectedResult);

      const result = await service.getManualTestPersons(workspaceId, personIds);

      expect(mockCodingResponseQueryService.getManualTestPersons).toHaveBeenCalledWith(workspaceId, personIds);
      expect(result).toEqual(expectedResult);
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
    const contentOptions: CodeBookContentSetting = {
      exportFormat: 'json',
      missingsProfile: 'default',
      hasOnlyManualCoding: false,
      hasGeneralInstructions: false,
      hasDerivedVars: false,
      hasOnlyVarsWithCodes: false,
      hasClosedVars: false,
      codeLabelToUpper: false,
      showScore: false,
      hideItemVarRelation: false
    };
    const unitIds = [1, 2];

    it('should delegate to CodebookGenerationService', async () => {
      const mockCodebook = Buffer.from('mock codebook data');
      mockCodebookGenerationService.generateCodebook.mockResolvedValue(mockCodebook);

      const result = await service.generateCodebook(workspaceId, missingsProfile, contentOptions, unitIds);

      expect(mockCodebookGenerationService.generateCodebook).toHaveBeenCalledWith(
        workspaceId,
        missingsProfile,
        contentOptions,
        unitIds
      );
      expect(result).toEqual(mockCodebook);
    });
  });

  describe('getResponsesByStatus', () => {
    const workspaceId = 1;
    const status = 'CODING_INCOMPLETE';
    const version = 'v1';

    it('should delegate to CodingResponseQueryService', async () => {
      const expectedResult = {
        data: [],
        total: 0,
        page: 1,
        limit: 10
      };
      mockCodingResponseQueryService.getResponsesByStatus.mockResolvedValue(expectedResult);

      const result = await service.getResponsesByStatus(workspaceId, status, version, 1, 10);

      expect(mockCodingResponseQueryService.getResponsesByStatus).toHaveBeenCalledWith(
        workspaceId,
        status,
        version,
        1,
        10
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('applyCodingResults', () => {
    const workspaceId = 1;
    const codingJobId = 123;

    it('should delegate to CodingJobOperationsService', async () => {
      const expectedResult = {
        success: true,
        updatedResponsesCount: 50,
        skippedReviewCount: 5,
        messageKey: 'Results applied successfully'
      };

      mockCodingJobOperationsService.applyCodingResults.mockResolvedValue(expectedResult);

      const result = await service.applyCodingResults(workspaceId, codingJobId);

      expect(mockCodingJobOperationsService.applyCodingResults).toHaveBeenCalledWith(workspaceId, codingJobId);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('createDistributedCodingJobs', () => {
    const workspaceId = 1;
    const request = {
      selectedVariables: [{ unitName: 'UNIT_1', variableId: 'var1' }],
      selectedCoders: [{ id: 1, name: 'Coder 1', username: 'coder1' }]
    };

    it('should delegate to CodingJobOperationsService', async () => {
      const expectedResult = {
        success: true,
        jobsCreated: 2,
        message: 'Jobs created successfully',
        distribution: {},
        doubleCodingInfo: {},
        jobs: []
      };

      mockCodingJobOperationsService.createDistributedCodingJobs.mockResolvedValue(expectedResult);

      const result = await service.createDistributedCodingJobs(workspaceId, request);

      expect(mockCodingJobOperationsService.createDistributedCodingJobs).toHaveBeenCalledWith(workspaceId, request);
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
