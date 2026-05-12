import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CodingVersionService } from './coding-version.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingStatisticsService } from './coding-statistics.service';
import { CodingFreshnessService } from './coding-freshness.service';

describe('CodingVersionService', () => {
  let service: CodingVersionService;
  const mockQueryBuilder = {
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    clone: jest.fn().mockReturnThis(),
    getCount: jest.fn(),
    select: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn()
  };

  const mockResponseRepository = {
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
    update: jest.fn(),
    delete: jest.fn()
  };

  const mockCodingStatisticsService = {
    invalidateCache: jest.fn().mockResolvedValue(undefined)
  };

  const mockCodingFreshnessService = {
    markVersionsPendingAfterReset: jest.fn().mockResolvedValue(undefined)
  };

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CodingVersionService,
        {
          provide: getRepositoryToken(ResponseEntity),
          useValue: mockResponseRepository
        },
        {
          provide: CodingStatisticsService,
          useValue: mockCodingStatisticsService
        },
        {
          provide: CodingFreshnessService,
          useValue: mockCodingFreshnessService
        }
      ]
    }).compile();

    service = module.get<CodingVersionService>(CodingVersionService);

    // Reset mocks before each test
    jest.clearAllMocks();
    mockQueryBuilder.getMany.mockReset();
    mockQueryBuilder.getCount.mockReset();
    mockQueryBuilder.getMany.mockResolvedValue([]);
    mockQueryBuilder.getCount.mockResolvedValue(0);
    mockResponseRepository.update.mockReset();
    mockResponseRepository.delete.mockReset();
    mockResponseRepository.update.mockResolvedValue({ affected: 0 });
    mockResponseRepository.delete.mockResolvedValue({ affected: 0 });
    mockCodingFreshnessService.markVersionsPendingAfterReset.mockClear();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('resetCodingVersion', () => {
    it('should reset v1 version and cascade to v2 and v3', async () => {
      const workspaceId = 1;
      const version = 'v1';
      const mockResponses = [{ id: 1 }, { id: 2 }, { id: 3 }];

      mockQueryBuilder.getCount.mockResolvedValue(3);
      mockQueryBuilder.getMany.mockResolvedValueOnce(mockResponses).mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 3 });

      const result = await service.resetCodingVersion(workspaceId, version);

      expect(result).toEqual({
        affectedResponseCount: 3,
        deletedGeneratedResponseCount: 0,
        cascadeResetVersions: ['v2', 'v3'],
        message: 'Successfully reset 3 responses for version v1 and v2, v3 (cascade)'
      });
      expect(mockResponseRepository.update).toHaveBeenCalledWith(
        { id: expect.anything() },
        {
          status_v1: null,
          code_v1: null,
          score_v1: null,
          status_v2: null,
          code_v2: null,
          score_v2: null,
          status_v3: null,
          code_v3: null,
          score_v3: null
        }
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'response.status IN (:...codedStatuses)',
        { codedStatuses: [1, 2, 3] }
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(response.status_v1 IS NOT NULL OR response.code_v1 IS NOT NULL OR response.score_v1 IS NOT NULL OR response.status_v2 IS NOT NULL OR response.code_v2 IS NOT NULL OR response.score_v2 IS NOT NULL OR response.status_v3 IS NOT NULL OR response.code_v3 IS NOT NULL OR response.score_v3 IS NOT NULL)'
      );
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(1, 'v1');
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(1, 'v2');
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(1, 'v3');
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledTimes(3);
    });

    it('should reset v2 version and cascade to v3', async () => {
      const workspaceId = 1;
      const version = 'v2';
      const mockResponses = [{ id: 1 }, { id: 2 }];

      mockQueryBuilder.getCount.mockResolvedValue(2);
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(mockResponses)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 2 });

      const result = await service.resetCodingVersion(workspaceId, version);

      expect(result).toEqual({
        affectedResponseCount: 2,
        deletedGeneratedResponseCount: 0,
        cascadeResetVersions: ['v3'],
        message: 'Successfully reset 2 responses for version v2 and v3 (cascade)'
      });
      expect(mockResponseRepository.update).toHaveBeenCalledWith(
        { id: expect.anything() },
        {
          status_v2: null,
          code_v2: null,
          score_v2: null,
          status_v3: null,
          code_v3: null,
          score_v3: null
        }
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(response.status_v2 IS NOT NULL OR response.code_v2 IS NOT NULL OR response.score_v2 IS NOT NULL OR response.status_v3 IS NOT NULL OR response.code_v3 IS NOT NULL OR response.score_v3 IS NOT NULL)'
      );
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(1, 'v2');
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(1, 'v3');
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledTimes(2);
    });

    it('should reset v3 version without cascade', async () => {
      const workspaceId = 1;
      const version = 'v3';
      const mockResponses = [{ id: 1 }];

      mockQueryBuilder.getCount.mockResolvedValue(1);
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(mockResponses)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 1 });

      const result = await service.resetCodingVersion(workspaceId, version);

      expect(result).toEqual({
        affectedResponseCount: 1,
        deletedGeneratedResponseCount: 0,
        cascadeResetVersions: [],
        message: 'Successfully reset 1 responses for version v3'
      });
      expect(mockResponseRepository.update).toHaveBeenCalledWith(
        { id: expect.anything() },
        {
          status_v3: null,
          code_v3: null,
          score_v3: null
        }
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(response.status_v3 IS NOT NULL OR response.code_v3 IS NOT NULL OR response.score_v3 IS NOT NULL)'
      );
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(1, 'v3');
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledTimes(1);
    });

    it('should mark affected reset units pending by the versions that had coding data', async () => {
      const workspaceId = 1;
      const version = 'v2';
      const mockResponses = [
        {
          id: 1,
          unitid: 10,
          status_v2: 2,
          code_v2: null,
          score_v2: null,
          status_v3: null,
          code_v3: null,
          score_v3: null
        },
        {
          id: 2,
          unitid: 11,
          status_v2: null,
          code_v2: null,
          score_v2: null,
          status_v3: 1,
          code_v3: null,
          score_v3: null
        }
      ];

      mockQueryBuilder.getCount.mockResolvedValue(2);
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(mockResponses)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 2 });

      await service.resetCodingVersion(workspaceId, version);

      expect(mockCodingFreshnessService.markVersionsPendingAfterReset)
        .toHaveBeenCalledWith(1, {
          v2: [10],
          v3: [11]
        });
    });

    it('should target v1 rows when only code or score values remain', async () => {
      const workspaceId = 1;
      const version = 'v1';
      const mockResponses = [{ id: 1 }, { id: 2 }];

      mockQueryBuilder.getCount.mockResolvedValue(2);
      mockQueryBuilder.getMany.mockResolvedValueOnce(mockResponses).mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 2 });

      await service.resetCodingVersion(workspaceId, version);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(response.status_v1 IS NOT NULL OR response.code_v1 IS NOT NULL OR response.score_v1 IS NOT NULL OR response.status_v2 IS NOT NULL OR response.code_v2 IS NOT NULL OR response.score_v2 IS NOT NULL OR response.status_v3 IS NOT NULL OR response.code_v3 IS NOT NULL OR response.score_v3 IS NOT NULL)'
      );
      expect(mockResponseRepository.update).toHaveBeenCalledWith(
        { id: expect.anything() },
        expect.objectContaining({
          status_v1: null,
          code_v1: null,
          score_v1: null
        })
      );
    });

    it('should apply unit filters when provided', async () => {
      const workspaceId = 1;
      const version = 'v1';
      const unitFilters = ['unit1', 'unit2'];
      const mockResponses = [{ id: 1 }];

      mockQueryBuilder.getCount.mockResolvedValue(1);
      mockQueryBuilder.getMany.mockResolvedValueOnce(mockResponses).mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 1 });

      await service.resetCodingVersion(workspaceId, version, unitFilters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'unit.name IN (:...unitNames)',
        { unitNames: unitFilters }
      );
    });

    it('should apply variable filters when provided', async () => {
      const workspaceId = 1;
      const version = 'v1';
      const variableFilters = ['var1', 'var2'];
      const mockResponses = [{ id: 1 }];

      mockQueryBuilder.getCount.mockResolvedValue(1);
      mockQueryBuilder.getMany.mockResolvedValueOnce(mockResponses).mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 1 });

      await service.resetCodingVersion(
        workspaceId,
        version,
        undefined,
        variableFilters
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'response.variableid IN (:...variableIds)',
        { variableIds: variableFilters }
      );
    });

    it('should return zero count when no responses match filters', async () => {
      const workspaceId = 1;
      const version = 'v1';

      mockQueryBuilder.getCount.mockResolvedValue(0);

      const result = await service.resetCodingVersion(workspaceId, version);

      expect(result).toEqual({
        affectedResponseCount: 0,
        deletedGeneratedResponseCount: 0,
        cascadeResetVersions: ['v2', 'v3'],
        message: 'No responses found matching the filters for version v1'
      });
      expect(mockResponseRepository.update).not.toHaveBeenCalled();
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(1, 'v1');
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(1, 'v2');
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(1, 'v3');
      expect(mockCodingFreshnessService.markVersionsPendingAfterReset).not.toHaveBeenCalled();
    });

    it('should handle large batches correctly', async () => {
      const workspaceId = 1;
      const version = 'v1';
      const batch1 = Array.from({ length: 5000 }, (_, i) => ({ id: i + 1 }));
      const batch2 = Array.from({ length: 3000 }, (_, i) => ({ id: i + 5001 }));

      mockQueryBuilder.getCount.mockResolvedValue(8000);
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(batch1)
        .mockResolvedValueOnce(batch2)
        .mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 1 });

      const result = await service.resetCodingVersion(workspaceId, version);

      expect(result.affectedResponseCount).toBe(8000);
      expect(mockResponseRepository.update).toHaveBeenCalledTimes(2);
      // Verify that skip is always called with 0
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
    });

    it('should call progressCallback with expected progress values', async () => {
      const workspaceId = 1;
      const version = 'v1';
      const mockResponses = [{ id: 1 }, { id: 2 }];
      const progressCallback = jest.fn().mockResolvedValue(undefined);

      mockQueryBuilder.getCount.mockResolvedValue(2);
      mockQueryBuilder.getMany.mockResolvedValueOnce(mockResponses).mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 2 });

      await service.resetCodingVersion(workspaceId, version, undefined, undefined, progressCallback);

      expect(progressCallback).toHaveBeenCalledWith(0);
      expect(progressCallback).toHaveBeenCalledWith(5);
      expect(progressCallback).toHaveBeenCalledWith(10);
      expect(progressCallback).toHaveBeenCalledWith(100);
      expect(progressCallback.mock.calls.length).toBeGreaterThanOrEqual(4);
    });

    it('should call progressCallback with 100 when no responses match', async () => {
      const workspaceId = 1;
      const version = 'v1';
      const progressCallback = jest.fn().mockResolvedValue(undefined);

      mockQueryBuilder.getCount.mockResolvedValue(0);

      await service.resetCodingVersion(workspaceId, version, undefined, undefined, progressCallback);

      expect(progressCallback).toHaveBeenCalledWith(0);
      expect(progressCallback).toHaveBeenCalledWith(100);
    });

    it('should delete empty autocoder-generated responses after resetting v1', async () => {
      const workspaceId = 1;
      const version = 'v1';
      const resetResponses = [{ id: 1 }, { id: 2 }];
      const generatedResponses = [{ id: 100 }, { id: 101 }];

      mockQueryBuilder.getCount.mockResolvedValue(2);
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(resetResponses)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(generatedResponses)
        .mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 2 });
      mockResponseRepository.delete.mockResolvedValue({ affected: 2 });

      const result = await service.resetCodingVersion(workspaceId, version);

      expect(result).toEqual({
        affectedResponseCount: 2,
        deletedGeneratedResponseCount: 2,
        cascadeResetVersions: ['v2', 'v3'],
        message: 'Successfully reset 2 responses for version v1 and v2, v3 (cascade) and removed 2 generated response rows'
      });
      expect(mockResponseRepository.delete).toHaveBeenCalledWith({
        id: expect.anything()
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'response.is_autocoder_generated = :generated',
        { generated: true }
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'response.status_v1 IS NULL AND response.code_v1 IS NULL AND response.score_v1 IS NULL AND response.status_v2 IS NULL AND response.code_v2 IS NULL AND response.score_v2 IS NULL AND response.status_v3 IS NULL AND response.code_v3 IS NULL AND response.score_v3 IS NULL'
      );
    });

    it('should cleanup already-empty generated responses even when no reset targets match', async () => {
      const workspaceId = 1;
      const version = 'v1';
      const generatedResponses = [{ id: 200 }];

      mockQueryBuilder.getCount.mockResolvedValue(0);
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(generatedResponses)
        .mockResolvedValueOnce([]);
      mockResponseRepository.delete.mockResolvedValue({ affected: 1 });

      const result = await service.resetCodingVersion(workspaceId, version);

      expect(result).toEqual({
        affectedResponseCount: 0,
        deletedGeneratedResponseCount: 1,
        cascadeResetVersions: ['v2', 'v3'],
        message: 'No responses found matching the filters for version v1; removed 1 generated response rows'
      });
      expect(mockResponseRepository.update).not.toHaveBeenCalled();
      expect(mockResponseRepository.delete).toHaveBeenCalledWith({
        id: expect.anything()
      });
    });

    it('should apply unit and variable filters when deleting empty generated responses', async () => {
      const workspaceId = 1;
      const version = 'v1';
      const unitFilters = ['UNIT_A'];
      const variableFilters = ['derived_var'];

      mockQueryBuilder.getCount.mockResolvedValue(0);
      mockQueryBuilder.getMany.mockResolvedValueOnce([]);

      await service.resetCodingVersion(
        workspaceId,
        version,
        unitFilters,
        variableFilters
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'unit.name IN (:...unitNames)',
        { unitNames: unitFilters }
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'response.variableid IN (:...variableIds)',
        { variableIds: variableFilters }
      );
    });

    it('should throw error on database failure', async () => {
      const workspaceId = 1;
      const version = 'v1';

      mockQueryBuilder.getCount.mockRejectedValue(new Error('Database error'));

      await expect(
        service.resetCodingVersion(workspaceId, version)
      ).rejects.toThrow('Failed to reset coding version: Database error');
    });

    it('should always exclude aggregated duplicates (code -111)', async () => {
      const workspaceId = 1;
      const version = 'v2';
      mockQueryBuilder.getCount.mockResolvedValue(0);

      await service.resetCodingVersion(workspaceId, version);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(response.code_v2 IS NULL OR response.code_v2 != -111)'
      );
    });

    it('should only include responses with coded statuses (1, 2, 3)', async () => {
      const workspaceId = 1;
      const version = 'v1';
      mockQueryBuilder.getCount.mockResolvedValue(0);

      await service.resetCodingVersion(workspaceId, version);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'response.status IN (:...codedStatuses)',
        { codedStatuses: [1, 2, 3] }
      );
    });
  });
});
