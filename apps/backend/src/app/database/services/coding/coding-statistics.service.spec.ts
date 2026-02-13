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

describe('CodingStatisticsService', () => {
  let service: CodingStatisticsService;
  let mockResponseRepository: jest.Mocked<Repository<ResponseEntity>>;
  let mockCacheService: jest.Mocked<CacheService>;
  let mockJobQueueService: jest.Mocked<JobQueueService>;
  let mockBullJobManagementService: jest.Mocked<BullJobManagementService>;
  let mockWorkspaceCoreService: jest.Mocked<WorkspaceCoreService>;

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
      delete: jest.fn()
    } as unknown as jest.Mocked<CacheService>;

    mockJobQueueService = {
      getTestPersonCodingJob: jest.fn(),
      getCodingStatisticsJob: jest.fn(),
      addCodingStatisticsJob: jest.fn(),
      cancelTestPersonCodingJob: jest.fn(),
      deleteTestPersonCodingJob: jest.fn()
    } as unknown as jest.Mocked<JobQueueService>;

    mockBullJobManagementService = {
      mapJobStateToStatus: jest.fn(),
      extractJobResult: jest.fn()
    } as unknown as jest.Mocked<BullJobManagementService>;

    mockWorkspaceCoreService = {
      getIgnoredUnits: jest.fn()
    } as unknown as jest.Mocked<WorkspaceCoreService>;

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
        { provide: WorkspaceCoreService, useValue: mockWorkspaceCoreService }
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
        { statusValue: 1, count: '10' },
        { statusValue: 2, count: '20' }
      ]);

      const result = await service.getCodingStatistics(1, 'v1');

      expect(result.totalResponses).toBe(30);
      expect(result.statusCounts).toEqual({ 1: 10, 2: 20 });
      expect(mockCacheService.set).toHaveBeenCalled();
    });

    it('should calculate statistics for v2 version', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockWorkspaceCoreService.getIgnoredUnits.mockResolvedValue([]);
      mockResponseRepository.query.mockResolvedValue([
        { statusValue: 1, count: '15' },
        { statusValue: 2, count: '25' }
      ]);

      const result = await service.getCodingStatistics(1, 'v2');

      expect(result.totalResponses).toBe(40);
      expect(mockCacheService.set).toHaveBeenCalled();
    });

    it('should calculate statistics for v3 version', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockWorkspaceCoreService.getIgnoredUnits.mockResolvedValue([]);
      mockResponseRepository.query.mockResolvedValue([
        { statusValue: 1, count: '5' }
      ]);

      const result = await service.getCodingStatistics(1, 'v3');

      expect(result.totalResponses).toBe(5);
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
        { statusValue: 1, count: '100' },
        { statusValue: 2, count: '50' },
        { statusValue: 3, count: '25' }
      ]);

      const result = await service.getCodingStatistics(1);

      expect(result.totalResponses).toBe(175);
      expect(Object.keys(result.statusCounts).length).toBe(3);
    });

    it('should handle NaN counts gracefully', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockWorkspaceCoreService.getIgnoredUnits.mockResolvedValue([]);
      mockResponseRepository.query.mockResolvedValue([
        { statusValue: 1, count: 'invalid' }
      ]);

      const result = await service.getCodingStatistics(1);

      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts[1]).toBe(0);
    });
  });

  describe('Cache invalidation', () => {
    it('should invalidate cache for specific version', async () => {
      mockCacheService.delete.mockResolvedValue(true);

      await service.invalidateCache(1, 'v1');

      expect(mockCacheService.delete).toHaveBeenCalledWith(
        'coding-statistics:1:v1'
      );
    });

    it('should invalidate all versions when no version specified', async () => {
      mockCacheService.delete.mockResolvedValue(true);

      await service.invalidateCache(1);

      expect(mockCacheService.delete).toHaveBeenCalledWith(
        'coding-statistics:1:v1'
      );
      expect(mockCacheService.delete).toHaveBeenCalledWith(
        'coding-statistics:1:v2'
      );
      expect(mockCacheService.delete).toHaveBeenCalledWith(
        'coding-statistics:1:v3'
      );
    });

    it('should invalidate incomplete variables cache', async () => {
      mockCacheService.delete.mockResolvedValue(true);

      await service.invalidateIncompleteVariablesCache(1);

      expect(mockCacheService.delete).toHaveBeenCalledWith(
        'coding_incomplete_variables_v2:1'
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

    it('should use COALESCE for v2 version query', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockWorkspaceCoreService.getIgnoredUnits.mockResolvedValue([]);
      mockResponseRepository.query.mockResolvedValue([]);

      await service.getCodingStatistics(1, 'v2');

      const queryCall = mockResponseRepository.query.mock.calls[0];
      expect(queryCall[0]).toContain(
        'COALESCE(response.status_v2, response.status_v1)'
      );
      expect(queryCall[0]).toContain('code_v2');
    });

    it('should use COALESCE chain for v3 version query', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockWorkspaceCoreService.getIgnoredUnits.mockResolvedValue([]);
      mockResponseRepository.query.mockResolvedValue([]);

      await service.getCodingStatistics(1, 'v3');

      const queryCall = mockResponseRepository.query.mock.calls[0];
      expect(queryCall[0]).toContain(
        'COALESCE(response.status_v3, response.status_v2, response.status_v1)'
      );
      expect(queryCall[0]).toContain('code_v2');
    });
  });

  describe('Cache operations', () => {
    it('should return cached statistics when available', async () => {
      const cachedStats = { totalResponses: 100, statusCounts: { 1: 100 } };
      mockCacheService.get.mockResolvedValue(cachedStats);

      const result = await service.getCodingStatistics(1);

      expect(result).toEqual(cachedStats);
      expect(mockResponseRepository.query).not.toHaveBeenCalled();
    });
  });

  describe('Unit variable parsing', () => {
    it('should filter out ignored units', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockWorkspaceCoreService.getIgnoredUnits.mockResolvedValue(['UNIT1']);
      mockResponseRepository.query.mockResolvedValueOnce([
        { workspace_id: '1' }
      ]);
      mockFileUploadRepository.find.mockResolvedValue([
        {
          file_id: 'unit1.xml',
          data: Buffer.from(`<?xml version="1.0"?>
            <Unit>
              <Metadata><Id>Unit1</Id></Metadata>
              <BaseVariables>
                <Variable alias="var1" type="string"/>
              </BaseVariables>
            </Unit>`)
        }
      ]);

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
