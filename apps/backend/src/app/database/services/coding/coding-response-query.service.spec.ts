import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CodingResponseQueryService } from './coding-response-query.service';
import { ResponseEntity } from '../../entities/response.entity';
import * as statusConverter from '../../utils/response-status-converter';
import { getEffectiveCodingStatusExpression } from '../../utils/effective-coding-status-expression.util';
import { Unit } from '../../entities/unit.entity';
import { Booklet } from '../../entities/booklet.entity';
import Persons from '../../entities/persons.entity';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';

jest.mock('../../utils/response-status-converter', () => ({
  ...jest.requireActual('../../utils/response-status-converter'),
  statusStringToNumber: jest.fn()
}));

describe('CodingResponseQueryService', () => {
  let service: CodingResponseQueryService;
  const mockQueryBuilder = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getCount: jest.fn(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn()
  };

  const mockResponseRepository = {
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
    find: jest.fn()
  };
  const mockUnitRepository = { find: jest.fn() };
  const mockBookletRepository = { find: jest.fn() };
  const mockPersonsRepository = { find: jest.fn() };
  const mockWorkspaceFilesService = {
    getUnitVariableMap: jest.fn()
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
        CodingResponseQueryService,
        {
          provide: getRepositoryToken(ResponseEntity),
          useValue: mockResponseRepository
        },
        {
          provide: getRepositoryToken(Unit),
          useValue: mockUnitRepository
        },
        {
          provide: getRepositoryToken(Booklet),
          useValue: mockBookletRepository
        },
        {
          provide: getRepositoryToken(Persons),
          useValue: mockPersonsRepository
        },
        {
          provide: WorkspaceExclusionService,
          useValue: {
            resolveExclusionsForQueries: jest.fn().mockResolvedValue({
              globalIgnoredUnits: [],
              ignoredBooklets: [],
              testletIgnoredUnits: []
            })
          }
        },
        {
          provide: WorkspaceFilesService,
          useValue: mockWorkspaceFilesService
        }
      ]
    }).compile();

    service = module.get<CodingResponseQueryService>(CodingResponseQueryService);
    jest.clearAllMocks();
    mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(new Map([
      ['Unit1', new Set(['var1', 'var2'])]
    ]));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getResponsesByStatus', () => {
    it('should retrieve responses by status for v1', async () => {
      const mockResponses = [
        { id: 1, variableid: 'var1', status_v1: 5 },
        { id: 2, variableid: 'var2', status_v1: 5 }
      ];

      (statusConverter.statusStringToNumber as jest.Mock).mockReturnValue(5);
      mockQueryBuilder.getCount.mockResolvedValue(2);
      mockQueryBuilder.getMany.mockResolvedValue(mockResponses);

      const result = await service.getResponsesByStatus(1, 'CODING_COMPLETE', 'v1', 1, 100);

      expect(result).toEqual({
        data: mockResponses,
        total: 2,
        page: 1,
        limit: 100
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'response.status_v1 = :status',
        { status: 5 }
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'CONCAT(unit.name, CHR(31), response.variableid) IN (:...validVariablePairKeys)',
        { validVariablePairKeys: ['Unit1\u001Fvar1', 'Unit1\u001Fvar2'] }
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'response.status IN (:...codingResponseStatuses)',
        { codingResponseStatuses: [1, 2, 3] }
      );
    });

    it('should retrieve responses by status for v2', async () => {
      const mockResponses = [{ id: 1, variableid: 'var1', status_v2: 8 }];

      (statusConverter.statusStringToNumber as jest.Mock).mockReturnValue(8);
      mockQueryBuilder.getCount.mockResolvedValue(1);
      mockQueryBuilder.getMany.mockResolvedValue(mockResponses);

      const result = await service.getResponsesByStatus(1, 'CODING_INCOMPLETE', 'v2', 1, 100);

      expect(result).toEqual({
        data: mockResponses,
        total: 1,
        page: 1,
        limit: 100
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'COALESCE(response.status_v2, response.status_v1) = :status',
        { status: 8 }
      );
    });

    it('should retrieve responses by status for v3', async () => {
      const mockResponses = [{ id: 1, variableid: 'var1', status_v3: 9 }];

      (statusConverter.statusStringToNumber as jest.Mock).mockReturnValue(9);
      mockQueryBuilder.getCount.mockResolvedValue(1);
      mockQueryBuilder.getMany.mockResolvedValue(mockResponses);

      const result = await service.getResponsesByStatus(1, 'CODING_ERROR', 'v3', 1, 100);

      expect(result).toEqual({
        data: mockResponses,
        total: 1,
        page: 1,
        limit: 100
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        `${getEffectiveCodingStatusExpression('v3')} = :status`,
        { status: 9 }
      );
    });

    it('should handle pagination correctly', async () => {
      const mockResponses = [{ id: 11 }, { id: 12 }];

      (statusConverter.statusStringToNumber as jest.Mock).mockReturnValue(5);
      mockQueryBuilder.getCount.mockResolvedValue(25);
      mockQueryBuilder.getMany.mockResolvedValue(mockResponses);

      const result = await service.getResponsesByStatus(1, 'CODING_COMPLETE', 'v1', 2, 10);

      expect(result).toEqual({
        data: mockResponses,
        total: 25,
        page: 2,
        limit: 10
      });
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(10); // (page - 1) * limit
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
    });

    it('should return empty result for invalid status', async () => {
      (statusConverter.statusStringToNumber as jest.Mock).mockReturnValue(null);

      const result = await service.getResponsesByStatus(1, 'INVALID_STATUS', 'v1', 1, 100);

      expect(result).toEqual({
        data: [],
        total: 0,
        page: 1,
        limit: 100
      });
      expect(mockQueryBuilder.getCount).not.toHaveBeenCalled();
      expect(mockQueryBuilder.getMany).not.toHaveBeenCalled();
    });

    it('should return empty result for ignored raw statistics status', async () => {
      (statusConverter.statusStringToNumber as jest.Mock).mockReturnValue(1);

      const result = await service.getResponsesByStatus(1, 'NOT_REACHED', 'v1', 1, 100);

      expect(result).toEqual({
        data: [],
        total: 0,
        page: 1,
        limit: 100
      });
      expect(mockQueryBuilder.getCount).not.toHaveBeenCalled();
      expect(mockQueryBuilder.getMany).not.toHaveBeenCalled();
    });

    it('should return empty result when no valid coding variables exist', async () => {
      (statusConverter.statusStringToNumber as jest.Mock).mockReturnValue(5);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(new Map());

      const result = await service.getResponsesByStatus(1, 'CODING_COMPLETE', 'v1', 1, 100);

      expect(result).toEqual({
        data: [],
        total: 0,
        page: 1,
        limit: 100
      });
      expect(mockQueryBuilder.getCount).not.toHaveBeenCalled();
      expect(mockQueryBuilder.getMany).not.toHaveBeenCalled();
    });

    it('should default to v1 when no version specified', async () => {
      const mockResponses = [{ id: 1 }];

      (statusConverter.statusStringToNumber as jest.Mock).mockReturnValue(5);
      mockQueryBuilder.getCount.mockResolvedValue(1);
      mockQueryBuilder.getMany.mockResolvedValue(mockResponses);

      await service.getResponsesByStatus(1, 'CODING_COMPLETE');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'response.status_v1 = :status',
        { status: 5 }
      );
    });

    it('should throw error on database failure', async () => {
      (statusConverter.statusStringToNumber as jest.Mock).mockReturnValue(5);
      mockQueryBuilder.getCount.mockRejectedValue(new Error('Database error'));

      await expect(
        service.getResponsesByStatus(1, 'CODING_COMPLETE', 'v1', 1, 100)
      ).rejects.toThrow('Could not retrieve responses. Please check the database connection or query.');
    });
  });
});
