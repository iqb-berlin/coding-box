import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CodingVersionService } from './coding-version.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingStatisticsService } from './coding-statistics.service';

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
    update: jest.fn()
  };

  const mockCodingStatisticsService = {
    invalidateCache: jest.fn().mockResolvedValue(undefined)
  };

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
        }
      ]
    }).compile();

    service = module.get<CodingVersionService>(CodingVersionService);

    // Reset mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('resetCodingVersion', () => {
    it('should reset v1 version successfully', async () => {
      const workspaceId = 1;
      const version = 'v1';
      const mockResponses = [{ id: 1 }, { id: 2 }, { id: 3 }];

      mockQueryBuilder.getCount.mockResolvedValue(3);
      mockQueryBuilder.getMany.mockResolvedValueOnce(mockResponses).mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 3 });

      const result = await service.resetCodingVersion(workspaceId, version);

      expect(result).toEqual({
        affectedResponseCount: 3,
        cascadeResetVersions: [],
        message: 'Successfully reset 3 responses for version v1'
      });
      expect(mockResponseRepository.update).toHaveBeenCalledWith(
        { id: expect.anything() },
        {
          status_v1: null,
          code_v1: null,
          score_v1: null
        }
      );
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(1, 'v1');
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledTimes(1);
    });

    it('should reset v2 version and cascade to v3', async () => {
      const workspaceId = 1;
      const version = 'v2';
      const mockResponses = [{ id: 1 }, { id: 2 }];

      mockQueryBuilder.getCount.mockResolvedValue(2);
      mockQueryBuilder.getMany.mockResolvedValueOnce(mockResponses).mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 2 });

      const result = await service.resetCodingVersion(workspaceId, version);

      expect(result).toEqual({
        affectedResponseCount: 2,
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
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(1, 'v2');
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(1, 'v3');
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledTimes(2);
    });

    it('should reset v3 version without cascade', async () => {
      const workspaceId = 1;
      const version = 'v3';
      const mockResponses = [{ id: 1 }];

      mockQueryBuilder.getCount.mockResolvedValue(1);
      mockQueryBuilder.getMany.mockResolvedValueOnce(mockResponses).mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 1 });

      const result = await service.resetCodingVersion(workspaceId, version);

      expect(result).toEqual({
        affectedResponseCount: 1,
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
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(1, 'v3');
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledTimes(1);
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
        cascadeResetVersions: [],
        message: 'No responses found matching the filters for version v1'
      });
      expect(mockResponseRepository.update).not.toHaveBeenCalled();
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

    it('should throw error on database failure', async () => {
      const workspaceId = 1;
      const version = 'v1';

      mockQueryBuilder.getCount.mockRejectedValue(new Error('Database error'));

      await expect(
        service.resetCodingVersion(workspaceId, version)
      ).rejects.toThrow('Failed to reset coding version: Database error');
    });
  });
});
