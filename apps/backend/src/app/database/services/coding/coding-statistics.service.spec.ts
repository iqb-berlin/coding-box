import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bull';
import { CodingStatisticsService } from './coding-statistics.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CacheService } from '../../../cache/cache.service';
import { JobQueueService } from '../../../job-queue/job-queue.service';
import { BullJobManagementService } from '../jobs/bull-job-management.service';
import { WorkspaceCoreService } from '../workspace/workspace-core.service';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';

describe('CodingStatisticsService', () => {
  let service: CodingStatisticsService;
  let mockResponseRepository: jest.Mocked<Repository<ResponseEntity>>;
  let mockCacheService: jest.Mocked<CacheService>;
  let mockJobQueueService: jest.Mocked<JobQueueService>;
  let mockBullJobManagementService: jest.Mocked<BullJobManagementService>;
  let mockWorkspaceCoreService: jest.Mocked<WorkspaceCoreService>;
  let mockWorkspaceExclusionService: jest.Mocked<WorkspaceExclusionService>;
  let mockWorkspaceFilesService: jest.Mocked<WorkspaceFilesService>;

  const mockFileUploadRepository = {
    find: jest.fn()
  };

  beforeEach(async () => {
    mockResponseRepository = {
      query: jest.fn(),
      manager: {
        getRepository: jest.fn(() => mockFileUploadRepository)
      }
    } as unknown as jest.Mocked<Repository<ResponseEntity>>;

    mockCacheService = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      incr: jest.fn().mockResolvedValue(1)
    } as unknown as jest.Mocked<CacheService>;

    mockJobQueueService = {
      getTestPersonCodingJob: jest.fn(),
      getCodingStatisticsJob: jest.fn(),
      getActiveCodingStatisticsJob: jest.fn().mockResolvedValue(undefined),
      addCodingStatisticsJob: jest.fn(),
      cancelTestPersonCodingJob: jest.fn(),
      deleteTestPersonCodingJob: jest.fn(),
      assertNoDependencyConflicts: jest.fn().mockResolvedValue(undefined)
    } as unknown as jest.Mocked<JobQueueService>;

    mockBullJobManagementService = {
      mapJobStateToStatus: jest.fn(),
      extractJobResult: jest.fn()
    } as unknown as jest.Mocked<BullJobManagementService>;

    mockWorkspaceCoreService = {
      getIgnoredUnits: jest.fn()
    } as unknown as jest.Mocked<WorkspaceCoreService>;

    mockWorkspaceFilesService = {
      getUnitVariableMap: jest.fn().mockResolvedValue(new Map([
        ['Unit1', new Set(['var1'])]
      ])),
      getDerivedVariableMap: jest.fn().mockResolvedValue(new Map())
    } as unknown as jest.Mocked<WorkspaceFilesService>;

    mockWorkspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    } as unknown as jest.Mocked<WorkspaceExclusionService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CodingStatisticsService,
        {
          provide: getRepositoryToken(ResponseEntity),
          useValue: mockResponseRepository
        },
        { provide: CacheService, useValue: mockCacheService },
        { provide: JobQueueService, useValue: mockJobQueueService },
        {
          provide: BullJobManagementService,
          useValue: mockBullJobManagementService
        },
        { provide: WorkspaceCoreService, useValue: mockWorkspaceCoreService },
        { provide: WorkspaceFilesService, useValue: mockWorkspaceFilesService },
        {
          provide: WorkspaceExclusionService,
          useValue: mockWorkspaceExclusionService
        }
      ]
    }).compile();

    service = module.get<CodingStatisticsService>(CodingStatisticsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Statistics calculation (v1, v2, v3)', () => {
    beforeEach(() => {
      jest
        .spyOn(
          service as unknown as {
            getUnitVariables: (
              workspaceId: number
            ) => Promise<Record<string, string[]>>;
          },
          'getUnitVariables'
        )
        .mockResolvedValue({ Unit1: ['var1'] });
    });

    it('should calculate statistics for v1 version', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockWorkspaceCoreService.getIgnoredUnits.mockResolvedValue([]);
      mockResponseRepository.query.mockResolvedValue([
        { statusValue: 5, isDerived: false, count: '10' },
        { statusValue: 8, isDerived: false, count: '20' }
      ]);

      const result = await service.getCodingStatistics(1, 'v1');

      expect(result.totalResponses).toBe(30);
      expect(result.baseResponseCount).toBe(30);
      expect(result.derivedResponseCount).toBe(0);
      expect(result.statusCounts).toEqual({ 5: 10, 8: 20 });
      expect(mockCacheService.set).toHaveBeenCalled();
    });

    it('should calculate statistics for v2 version', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockWorkspaceCoreService.getIgnoredUnits.mockResolvedValue([]);
      mockResponseRepository.query.mockResolvedValue([
        { statusValue: 5, isDerived: false, count: '15' },
        { statusValue: 9, isDerived: false, count: '25' }
      ]);

      const result = await service.getCodingStatistics(1, 'v2');

      expect(result.totalResponses).toBe(40);
      expect(mockCacheService.set).toHaveBeenCalled();
    });

    it('should calculate statistics for v3 version', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockWorkspaceCoreService.getIgnoredUnits.mockResolvedValue([]);
      mockResponseRepository.query.mockResolvedValue([
        { statusValue: 5, isDerived: false, count: '5' }
      ]);

      const result = await service.getCodingStatistics(1, 'v3');

      expect(result.totalResponses).toBe(5);
    });

    it('should use numeric status_v3 before falling back to effective earlier versions', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockWorkspaceCoreService.getIgnoredUnits.mockResolvedValue([]);
      mockResponseRepository.query.mockResolvedValue([]);

      await service.getCodingStatistics(1, 'v3');

      const queryCall = mockResponseRepository.query.mock.calls[0];
      expect(queryCall[0]).not.toContain('response.status_v3::smallint');
      expect(queryCall[0]).not.toContain("response.status_v3 ~ '^-?[0-9]+$'");
      expect(queryCall[0]).toContain('COALESCE(response.status_v3');
      expect(queryCall[0]).toContain('response.status_v2 = 8');
      expect(queryCall[0]).toContain('response.status_v2, response.status_v1');
    });

    it('should ignore open manual-coding placeholders in effective v2/v3 status', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockWorkspaceCoreService.getIgnoredUnits.mockResolvedValue([]);
      mockResponseRepository.query.mockResolvedValue([]);

      await service.getCodingStatistics(1, 'v2');

      const queryCall = mockResponseRepository.query.mock.calls[0];
      expect(queryCall[0]).toContain('FROM coding_job_unit effective_status_cju');
      expect(queryCall[0]).toContain("effective_status_cj.status <> 'results_applied'");
      expect(queryCall[0]).toContain("effective_status_applied_cj.status = 'results_applied'");
      expect(queryCall[0]).toContain('THEN response.status_v1');
    });

    it('should default to v1 when no version specified', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockWorkspaceCoreService.getIgnoredUnits.mockResolvedValue([]);
      mockResponseRepository.query.mockResolvedValue([]);

      await service.getCodingStatistics(1);

      expect(mockResponseRepository.query).toHaveBeenCalledWith(
        expect.stringContaining('response.status_v1'),
        expect.any(Array)
      );
    });
  });

  describe('Status aggregation', () => {
    beforeEach(() => {
      jest
        .spyOn(
          service as unknown as {
            getUnitVariables: (
              workspaceId: number
            ) => Promise<Record<string, string[]>>;
          },
          'getUnitVariables'
        )
        .mockResolvedValue({ Unit1: ['var1'] });
    });

    it('should aggregate status counts correctly', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockWorkspaceCoreService.getIgnoredUnits.mockResolvedValue([]);
      mockResponseRepository.query.mockResolvedValue([
        { statusValue: 5, isDerived: false, count: '100' },
        { statusValue: 8, isDerived: false, count: '50' },
        { statusValue: 9, isDerived: false, count: '25' }
      ]);

      const result = await service.getCodingStatistics(1);

      expect(result.totalResponses).toBe(175);
      expect(Object.keys(result.statusCounts).length).toBe(3);
    });

    it('should handle NaN counts gracefully', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockWorkspaceCoreService.getIgnoredUnits.mockResolvedValue([]);
      mockResponseRepository.query.mockResolvedValue([
        { statusValue: 5, isDerived: false, count: 'invalid' }
      ]);

      const result = await service.getCodingStatistics(1);

      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts[5]).toBe(0);
    });

    it('should include autocoder-generated responses in derived answer counts', async () => {
      mockCacheService.get.mockResolvedValue(null);
      jest
        .spyOn(
          service as unknown as {
            getUnitVariables: (
              workspaceId: number
            ) => Promise<Record<string, string[]>>;
          },
          'getUnitVariables'
        )
        .mockResolvedValue({ Unit1: ['baseVar', 'derivedVar'] });
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(new Map([
        ['Unit1', new Set(['baseVar', 'derivedVar'])]
      ]));
      mockWorkspaceFilesService.getDerivedVariableMap.mockResolvedValue(new Map([
        ['Unit1', new Set(['derivedVar'])]
      ]));
      mockResponseRepository.query.mockResolvedValue([
        { statusValue: 5, isDerived: false, count: '7' },
        { statusValue: 5, isDerived: true, count: '3' },
        { statusValue: 8, isDerived: true, count: '2' }
      ]);

      const result = await service.getCodingStatistics(1);

      expect(result.totalResponses).toBe(12);
      expect(result.baseResponseCount).toBe(7);
      expect(result.derivedResponseCount).toBe(5);
      expect(result.derivedVariableCount).toBe(1);
      expect(result.statusCounts).toEqual({ 5: 10, 8: 2 });
      expect(result.derivedStatusCounts).toEqual({ 5: 3, 8: 2 });
      expect(mockResponseRepository.query).toHaveBeenCalledWith(
        expect.stringContaining('response.is_autocoder_generated = TRUE'),
        expect.arrayContaining([
          expect.arrayContaining(['Unit1\u001FbaseVar', 'Unit1\u001FderivedVar'])
        ])
      );
      expect(mockResponseRepository.query.mock.calls[0][0]).not.toContain(
        'OR response.is_autocoder_generated = TRUE'
      );
    });

    it('should exclude raw response states from statistics totals', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockWorkspaceCoreService.getIgnoredUnits.mockResolvedValue([]);
      mockResponseRepository.query.mockResolvedValue([
        { statusValue: 5, isDerived: false, count: '4' }
      ]);

      const result = await service.getCodingStatistics(1);

      expect(result.totalResponses).toBe(4);
      expect(mockResponseRepository.query.mock.calls[0][0]).toContain(
        '<> ALL($5::smallint[])'
      );
      expect(mockResponseRepository.query.mock.calls[0][1]).toEqual(
        expect.arrayContaining([[0, 1, 2, 3, 10]])
      );
    });
  });

  describe('Cache invalidation', () => {
    it('should invalidate cache for specific version', async () => {
      mockCacheService.delete.mockResolvedValue(true);

      await service.invalidateCache(1, 'v1');

      expect(mockCacheService.delete).toHaveBeenCalledWith(
        'coding-statistics:schema-v4:1:v1'
      );
    });

    it('should invalidate all versions when no version specified', async () => {
      mockCacheService.delete.mockResolvedValue(true);

      await service.invalidateCache(1);

      expect(mockCacheService.delete).toHaveBeenCalledWith(
        'coding-statistics:schema-v4:1:v1'
      );
      expect(mockCacheService.delete).toHaveBeenCalledWith(
        'coding-statistics:schema-v4:1:v2'
      );
      expect(mockCacheService.delete).toHaveBeenCalledWith(
        'coding-statistics:schema-v4:1:v3'
      );
    });

    it('should invalidate incomplete variables cache', async () => {
      mockCacheService.delete.mockResolvedValue(true);

      await service.invalidateIncompleteVariablesCache(1);

      expect(mockCacheService.incr).toHaveBeenCalledWith(
        'coding_incomplete_variables_version:1'
      );
      expect(mockCacheService.delete).toHaveBeenCalledWith(
        'coding_incomplete_variables_v8:1'
      );
      expect(mockCacheService.delete).toHaveBeenCalledWith(
        'coding_incomplete_variables_scope_v1:1'
      );
    });

    it('should skip cache when skipCache is true', async () => {
      jest
        .spyOn(
          service as unknown as {
            getUnitVariables: (
              workspaceId: number
            ) => Promise<Record<string, string[]>>;
          },
          'getUnitVariables'
        )
        .mockResolvedValue({ Unit1: ['var1'] });
      mockWorkspaceCoreService.getIgnoredUnits.mockResolvedValue([]);
      mockResponseRepository.query.mockResolvedValue([]);

      await service.getCodingStatistics(1, 'v1', true);

      expect(mockCacheService.get).not.toHaveBeenCalled();
    });
  });

  describe('Version-specific logic', () => {
    beforeEach(() => {
      jest
        .spyOn(
          service as unknown as {
            getUnitVariables: (
              workspaceId: number
            ) => Promise<Record<string, string[]>>;
          },
          'getUnitVariables'
        )
        .mockResolvedValue({ Unit1: ['var1'] });
    });

    it.skip('should use COALESCE for v2 version query', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockWorkspaceCoreService.getIgnoredUnits.mockResolvedValue([]);
      mockResponseRepository.query.mockResolvedValue([]);

      await service.getCodingStatistics(1, 'v2');

      const queryCall = mockResponseRepository.query.mock.calls[0];
      expect(queryCall[0]).toContain('response.status_v2 = 8');
      expect(queryCall[0]).toContain('COALESCE(response.status_v2, response.status_v1)');
      expect(queryCall[0]).toContain('code_v2');
    });

    it.skip('should use v3 effective status expression', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockWorkspaceCoreService.getIgnoredUnits.mockResolvedValue([]);
      mockResponseRepository.query.mockResolvedValue([]);

      await service.getCodingStatistics(1, 'v3');

      const queryCall = mockResponseRepository.query.mock.calls[0];
      expect(queryCall[0]).toContain('COALESCE(response.status_v3');
      expect(queryCall[0]).toContain('code_v2');
    });
  });

  describe('Cache operations', () => {
    it('should return cached statistics when available', async () => {
      const cachedStats = { totalResponses: 100, statusCounts: { 1: 100 } };
      mockCacheService.get.mockResolvedValue(cachedStats);

      const result = await service.getCodingStatistics(1);

      expect(result).toEqual({
        ...cachedStats,
        baseResponseCount: 0,
        derivedResponseCount: 0,
        derivedVariableCount: 0,
        derivedStatusCounts: {}
      });
      expect(mockResponseRepository.query).not.toHaveBeenCalled();
    });
  });

  describe('Unit variable parsing', () => {
    it('should filter out ignored units', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockResponseRepository.query.mockResolvedValueOnce([
        { workspace_id: '1' }
      ]);
      mockWorkspaceExclusionService.resolveExclusionsForQueries.mockResolvedValue({
        globalIgnoredUnits: ['UNIT1'],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      });
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(new Map([
        ['Unit1', new Set(['var1'])]
      ]));
      mockWorkspaceFilesService.getDerivedVariableMap.mockResolvedValue(new Map());

      const result = await service.getCodingStatistics(1);

      // When all units are filtered out, returns empty statistics
      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
      expect(mockCacheService.set).toHaveBeenCalled();
    });
  });

  describe('Job management', () => {
    it('should create coding statistics job when no cache exists', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.delete.mockResolvedValue(true);
      const mockJob: Partial<Job> = { id: 'job-123' };
      mockJobQueueService.addCodingStatisticsJob.mockResolvedValue(
        mockJob as Job
      );

      const result = await service.createCodingStatisticsJob(1, 'v1');

      expect(result.jobId).toBe('job-123');
      expect(mockCacheService.get).toHaveBeenCalledWith(
        'coding-statistics:schema-v4:1:v1'
      );
      expect(mockJobQueueService.addCodingStatisticsJob).toHaveBeenCalledWith(
        1,
        'v1'
      );
    });

    it('should return empty jobId when cache exists', async () => {
      mockCacheService.get.mockResolvedValue({
        totalResponses: 100,
        statusCounts: {}
      });

      const result = await service.createCodingStatisticsJob(1, 'v1');

      expect(result.jobId).toBe('');
      expect(result.message).toBe('Using cached coding statistics');
      expect(mockCacheService.get).toHaveBeenCalledWith(
        'coding-statistics:schema-v4:1:v1'
      );
    });

    it('should return an active statistics job for the same workspace and version', async () => {
      mockCacheService.get.mockResolvedValue(null);
      const mockJob: Partial<Job> = { id: 'job-active' };
      mockJobQueueService.getActiveCodingStatisticsJob.mockResolvedValue(
        mockJob as Job
      );

      const result = await service.createCodingStatisticsJob(1, 'v1');

      expect(result).toEqual({
        jobId: 'job-active',
        message: 'Using active coding statistics job'
      });
      expect(mockJobQueueService.assertNoDependencyConflicts)
        .toHaveBeenCalledWith('coding-statistics', 1);
      expect(mockJobQueueService.getActiveCodingStatisticsJob)
        .toHaveBeenCalledWith(1, 'v1');
      expect(
        mockJobQueueService.assertNoDependencyConflicts.mock.invocationCallOrder[0]
      ).toBeLessThan(
        mockJobQueueService.getActiveCodingStatisticsJob.mock.invocationCallOrder[0]
      );
      expect(mockCacheService.delete).not.toHaveBeenCalled();
      expect(mockJobQueueService.addCodingStatisticsJob).not.toHaveBeenCalled();
    });

    it('should not reuse an active statistics job when dependency conflicts exist', async () => {
      mockCacheService.get.mockResolvedValue(null);
      const conflict = new ConflictException('Auto-coding is still active');
      const mockJob: Partial<Job> = { id: 'job-active' };
      mockJobQueueService.assertNoDependencyConflicts.mockRejectedValue(conflict);
      mockJobQueueService.getActiveCodingStatisticsJob.mockResolvedValue(
        mockJob as Job
      );

      await expect(service.createCodingStatisticsJob(1, 'v1'))
        .rejects.toBe(conflict);

      expect(mockJobQueueService.assertNoDependencyConflicts)
        .toHaveBeenCalledWith('coding-statistics', 1);
      expect(mockJobQueueService.getActiveCodingStatisticsJob)
        .not.toHaveBeenCalled();
      expect(mockCacheService.delete).not.toHaveBeenCalled();
      expect(mockJobQueueService.addCodingStatisticsJob).not.toHaveBeenCalled();
    });

    it('should reuse an in-flight statistics job request for the same workspace and version', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.delete.mockResolvedValue(true);
      const mockJob: Partial<Job> = { id: 'job-123' };
      mockJobQueueService.addCodingStatisticsJob.mockResolvedValue(
        mockJob as Job
      );

      const [firstResult, secondResult] = await Promise.all([
        service.createCodingStatisticsJob(1, 'v1'),
        service.createCodingStatisticsJob(1, 'v1')
      ]);

      expect(firstResult).toEqual(secondResult);
      expect(mockCacheService.get).toHaveBeenCalledTimes(1);
      expect(mockJobQueueService.addCodingStatisticsJob).toHaveBeenCalledTimes(1);
    });

    it('should read coding statistics job status only from the statistics queue', async () => {
      const mockAutoCodingJob: Partial<Job> = {
        getState: jest.fn().mockResolvedValue('completed'),
        progress: jest.fn().mockReturnValue(100)
      };
      const mockStatisticsJob: Partial<Job> = {
        getState: jest.fn().mockResolvedValue('completed'),
        progress: jest.fn().mockReturnValue(100)
      };
      const mockStatistics = { totalResponses: 12, statusCounts: { 5: 12 } };

      mockJobQueueService.getTestPersonCodingJob.mockResolvedValue(
        mockAutoCodingJob as Job
      );
      mockJobQueueService.getCodingStatisticsJob.mockResolvedValue(
        mockStatisticsJob as Job
      );
      mockBullJobManagementService.mapJobStateToStatus.mockReturnValue('completed');
      mockBullJobManagementService.extractJobResult.mockReturnValue({
        result: mockStatistics
      });

      const result = await service.getCodingStatisticsJobStatus('job-123');

      expect(mockJobQueueService.getTestPersonCodingJob).not.toHaveBeenCalled();
      expect(mockJobQueueService.getCodingStatisticsJob).toHaveBeenCalledWith('job-123');
      expect(mockBullJobManagementService.extractJobResult)
        .toHaveBeenCalledWith(mockStatisticsJob, 'completed');
      expect(result?.result).toEqual(mockStatistics);
    });

    it('should cancel job successfully', async () => {
      const mockJob: Partial<Job> = {
        getState: jest.fn().mockResolvedValue('waiting')
      };
      mockJobQueueService.getTestPersonCodingJob.mockResolvedValue(
        mockJob as Job
      );
      mockJobQueueService.cancelTestPersonCodingJob.mockResolvedValue(true);

      const result = await service.cancelJob('job-123');

      expect(result.success).toBe(true);
    });

    it('should delete job successfully', async () => {
      const mockJob: Partial<Job> = {};
      mockJobQueueService.getTestPersonCodingJob.mockResolvedValue(
        mockJob as Job
      );
      mockJobQueueService.deleteTestPersonCodingJob.mockResolvedValue(true);

      const result = await service.deleteJob('job-123');

      expect(result.success).toBe(true);
    });
  });

  describe('Cohens Kappa calculation', () => {
    it('should calculate perfect agreement correctly', () => {
      const coderPairs = [
        {
          coder1Id: 1,
          coder1Name: 'Coder1',
          coder2Id: 2,
          coder2Name: 'Coder2',
          codes: [
            { code1: 1, code2: 1 },
            { code1: 2, code2: 2 }
          ]
        }
      ];

      const result = service.calculateCohensKappa(coderPairs);

      expect(result[0].kappa).toBe(1);
      expect(result[0].agreement).toBe(1);
    });

    it('should match the REQ-002 code-level reference dataset', () => {
      const result = service.calculateCohensKappa([
        {
          coder1Id: 1,
          coder1Name: 'Coder1',
          coder2Id: 2,
          coder2Name: 'Coder2',
          codes: [
            { code1: 0, code2: 0 },
            { code1: 0, code2: 6 },
            { code1: 6, code2: 6 },
            { code1: 8, code2: 9 },
            { code1: 9, code2: 9 },
            { code1: 0, code2: 0 },
            { code1: 6, code2: 0 },
            { code1: 8, code2: 8 },
            { code1: null, code2: 0 }
          ]
        }
      ]);

      expect(result[0].validPairs).toBe(8);
      expect(result[0].totalItems).toBe(9);
      expect(result[0].agreement).toBe(0.625);
      expect(result[0].kappa).toBe(0.489);
    });

    it('should match the REQ-002 score-level perfect agreement convention', () => {
      const result = service.calculateCohensKappa(
        [
          {
            coder1Id: 1,
            coder1Name: 'Coder1',
            coder2Id: 2,
            coder2Name: 'Coder2',
            codes: [],
            scores: [
              { score1: 0, score2: 0 },
              { score1: 0, score2: 0 },
              { score1: 0, score2: 0 },
              { score1: 0, score2: 0 },
              { score1: 0, score2: 0 },
              { score1: 0, score2: 0 },
              { score1: 0, score2: 0 },
              { score1: 0, score2: 0 },
              { score1: null, score2: 0 }
            ]
          }
        ],
        'score'
      );

      expect(result[0].validPairs).toBe(8);
      expect(result[0].totalItems).toBe(9);
      expect(result[0].agreement).toBe(1);
      expect(result[0].kappa).toBe(1);
    });

    it('should match the REQ-002 score-level two-category reference dataset', () => {
      const result = service.calculateCohensKappa(
        [
          {
            coder1Id: 1,
            coder1Name: 'Coder1',
            coder2Id: 2,
            coder2Name: 'Coder2',
            codes: [],
            scores: [
              { score1: 1, score2: 1 },
              { score1: 1, score2: 1 },
              { score1: 1, score2: 0 },
              { score1: 0, score2: 0 },
              { score1: 0, score2: 0 },
              { score1: 0, score2: 1 },
              { score1: 1, score2: 1 },
              { score1: 0, score2: 0 }
            ]
          }
        ],
        'score'
      );

      expect(result[0].validPairs).toBe(8);
      expect(result[0].agreement).toBe(0.75);
      expect(result[0].kappa).toBe(0.5);
    });

    it('should handle no valid coding pairs', () => {
      const coderPairs = [
        {
          coder1Id: 1,
          coder1Name: 'Coder1',
          coder2Id: 2,
          coder2Name: 'Coder2',
          codes: [{ code1: null, code2: 1 }]
        }
      ];

      const result = service.calculateCohensKappa(coderPairs);

      expect(result[0].kappa).toBeNull();
      expect(result[0].validPairs).toBe(0);
    });

    it('should interpret kappa values correctly', () => {
      const testCases = [
        {
          codes: [
            { code1: 1, code2: 1 },
            { code1: 1, code2: 2 }
          ],
          expected: 'kappa.slight'
        },
        {
          codes: [
            { code1: 1, code2: 1 },
            { code1: 1, code2: 2 },
            { code1: 2, code2: 2 }
          ],
          expected: 'kappa.fair'
        }
      ];

      testCases.forEach(testCase => {
        const result = service.calculateCohensKappa([
          {
            coder1Id: 1,
            coder1Name: 'C1',
            coder2Id: 2,
            coder2Name: 'C2',
            codes: testCase.codes
          }
        ]);
        expect(result[0].interpretation).toBe(testCase.expected);
      });
    });

    it('should use the updated good and almost perfect kappa boundaries', () => {
      const buildCodes = (
        matchingOnes: number,
        oneVsTwo: number,
        twoVsOne: number,
        matchingTwos: number
      ): Array<{ code1: number; code2: number }> => [
        ...Array.from({ length: matchingOnes }, () => ({ code1: 1, code2: 1 })),
        ...Array.from({ length: oneVsTwo }, () => ({ code1: 1, code2: 2 })),
        ...Array.from({ length: twoVsOne }, () => ({ code1: 2, code2: 1 })),
        ...Array.from({ length: matchingTwos }, () => ({ code1: 2, code2: 2 }))
      ];

      [
        {
          codes: buildCodes(90, 10, 9, 91),
          expectedKappa: 0.81,
          expectedInterpretation: 'kappa.good'
        },
        {
          codes: buildCodes(98, 2, 3, 97),
          expectedKappa: 0.95,
          expectedInterpretation: 'kappa.good'
        },
        {
          codes: buildCodes(99, 1, 1, 99),
          expectedKappa: 0.98,
          expectedInterpretation: 'kappa.almost_perfect'
        }
      ].forEach(testCase => {
        const result = service.calculateCohensKappa([
          {
            coder1Id: 1,
            coder1Name: 'C1',
            coder2Id: 2,
            coder2Name: 'C2',
            codes: testCase.codes
          }
        ]);

        expect(result[0].kappa).toBeCloseTo(testCase.expectedKappa, 10);
        expect(result[0].interpretation).toBe(testCase.expectedInterpretation);
      });
    });

    it('should summarize variable-level kappa and agreement over valid coder pairs', () => {
      const summary = service.calculateKappaVariableSummary([
        {
          kappa: 0.5,
          agreement: 0.8,
          validPairs: 10
        },
        {
          kappa: 0.7,
          agreement: 0.9,
          validPairs: 5
        },
        {
          kappa: null,
          agreement: 0,
          validPairs: 0
        }
      ]);

      expect(summary.meanKappa).toBeCloseTo(0.6, 10);
      expect(summary.meanAgreement).toBeCloseTo(0.85, 10);
      expect(summary.validPairCount).toBe(15);
      expect(summary.coderPairCount).toBe(2);
    });

    it('should define empty variable summaries when no coder pair has valid pairs', () => {
      const summary = service.calculateKappaVariableSummary([
        {
          kappa: null,
          agreement: 0,
          validPairs: 0
        }
      ]);

      expect(summary).toEqual({
        meanKappa: null,
        meanAgreement: null,
        validPairCount: 0,
        coderPairCount: 0
      });
    });
  });

  describe('Application bootstrap', () => {
    it('should preload statistics for all workspaces on bootstrap', async () => {
      mockResponseRepository.query.mockResolvedValue([
        { workspace_id: '1' },
        { workspace_id: '2' }
      ]);
      mockWorkspaceCoreService.getIgnoredUnits.mockResolvedValue([]);
      mockFileUploadRepository.find.mockResolvedValue([]);
      mockResponseRepository.query.mockResolvedValue([]);

      await service.onApplicationBootstrap();

      expect(mockResponseRepository.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT DISTINCT person.workspace_id'),
        expect.any(Array)
      );
    });
  });

  describe('Error handling', () => {
    it('should return empty statistics on query error', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockResponseRepository.query.mockRejectedValue(new Error('DB error'));

      const result = await service.getCodingStatistics(1);

      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
    });

    it('should handle null job result', async () => {
      mockJobQueueService.getTestPersonCodingJob.mockResolvedValue(null);
      mockJobQueueService.getCodingStatisticsJob.mockResolvedValue(null);

      const result = await service.getJobStatus('job-123');

      expect(result).toBeNull();
    });
  });

  describe('Refresh statistics', () => {
    it('should refresh statistics by skipping cache', async () => {
      jest
        .spyOn(
          service as unknown as {
            getUnitVariables: (
              workspaceId: number
            ) => Promise<Record<string, string[]>>;
          },
          'getUnitVariables'
        )
        .mockResolvedValue({ Unit1: ['var1'] });
      mockWorkspaceCoreService.getIgnoredUnits.mockResolvedValue([]);
      mockResponseRepository.query.mockResolvedValue([]);

      await service.refreshStatistics(1, 'v1');

      expect(mockCacheService.get).not.toHaveBeenCalled();
    });
  });
});
