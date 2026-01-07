import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';
import { DuplicateResponseService } from './duplicate-response.service';
import { JournalService } from './journal.service';

describe('DuplicateResponseService', () => {
  let service: DuplicateResponseService;
  let dataSource: jest.Mocked<DataSource>;
  let journalService: jest.Mocked<JournalService>;
  let mockEntityManager: jest.Mocked<EntityManager>;

  beforeEach(async () => {
    mockEntityManager = {
      createQueryBuilder: jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 })
      })
    } as unknown as jest.Mocked<EntityManager>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DuplicateResponseService,
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn(callback => callback(mockEntityManager))
          }
        },
        {
          provide: JournalService,
          useValue: {
            createEntry: jest.fn()
          }
        }
      ]
    }).compile();

    service = module.get<DuplicateResponseService>(DuplicateResponseService);
    dataSource = module.get(DataSource);
    journalService = module.get(JournalService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('resolveDuplicateResponses', () => {
    it('should resolve duplicates successfully', async () => {
      const workspaceId = 1;
      const userId = 'user123';
      const resolutionMap = {
        '1|var1|subform1|login1': 100
      };

      const mockResponses = [
        { id: 100 },
        { id: 101 },
        { id: 102 }
      ];

      const mockQueryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockResponses)
      };

      const mockDeleteBuilder = {
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 2 })
      };

      mockEntityManager.createQueryBuilder = jest
        .fn()
        .mockReturnValueOnce(mockQueryBuilder)
        .mockReturnValueOnce(mockDeleteBuilder);

      const result = await service.resolveDuplicateResponses(
        workspaceId,
        resolutionMap,
        userId
      );

      expect(result).toEqual({
        resolvedCount: 2,
        success: true
      });

      expect(journalService.createEntry).toHaveBeenCalledWith(
        userId,
        workspaceId,
        'delete',
        'response',
        100,
        expect.objectContaining({
          duplicateGroupKey: '1|var1|subform1|login1',
          keptResponseId: 100,
          deletedResponseIds: [101, 102]
        })
      );
    });

    it('should return zero count for empty resolution map', async () => {
      const result = await service.resolveDuplicateResponses(1, {}, 'user123');

      expect(result).toEqual({
        resolvedCount: 0,
        success: true
      });

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('should throw error for invalid workspace ID', async () => {
      await expect(
        service.resolveDuplicateResponses(0, { key: 1 }, 'user')
      ).rejects.toThrow('Invalid workspaceId provided');

      await expect(
        service.resolveDuplicateResponses(-1, { key: 1 }, 'user')
      ).rejects.toThrow('Invalid workspaceId provided');
    });

    it('should throw error for invalid resolution map', async () => {
      await expect(
        service.resolveDuplicateResponses(1, null as unknown as Record<string, number>, 'user')
      ).rejects.toThrow('Invalid resolutionMap provided');

      await expect(
        service.resolveDuplicateResponses(1, 'invalid' as unknown as Record<string, number>, 'user')
      ).rejects.toThrow('Invalid resolutionMap provided');
    });

    it('should skip invalid duplicate keys', async () => {
      const resolutionMap = {
        'invalid-key': 100,
        '1|var1': 101, // Too few parts
        '1|var1|sub|login': 102 // Valid
      };

      const mockQueryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([{ id: 102 }, { id: 103 }])
      };

      const mockDeleteBuilder = {
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 })
      };

      mockEntityManager.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockQueryBuilder)
        .mockReturnValueOnce(mockQueryBuilder)
        .mockReturnValueOnce(mockDeleteBuilder);

      const result = await service.resolveDuplicateResponses(
        1,
        resolutionMap,
        'user'
      );

      // Should only process the valid key
      expect(result.resolvedCount).toBe(1);
    });

    it('should skip when no duplicates found', async () => {
      const resolutionMap = {
        '1|var1|sub|login': 100
      };

      const mockQueryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([{ id: 100 }]) // Only one response
      };

      mockEntityManager.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockQueryBuilder);

      const result = await service.resolveDuplicateResponses(
        1,
        resolutionMap,
        'user'
      );

      expect(result.resolvedCount).toBe(0);
      expect(journalService.createEntry).not.toHaveBeenCalled();
    });

    it('should skip when selected response not in duplicate group', async () => {
      const resolutionMap = {
        '1|var1|sub|login': 999 // Not in the group
      };

      const mockQueryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([{ id: 100 }, { id: 101 }])
      };

      mockEntityManager.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockQueryBuilder);

      const result = await service.resolveDuplicateResponses(
        1,
        resolutionMap,
        'user'
      );

      expect(result.resolvedCount).toBe(0);
    });

    it('should handle multiple duplicate groups', async () => {
      const resolutionMap = {
        '1|var1|sub1|login1': 100,
        '2|var2|sub2|login2': 200
      };

      const mockQueryBuilder1 = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([{ id: 100 }, { id: 101 }])
      };

      const mockDeleteBuilder1 = {
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 })
      };

      const mockQueryBuilder2 = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([{ id: 200 }, { id: 201 }])
      };

      const mockDeleteBuilder2 = {
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 })
      };

      mockEntityManager.createQueryBuilder = jest
        .fn()
        .mockReturnValueOnce(mockQueryBuilder1)
        .mockReturnValueOnce(mockDeleteBuilder1)
        .mockReturnValueOnce(mockQueryBuilder2)
        .mockReturnValueOnce(mockDeleteBuilder2);

      const result = await service.resolveDuplicateResponses(
        1,
        resolutionMap,
        'user'
      );

      expect(result.resolvedCount).toBe(2);
      expect(journalService.createEntry).toHaveBeenCalledTimes(2);
    });
  });
});
