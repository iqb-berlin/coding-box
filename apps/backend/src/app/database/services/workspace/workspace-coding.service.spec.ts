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
import {
  ResponseManagementService,
  VariableAnalysisReplayService
} from '../test-results';
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
}))
);

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
    exportCodingResultsAggregated: jest
      .fn()
      .mockResolvedValue(Buffer.from('test-export-data')),
    exportCodingResultsByVariable: jest
      .fn()
      .mockResolvedValue(Buffer.from('test-export-data'))
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
    invalidateIncompleteVariablesCache: jest.fn(),
    getVariableCasesInJobs: jest.fn()
  };

  const mockCodingReviewService = {
    getCohensKappaStatistics: jest.fn(),
    getWorkspaceCohensKappaSummary: jest.fn(),
    getDoubleCodedVariablesForReview: jest.fn(),
    applyDoubleCodedResolutions: jest.fn()
  };

  const mockCodingAnalysisService = {
    getVariableAnalysis: jest.fn(),
    getResponseAnalysis: jest.fn(),
    invalidateCache: jest.fn()
  };

  const mockCodingProgressService = {
    getCodingProgressOverview: jest.fn(),
    getVariableCoverageOverview: jest.fn(),
    getCaseCoverageOverview: jest.fn()
  };

  const mockCodingReplayService = {
    generateReplayUrlForResponse: jest.fn(),
    generateReplayUrlsForItems: jest.fn()
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
                {
                  code: '999',
                  label: 'Missing',
                  description: 'Value is missing'
                }
              ]
            })
          }
        },
        {
          provide: CodingStatisticsService,
          useValue: mockCodingStatisticsService
        },
        {
          provide: VariableAnalysisReplayService,
          useValue: mockVariableAnalysisReplayService
        },
        {
          provide: ExportValidationResultsService,
          useValue: mockExportValidationResultsService
        },
        {
          provide: ExternalCodingImportService,
          useValue: mockExternalCodingImportService
        },
        {
          provide: BullJobManagementService,
          useValue: mockBullJobManagementService
        },
        { provide: CodingResultsService, useValue: mockCodingResultsService },
        { provide: CodingJobService, useValue: mockCodingJobService },
        { provide: CodingExportService, useValue: mockCodingExportService },
        { provide: CodingListService, useValue: mockCodingListService },
        {
          provide: ResponseManagementService,
          useValue: mockResponseManagementService
        },
        { provide: CodingResultsService, useValue: mockCodingResultsService },
        { provide: CodingJobService, useValue: mockCodingJobService },
        { provide: CodingExportService, useValue: mockCodingExportService },
        { provide: CodingListService, useValue: mockCodingListService },
        {
          provide: ResponseManagementService,
          useValue: mockResponseManagementService
        },
        {
          provide: CodingValidationService,
          useValue: mockCodingValidationService
        },
        { provide: CodingReviewService, useValue: mockCodingReviewService },
        { provide: CodingAnalysisService, useValue: mockCodingAnalysisService },
        { provide: CodingProgressService, useValue: mockCodingProgressService },
        { provide: CodingReplayService, useValue: mockCodingReplayService },
        { provide: CodingVersionService, useValue: mockCodingVersionService },
        {
          provide: CodingJobOperationsService,
          useValue: mockCodingJobOperationsService
        },
        {
          provide: CodebookGenerationService,
          useValue: mockCodebookGenerationService
        },
        {
          provide: CodingResponseQueryService,
          useValue: mockCodingResponseQueryService
        },
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

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId
      );

      expect(
        mockCodingProcessService.processTestPersonsBatch
      ).toHaveBeenCalledWith(
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
      mockCodingProcessService.codeTestPersons.mockResolvedValue(
        expectedResult
      );

      const result = await service.codeTestPersons(workspaceId, '1,2', 1);

      expect(mockCodingProcessService.codeTestPersons).toHaveBeenCalledWith(
        workspaceId,
        '1,2',
        1
      );
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
      mockCodingValidationService.validateCodingCompleteness.mockResolvedValue(
        expectedResult
      );

      const result = await service.validateCodingCompleteness(
        workspaceId,
        expectedCombinations
      );

      expect(
        mockCodingValidationService.validateCodingCompleteness
      ).toHaveBeenCalledWith(workspaceId, expectedCombinations, 1, 50);
      expect(result).toEqual(expectedResult);
    });

    it('should handle pagination parameters correctly', async () => {
      await service.validateCodingCompleteness(
        workspaceId,
        expectedCombinations,
        2,
        25
      );

      expect(
        mockCodingValidationService.validateCodingCompleteness
      ).toHaveBeenCalledWith(workspaceId, expectedCombinations, 2, 25);
    });
  });

  describe('getCodingIncompleteVariables', () => {
    const workspaceId = 1;

    it('should delegate to CodingValidationService', async () => {
      const expectedResult = [
        {
          unitName: 'UNIT_1',
          variableId: 'var1',
          responseCount: 5,
          casesInJobs: 0,
          availableCases: 5
        }
      ];
      mockCodingValidationService.getCodingIncompleteVariables.mockResolvedValue(
        expectedResult
      );

      const result = await service.getCodingIncompleteVariables(workspaceId);

      expect(
        mockCodingValidationService.getCodingIncompleteVariables
      ).toHaveBeenCalledWith(workspaceId, undefined);
      expect(result).toEqual(expectedResult);
    });

    it('should handle optional unitName filter', async () => {
      await service.getCodingIncompleteVariables(workspaceId, 'SPECIFIC_UNIT');

      expect(
        mockCodingValidationService.getCodingIncompleteVariables
      ).toHaveBeenCalledWith(workspaceId, 'SPECIFIC_UNIT');
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
            writeBuffer: jest
              .fn()
              .mockResolvedValue(Buffer.from('mock-excel-data'))
          }
        }))
      }));
    });

    it('should successfully export aggregated coding results', async () => {
      const result = await service.exportCodingResultsAggregated(workspaceId);

      expect(result).toBeInstanceOf(Buffer);
      expect(
        mockCodingExportService.exportCodingResultsAggregated
      ).toHaveBeenCalledWith(workspaceId, false);
    });

    it('should throw error when no coded responses found', async () => {
      mockCodingExportService.exportCodingResultsAggregated.mockRejectedValueOnce(
        new Error('Could not export aggregated coding results')
      );

      await expect(
        service.exportCodingResultsAggregated(workspaceId)
      ).rejects.toThrow('Could not export aggregated coding results');
    });

    it('should handle database errors during export', async () => {
      mockCodingExportService.exportCodingResultsAggregated.mockRejectedValueOnce(
        new Error('Could not export aggregated coding results')
      );

      await expect(
        service.exportCodingResultsAggregated(workspaceId)
      ).rejects.toThrow('Could not export aggregated coding results');
    });
  });

  describe('exportCodingResultsByVariable', () => {
    const workspaceId = 1;

    it('should successfully export coding results by variable', async () => {
      const result = await service.exportCodingResultsByVariable(workspaceId);

      expect(result).toBeInstanceOf(Buffer);
      expect(
        mockCodingExportService.exportCodingResultsByVariable
      ).toHaveBeenCalledWith(workspaceId, false, false, false, false);
    });

    it('should handle database errors during export', async () => {
      mockCodingExportService.exportCodingResultsByVariable.mockRejectedValueOnce(
        new Error('Could not export coding results by variable')
      );

      await expect(
        service.exportCodingResultsByVariable(workspaceId)
      ).rejects.toThrow('Could not export coding results by variable');
    });
  });

  describe('getManualTestPersons', () => {
    const workspaceId = 1;
    const personIds = '1,2';

    it('should delegate to CodingResponseQueryService', async () => {
      const expectedResult = [
        { id: 1, unitname: 'UNIT_1' } as unknown as ResponseEntity & {
          unitname: string;
        }
      ];
      mockCodingResponseQueryService.getManualTestPersons.mockResolvedValue(
        expectedResult
      );

      const result = await service.getManualTestPersons(workspaceId, personIds);

      expect(
        mockCodingResponseQueryService.getManualTestPersons
      ).toHaveBeenCalledWith(workspaceId, personIds);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('getCodingStatistics', () => {
    const workspaceId = 1;

    it('should delegate to CodingStatisticsService with correct version', async () => {
      const expectedStats = { totalResponses: 50, statusCounts: {} };
      mockCodingStatisticsService.getCodingStatistics = jest
        .fn()
        .mockResolvedValue(expectedStats);

      const result = await service.getCodingStatistics(workspaceId, 'v2');

      expect(
        mockCodingStatisticsService.getCodingStatistics
      ).toHaveBeenCalledWith(workspaceId, 'v2');
      expect(result).toEqual(expectedStats);
    });

    it('should default to v1 when no version specified', async () => {
      const expectedStats = { totalResponses: 50, statusCounts: {} };
      mockCodingStatisticsService.getCodingStatistics = jest
        .fn()
        .mockResolvedValue(expectedStats);

      const result = await service.getCodingStatistics(workspaceId);

      expect(
        mockCodingStatisticsService.getCodingStatistics
      ).toHaveBeenCalledWith(workspaceId, 'v1');
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
      mockCodebookGenerationService.generateCodebook.mockResolvedValue(
        mockCodebook
      );

      const result = await service.generateCodebook(
        workspaceId,
        missingsProfile,
        contentOptions,
        unitIds
      );

      expect(
        mockCodebookGenerationService.generateCodebook
      ).toHaveBeenCalledWith(
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
      mockCodingResponseQueryService.getResponsesByStatus.mockResolvedValue(
        expectedResult
      );

      const result = await service.getResponsesByStatus(
        workspaceId,
        status,
        version,
        1,
        10
      );

      expect(
        mockCodingResponseQueryService.getResponsesByStatus
      ).toHaveBeenCalledWith(workspaceId, status, version, 1, 10);
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

      mockCodingJobOperationsService.applyCodingResults.mockResolvedValue(
        expectedResult
      );

      const result = await service.applyCodingResults(workspaceId, codingJobId);

      expect(
        mockCodingJobOperationsService.applyCodingResults
      ).toHaveBeenCalledWith(workspaceId, codingJobId);
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

      mockCodingJobOperationsService.createDistributedCodingJobs.mockResolvedValue(
        expectedResult
      );

      const result = await service.createDistributedCodingJobs(
        workspaceId,
        request
      );

      expect(
        mockCodingJobOperationsService.createDistributedCodingJobs
      ).toHaveBeenCalledWith(workspaceId, request);
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

      mockBullJobManagementService.getBullJobs = jest
        .fn()
        .mockResolvedValue(expectedJobs);

      const result = await service.getBullJobs(workspaceId);

      expect(mockBullJobManagementService.getBullJobs).toHaveBeenCalledWith(
        workspaceId
      );
      expect(result).toEqual(expectedJobs);
    });
  });

  describe('Cache Management', () => {
    describe('invalidateIncompleteVariablesCache', () => {
      it('should delegate cache invalidation to CodingValidationService', async () => {
        const privateService = service as unknown as {
          invalidateIncompleteVariablesCache: (id: number) => Promise<void>;
        };
        await privateService.invalidateIncompleteVariablesCache(1);

        expect(
          mockCodingValidationService.invalidateIncompleteVariablesCache
        ).toHaveBeenCalledWith(1);
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

      mockExternalCodingImportService.importExternalCoding = jest
        .fn()
        .mockResolvedValue(expectedResult);

      const result = await service.importExternalCoding(workspaceId, body);

      expect(
        mockExternalCodingImportService.importExternalCoding
      ).toHaveBeenCalledWith(workspaceId, body);
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

      mockExternalCodingImportService.importExternalCodingWithProgress = jest
        .fn()
        .mockResolvedValue(expectedResult);

      const progressCallback = jest.fn();
      const result = await service.importExternalCodingWithProgress(
        workspaceId,
        body,
        progressCallback
      );

      expect(
        mockExternalCodingImportService.importExternalCodingWithProgress
      ).toHaveBeenCalledWith(workspaceId, body, progressCallback);
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

      mockVariableAnalysisReplayService.getVariableAnalysis = jest
        .fn()
        .mockResolvedValue(expectedResult);

      const result = await service.getVariableAnalysis(
        workspaceId,
        authToken,
        serverUrl
      );

      expect(
        mockVariableAnalysisReplayService.getVariableAnalysis
      ).toHaveBeenCalledWith(
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

      mockExportValidationResultsService.exportValidationResultsAsExcel = jest
        .fn()
        .mockResolvedValue(expectedBuffer);

      const result = await service.exportValidationResultsAsExcel(
        workspaceId,
        cacheKey
      );

      expect(
        mockExportValidationResultsService.exportValidationResultsAsExcel
      ).toHaveBeenCalledWith(workspaceId, cacheKey);
      expect(result).toEqual(expectedBuffer);
    });
  });

  describe('Job Management Operations', () => {
    const jobId = 'test-job-123';

    describe('pauseJob', () => {
      it('should delegate to BullJobManagementService', async () => {
        const expectedResult = {
          success: true,
          message: 'Job paused successfully'
        };
        mockBullJobManagementService.pauseJob.mockResolvedValue(expectedResult);

        const result = await service.pauseJob(jobId);

        expect(mockBullJobManagementService.pauseJob).toHaveBeenCalledWith(
          jobId
        );
        expect(result).toEqual(expectedResult);
      });

      it('should handle pause failure', async () => {
        const expectedResult = { success: false, message: 'Job not found' };
        mockBullJobManagementService.pauseJob.mockResolvedValue(expectedResult);

        const result = await service.pauseJob(jobId);

        expect(result.success).toBe(false);
      });
    });

    describe('resumeJob', () => {
      it('should delegate to BullJobManagementService', async () => {
        const expectedResult = {
          success: true,
          message: 'Job resumed successfully'
        };
        mockBullJobManagementService.resumeJob.mockResolvedValue(
          expectedResult
        );

        const result = await service.resumeJob(jobId);

        expect(mockBullJobManagementService.resumeJob).toHaveBeenCalledWith(
          jobId
        );
        expect(result).toEqual(expectedResult);
      });

      it('should handle resume failure', async () => {
        const expectedResult = {
          success: false,
          message: 'Job not found or not paused'
        };
        mockBullJobManagementService.resumeJob.mockResolvedValue(
          expectedResult
        );

        const result = await service.resumeJob(jobId);

        expect(result.success).toBe(false);
      });
    });

    describe('restartJob', () => {
      it('should delegate to BullJobManagementService', async () => {
        const expectedResult = {
          success: true,
          message: 'Job restarted successfully',
          jobId: 'new-job-123'
        };
        mockBullJobManagementService.restartJob.mockResolvedValue(
          expectedResult
        );

        const result = await service.restartJob(jobId);

        expect(mockBullJobManagementService.restartJob).toHaveBeenCalledWith(
          jobId
        );
        expect(result).toEqual(expectedResult);
      });

      it('should handle restart failure', async () => {
        const expectedResult = {
          success: false,
          message: 'Job not found or not failed'
        };
        mockBullJobManagementService.restartJob.mockResolvedValue(
          expectedResult
        );

        const result = await service.restartJob(jobId);

        expect(result.success).toBe(false);
      });
    });
  });

  describe('Cohens Kappa Statistics', () => {
    const workspaceId = 1;

    it('should delegate to CodingReviewService for workspace summary', async () => {
      const expectedResult = {
        coderPairs: [
          {
            coder1Id: 1,
            coder1Name: 'Coder 1',
            coder2Id: 2,
            coder2Name: 'Coder 2',
            kappa: 0.85,
            agreement: 0.92,
            totalSharedResponses: 50,
            validPairs: 48,
            interpretation: 'Almost perfect agreement'
          }
        ],
        workspaceSummary: {
          totalDoubleCodedResponses: 100,
          totalCoderPairs: 3,
          averageKappa: 0.82,
          variablesIncluded: 25,
          codersIncluded: 4
        }
      };
      mockCodingReviewService.getWorkspaceCohensKappaSummary.mockResolvedValue(
        expectedResult
      );

      const result = await service.getWorkspaceCohensKappaSummary(workspaceId);

      expect(
        mockCodingReviewService.getWorkspaceCohensKappaSummary
      ).toHaveBeenCalledWith(workspaceId, true);
      expect(result).toEqual(expectedResult);
    });

    it('should handle case with no double-coded responses', async () => {
      const expectedResult = {
        coderPairs: [],
        workspaceSummary: {
          totalDoubleCodedResponses: 0,
          totalCoderPairs: 0,
          averageKappa: null,
          variablesIncluded: 0,
          codersIncluded: 0
        }
      };
      mockCodingReviewService.getWorkspaceCohensKappaSummary.mockResolvedValue(
        expectedResult
      );

      const result = await service.getWorkspaceCohensKappaSummary(workspaceId);

      expect(result.workspaceSummary.totalDoubleCodedResponses).toBe(0);
      expect(result.workspaceSummary.averageKappa).toBeNull();
    });
  });

  describe('Progress Overview', () => {
    const workspaceId = 1;

    describe('getCodingProgressOverview', () => {
      it('should delegate to CodingProgressService', async () => {
        const expectedResult = {
          totalCasesToCode: 1000,
          completedCases: 750,
          completionPercentage: 75
        };
        mockCodingProgressService.getCodingProgressOverview.mockResolvedValue(
          expectedResult
        );

        const result = await service.getCodingProgressOverview(workspaceId);

        expect(
          mockCodingProgressService.getCodingProgressOverview
        ).toHaveBeenCalledWith(workspaceId);
        expect(result).toEqual(expectedResult);
      });

      it('should handle zero total cases', async () => {
        const expectedResult = {
          totalCasesToCode: 0,
          completedCases: 0,
          completionPercentage: 0
        };
        mockCodingProgressService.getCodingProgressOverview.mockResolvedValue(
          expectedResult
        );

        const result = await service.getCodingProgressOverview(workspaceId);

        expect(result.completionPercentage).toBe(0);
      });
    });

    describe('getCaseCoverageOverview', () => {
      it('should delegate to CodingProgressService', async () => {
        const expectedResult = {
          totalCasesToCode: 1000,
          casesInJobs: 900,
          doubleCodedCases: 200,
          singleCodedCases: 700,
          unassignedCases: 100,
          coveragePercentage: 90
        };
        mockCodingProgressService.getCaseCoverageOverview.mockResolvedValue(
          expectedResult
        );

        const result = await service.getCaseCoverageOverview(workspaceId);

        expect(
          mockCodingProgressService.getCaseCoverageOverview
        ).toHaveBeenCalledWith(workspaceId);
        expect(result).toEqual(expectedResult);
      });

      it('should handle full coverage', async () => {
        const expectedResult = {
          totalCasesToCode: 500,
          casesInJobs: 500,
          doubleCodedCases: 100,
          singleCodedCases: 400,
          unassignedCases: 0,
          coveragePercentage: 100
        };
        mockCodingProgressService.getCaseCoverageOverview.mockResolvedValue(
          expectedResult
        );

        const result = await service.getCaseCoverageOverview(workspaceId);

        expect(result.coveragePercentage).toBe(100);
        expect(result.unassignedCases).toBe(0);
      });
    });
  });

  describe('Variable Coverage', () => {
    const workspaceId = 1;

    it('should delegate to CodingProgressService for variable coverage overview', async () => {
      const expectedResult = {
        totalVariables: 50,
        coveredVariables: 45,
        coveredByDraft: 10,
        coveredByPendingReview: 15,
        coveredByApproved: 20,
        conflictedVariables: 2,
        missingVariables: 5,
        partiallyAbgedeckteVariablen: 3,
        fullyAbgedeckteVariablen: 42,
        coveragePercentage: 90,
        variableCaseCounts: [
          { unitName: 'UNIT_1', variableId: 'var1', caseCount: 25 }
        ],
        coverageByStatus: {
          draft: ['var1', 'var2'],
          pending_review: ['var3', 'var4'],
          approved: ['var5', 'var6'],
          conflicted: [
            {
              variableKey: 'var_conflict',
              conflictingDefinitions: [
                { id: 1, status: 'draft' },
                { id: 2, status: 'approved' }
              ]
            }
          ]
        }
      };
      mockCodingProgressService.getVariableCoverageOverview.mockResolvedValue(
        expectedResult
      );

      const result = await service.getVariableCoverageOverview(workspaceId);

      expect(
        mockCodingProgressService.getVariableCoverageOverview
      ).toHaveBeenCalledWith(workspaceId);
      expect(result).toEqual(expectedResult);
    });

    it('should handle empty workspace', async () => {
      const expectedResult = {
        totalVariables: 0,
        coveredVariables: 0,
        coveredByDraft: 0,
        coveredByPendingReview: 0,
        coveredByApproved: 0,
        conflictedVariables: 0,
        missingVariables: 0,
        partiallyAbgedeckteVariablen: 0,
        fullyAbgedeckteVariablen: 0,
        coveragePercentage: 0,
        variableCaseCounts: [],
        coverageByStatus: {
          draft: [],
          pending_review: [],
          approved: [],
          conflicted: []
        }
      };
      mockCodingProgressService.getVariableCoverageOverview.mockResolvedValue(
        expectedResult
      );

      const result = await service.getVariableCoverageOverview(workspaceId);

      expect(result.totalVariables).toBe(0);
      expect(result.coveragePercentage).toBe(0);
    });
  });

  describe('Version Reset', () => {
    const workspaceId = 1;

    it('should delegate to CodingVersionService for version reset', async () => {
      const expectedResult = {
        affectedResponseCount: 150,
        cascadeResetVersions: ['v2', 'v3'],
        message: 'Successfully reset 150 responses for version v1'
      };
      mockCodingVersionService.resetCodingVersion.mockResolvedValue(
        expectedResult
      );

      const result = await service.resetCodingVersion(workspaceId, 'v1');

      expect(mockCodingVersionService.resetCodingVersion).toHaveBeenCalledWith(
        workspaceId,
        'v1',
        undefined,
        undefined
      );
      expect(result).toEqual(expectedResult);
    });

    it('should support version v2 reset with filters', async () => {
      const unitFilters = ['UNIT_1', 'UNIT_2'];
      const variableFilters = ['var1', 'var2'];
      const expectedResult = {
        affectedResponseCount: 50,
        cascadeResetVersions: ['v3'],
        message: 'Successfully reset 50 responses for version v2'
      };
      mockCodingVersionService.resetCodingVersion.mockResolvedValue(
        expectedResult
      );

      const result = await service.resetCodingVersion(
        workspaceId,
        'v2',
        unitFilters,
        variableFilters
      );

      expect(mockCodingVersionService.resetCodingVersion).toHaveBeenCalledWith(
        workspaceId,
        'v2',
        unitFilters,
        variableFilters
      );
      expect(result).toEqual(expectedResult);
    });

    it('should support version v3 reset', async () => {
      const expectedResult = {
        affectedResponseCount: 25,
        cascadeResetVersions: [],
        message: 'Successfully reset 25 responses for version v3'
      };
      mockCodingVersionService.resetCodingVersion.mockResolvedValue(
        expectedResult
      );

      const result = await service.resetCodingVersion(workspaceId, 'v3');

      expect(result.cascadeResetVersions).toEqual([]);
    });

    it('should handle reset with no affected responses', async () => {
      const expectedResult = {
        affectedResponseCount: 0,
        cascadeResetVersions: [],
        message: 'No responses found to reset for version v1'
      };
      mockCodingVersionService.resetCodingVersion.mockResolvedValue(
        expectedResult
      );

      const result = await service.resetCodingVersion(workspaceId, 'v1');

      expect(result.affectedResponseCount).toBe(0);
    });
  });

  describe('Additional Operations', () => {
    const workspaceId = 1;

    describe('bulkApplyCodingResults', () => {
      it('should delegate to CodingJobOperationsService', async () => {
        const expectedResult = {
          success: true,
          jobsProcessed: 5,
          totalUpdatedResponses: 100,
          totalSkippedReview: 10,
          message: 'Successfully applied coding results',
          results: [
            {
              jobId: 1,
              jobName: 'Job 1',
              hasIssues: false,
              skipped: false,
              result: {
                success: true,
                updatedResponsesCount: 20,
                skippedReviewCount: 2,
                message: 'Applied'
              }
            }
          ]
        };
        mockCodingJobOperationsService.bulkApplyCodingResults.mockResolvedValue(
          expectedResult
        );

        const result = await service.bulkApplyCodingResults(workspaceId);

        expect(
          mockCodingJobOperationsService.bulkApplyCodingResults
        ).toHaveBeenCalledWith(workspaceId);
        expect(result).toEqual(expectedResult);
      });
    });

    describe('getVariableCasesInJobs', () => {
      it('should delegate to CodingValidationService', async () => {
        const mockMap = new Map([
          ['UNIT_1:var1', 15],
          ['UNIT_1:var2', 20]
        ]);
        mockCodingValidationService.getVariableCasesInJobs.mockResolvedValue(
          mockMap
        );

        const result = await service.getVariableCasesInJobs(workspaceId);

        expect(
          mockCodingValidationService.getVariableCasesInJobs
        ).toHaveBeenCalledWith(workspaceId);
        expect(result).toBeInstanceOf(Map);
        expect(result.get('UNIT_1:var1')).toBe(15);
      });
    });

    describe('getResponseAnalysis', () => {
      it('should delegate to CodingAnalysisService', async () => {
        const expectedResult = {
          emptyResponses: [
            {
              responseId: 1,
              unitName: 'UNIT_1',
              variableId: 'var1',
              value: null
            }
          ],
          duplicateValues: [
            {
              value: 'answer1',
              occurrences: [
                { responseId: 1, unitName: 'UNIT_1', variableId: 'var1' }
              ]
            }
          ],
          totalResponses: 100,
          analysisTimestamp: new Date()
        };
        mockCodingAnalysisService.getResponseAnalysis.mockResolvedValue(
          expectedResult
        );

        const result = await service.getResponseAnalysis(workspaceId);

        expect(
          mockCodingAnalysisService.getResponseAnalysis
        ).toHaveBeenCalledWith(workspaceId);
        expect(result).toEqual(expectedResult);
      });
    });

    describe('getDoubleCodedVariablesForReview', () => {
      it('should delegate to CodingReviewService', async () => {
        const expectedResult = {
          data: [
            {
              responseId: 1,
              unitName: 'UNIT_1',
              variableId: 'var1',
              personLogin: 'user1',
              personCode: 'code1',
              bookletName: 'Booklet 1',
              givenAnswer: 'Sample answer',
              coderResults: [
                {
                  coderId: 1,
                  coderName: 'Coder A',
                  jobId: 1,
                  code: 1,
                  score: 1,
                  notes: 'Note 1',
                  codedAt: new Date()
                },
                {
                  coderId: 2,
                  coderName: 'Coder B',
                  jobId: 2,
                  code: 2,
                  score: 2,
                  notes: 'Note 2',
                  codedAt: new Date()
                }
              ]
            }
          ],
          total: 1,
          page: 1,
          limit: 50
        };
        mockCodingReviewService.getDoubleCodedVariablesForReview.mockResolvedValue(
          expectedResult
        );

        const result = await service.getDoubleCodedVariablesForReview(
          workspaceId,
          1,
          50
        );

        expect(
          mockCodingReviewService.getDoubleCodedVariablesForReview
        ).toHaveBeenCalledWith(workspaceId, 1, 50, false, false);
        expect(result).toEqual(expectedResult);
      });
    });

    describe('applyDoubleCodedResolutions', () => {
      it('should delegate to CodingReviewService', async () => {
        const decisions = [
          {
            responseId: 1,
            selectedJobId: 1,
            resolutionComment: 'Resolution note'
          }
        ];
        const expectedResult = {
          success: true,
          appliedCount: 1,
          failedCount: 0,
          skippedCount: 0,
          message: 'Successfully applied 1 resolution(s)'
        };
        mockCodingReviewService.applyDoubleCodedResolutions.mockResolvedValue(
          expectedResult
        );

        const result = await service.applyDoubleCodedResolutions(
          workspaceId,
          decisions
        );

        expect(
          mockCodingReviewService.applyDoubleCodedResolutions
        ).toHaveBeenCalledWith(workspaceId, decisions);
        expect(result).toEqual(expectedResult);
      });
    });

    describe('generateReplayUrlsForItems', () => {
      it('should delegate to CodingReplayService', async () => {
        const items = [
          {
            responseId: 1,
            unitName: 'UNIT_1',
            unitAlias: null,
            variableId: 'var1',
            variableAnchor: 'anchor1',
            bookletName: 'Booklet 1',
            personLogin: 'user1',
            personCode: 'code1',
            personGroup: 'group1'
          }
        ];
        const serverUrl = 'https://example.com';
        const expectedResult = [
          {
            ...items[0],
            replayUrl: 'https://example.com/replay/1'
          }
        ];
        mockCodingReplayService.generateReplayUrlsForItems.mockResolvedValue(
          expectedResult
        );

        const result = await service.generateReplayUrlsForItems(
          workspaceId,
          items,
          serverUrl
        );

        expect(
          mockCodingReplayService.generateReplayUrlsForItems
        ).toHaveBeenCalledWith(workspaceId, items, serverUrl);
        expect(result).toEqual(expectedResult);
      });
    });
  });

  describe('Edge Cases and Error Scenarios', () => {
    const workspaceId = 1;

    it('should handle service errors in getCodingStatistics', async () => {
      mockCodingStatisticsService.getCodingStatistics.mockRejectedValue(
        new Error('Database connection failed')
      );

      await expect(service.getCodingStatistics(workspaceId)).rejects.toThrow(
        'Database connection failed'
      );
    });

    it('should handle errors in exportCodingResultsByVariable with options', async () => {
      mockCodingExportService.exportCodingResultsByVariable.mockRejectedValue(
        new Error('Export failed')
      );

      await expect(
        service.exportCodingResultsByVariable(
          workspaceId,
          true,
          true,
          true,
          true
        )
      ).rejects.toThrow('Export failed');
    });

    it('should handle validation service errors', async () => {
      mockCodingValidationService.validateCodingCompleteness.mockRejectedValue(
        new Error('Validation error')
      );

      await expect(
        service.validateCodingCompleteness(workspaceId, [])
      ).rejects.toThrow('Validation error');
    });

    it('should handle empty combinations in validateCodingCompleteness', async () => {
      const expectedResult = {
        results: [],
        total: 0,
        missing: 0,
        page: 1,
        pageSize: 50,
        totalPages: 0
      };
      mockCodingValidationService.validateCodingCompleteness.mockResolvedValue(
        expectedResult
      );

      const result = await service.validateCodingCompleteness(workspaceId, []);

      expect(result.total).toBe(0);
      expect(result.results).toEqual([]);
    });

    it('should handle null return from generateCodebook', async () => {
      mockCodebookGenerationService.generateCodebook.mockResolvedValue(null);

      const result = await service.generateCodebook(
        workspaceId,
        1,
        {} as CodeBookContentSetting,
        []
      );

      expect(result).toBeNull();
    });

    it('should handle missing workspace in external coding import', async () => {
      mockExternalCodingImportService.importExternalCoding.mockRejectedValue(
        new Error('Workspace not found')
      );

      await expect(
        service.importExternalCoding(999, { file: 'data' })
      ).rejects.toThrow('Workspace not found');
    });

    it('should handle progress callback errors in importExternalCodingWithProgress', async () => {
      const progressCallback = jest.fn().mockImplementation(() => {
        throw new Error('Callback error');
      });
      mockExternalCodingImportService.importExternalCodingWithProgress.mockRejectedValue(
        new Error('Import failed')
      );

      await expect(
        service.importExternalCodingWithProgress(
          workspaceId,
          { file: 'data' },
          progressCallback
        )
      ).rejects.toThrow('Import failed');
    });

    it('should handle errors in getResponsesByStatus', async () => {
      mockCodingResponseQueryService.getResponsesByStatus.mockRejectedValue(
        new Error('Query failed')
      );

      await expect(
        service.getResponsesByStatus(workspaceId, 'INVALID_STATUS', 'v1')
      ).rejects.toThrow('Query failed');
    });

    it('should handle version reset errors', async () => {
      mockCodingVersionService.resetCodingVersion.mockRejectedValue(
        new Error('Version reset failed')
      );

      await expect(
        service.resetCodingVersion(workspaceId, 'v1')
      ).rejects.toThrow('Version reset failed');
    });

    it('should handle progress overview errors', async () => {
      mockCodingProgressService.getCodingProgressOverview.mockRejectedValue(
        new Error('Progress calculation failed')
      );

      await expect(
        service.getCodingProgressOverview(workspaceId)
      ).rejects.toThrow('Progress calculation failed');
    });

    it('should handle Kappa statistics errors', async () => {
      mockCodingReviewService.getWorkspaceCohensKappaSummary.mockRejectedValue(
        new Error('Kappa calculation failed')
      );

      await expect(
        service.getWorkspaceCohensKappaSummary(workspaceId)
      ).rejects.toThrow('Kappa calculation failed');
    });

    it('should handle empty string personIds in getManualTestPersons', async () => {
      mockCodingResponseQueryService.getManualTestPersons.mockResolvedValue([]);

      const result = await service.getManualTestPersons(workspaceId, '');

      expect(
        mockCodingResponseQueryService.getManualTestPersons
      ).toHaveBeenCalledWith(workspaceId, '');
      expect(result).toEqual([]);
    });

    it('should handle job operations with invalid job IDs', async () => {
      mockCodingJobOperationsService.applyCodingResults.mockRejectedValue(
        new Error('Job not found')
      );

      await expect(
        service.applyCodingResults(workspaceId, 999)
      ).rejects.toThrow('Job not found');
    });

    it('should handle distributed job creation with empty selections', async () => {
      const request = {
        selectedVariables: [],
        selectedCoders: []
      };
      const expectedResult = {
        success: true,
        jobsCreated: 0,
        message: 'No jobs created - empty selection',
        distribution: {},
        doubleCodingInfo: {},
        jobs: []
      };
      mockCodingJobOperationsService.createDistributedCodingJobs.mockResolvedValue(
        expectedResult
      );

      const result = await service.createDistributedCodingJobs(
        workspaceId,
        request
      );

      expect(result.jobsCreated).toBe(0);
    });

    it('should handle replay URL generation errors', async () => {
      mockCodingReplayService.generateReplayUrlForResponse.mockRejectedValue(
        new Error('Invalid response ID')
      );

      await expect(
        service.generateReplayUrlForResponse(
          workspaceId,
          999,
          'https://example.com',
          'token'
        )
      ).rejects.toThrow('Invalid response ID');
    });
  });
});
