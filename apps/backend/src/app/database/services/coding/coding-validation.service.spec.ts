import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { ExpectedCombinationDto } from '@coding-box-lib/api-dto/coding/expected-combination.dto';
import { CodingValidationService } from './coding-validation.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CacheService } from '../../../cache/cache.service';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';

describe('CodingValidationService', () => {
  let service: CodingValidationService;
  let mockResponseRepository: jest.Mocked<Repository<ResponseEntity>>;
  let mockCodingJobUnitRepository: jest.Mocked<Repository<CodingJobUnit>>;
  let mockCacheService: jest.Mocked<CacheService>;
  let mockWorkspaceFilesService: jest.Mocked<WorkspaceFilesService>;

  const mockQueryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getCount: jest.fn(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn()
  } as unknown as jest.Mocked<SelectQueryBuilder<ResponseEntity>>;

  const createMockExpectedCombination = (
    overrides: Partial<ExpectedCombinationDto> = {}
  ): ExpectedCombinationDto => ({
    unit_key: 'unit1',
    login_name: 'user1',
    login_code: 'code1',
    booklet_id: 'booklet1',
    variable_id: 'var1',
    ...overrides
  });

  beforeEach(async () => {
    mockResponseRepository = {
      createQueryBuilder: jest.fn(() => mockQueryBuilder),
      query: jest.fn()
    } as unknown as jest.Mocked<Repository<ResponseEntity>>;

    mockCodingJobUnitRepository = {
      createQueryBuilder: jest.fn(() => mockQueryBuilder)
    } as unknown as jest.Mocked<Repository<CodingJobUnit>>;

    mockCacheService = {
      generateValidationCacheKey: jest.fn(),
      getPaginatedValidationResults: jest.fn(),
      storeValidationResults: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn()
    } as unknown as jest.Mocked<CacheService>;

    mockWorkspaceFilesService = {
      getUnitVariableMap: jest.fn()
    } as unknown as jest.Mocked<WorkspaceFilesService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CodingValidationService,
        {
          provide: getRepositoryToken(ResponseEntity),
          useValue: mockResponseRepository
        },
        {
          provide: getRepositoryToken(CodingJobUnit),
          useValue: mockCodingJobUnitRepository
        },
        {
          provide: CacheService,
          useValue: mockCacheService
        },
        {
          provide: WorkspaceFilesService,
          useValue: mockWorkspaceFilesService
        }
      ]
    }).compile();

    service = module.get<CodingValidationService>(CodingValidationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateCodingCompleteness - Completeness validation', () => {
    it('should return cached results when available', async () => {
      const expectedCombinations = [createMockExpectedCombination()];
      const cachedResults = {
        results: [
          { combination: expectedCombinations[0], status: 'EXISTS' as const }
        ],
        metadata: {
          total: 1,
          missing: 0,
          timestamp: Date.now(),
          currentPage: 1,
          pageSize: 50,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false
        }
      };

      mockCacheService.generateValidationCacheKey.mockReturnValue('cache-key');
      mockCacheService.getPaginatedValidationResults.mockResolvedValue(
        cachedResults
      );

      const result = await service.validateCodingCompleteness(
        1,
        expectedCombinations
      );

      expect(result.results).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.missing).toBe(0);
      expect(
        mockCacheService.getPaginatedValidationResults
      ).toHaveBeenCalledWith('cache-key', 1, 50);
    });

    it('should process combinations and return EXISTS status when response found', async () => {
      const expectedCombinations = [createMockExpectedCombination()];

      mockCacheService.generateValidationCacheKey.mockReturnValue('cache-key');
      mockCacheService.getPaginatedValidationResults.mockResolvedValue(null);
      mockQueryBuilder.getCount.mockResolvedValue(1);
      mockCacheService.storeValidationResults.mockResolvedValue(true);
      mockCacheService.getPaginatedValidationResults
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          results: [
            { combination: expectedCombinations[0], status: 'EXISTS' as const }
          ],
          metadata: {
            total: 1,
            missing: 0,
            timestamp: Date.now(),
            currentPage: 1,
            pageSize: 50,
            totalPages: 1,
            hasNextPage: false,
            hasPreviousPage: false
          }
        });

      const result = await service.validateCodingCompleteness(
        1,
        expectedCombinations
      );

      expect(result.results[0].status).toBe('EXISTS');
      expect(mockQueryBuilder.getCount).toHaveBeenCalled();
    });

    it('should return MISSING status when response not found', async () => {
      const expectedCombinations = [createMockExpectedCombination()];

      mockCacheService.generateValidationCacheKey.mockReturnValue('cache-key');
      mockCacheService.getPaginatedValidationResults.mockResolvedValue(null);
      mockQueryBuilder.getCount.mockResolvedValue(0);
      mockCacheService.storeValidationResults.mockResolvedValue(true);

      const result = await service.validateCodingCompleteness(
        1,
        expectedCombinations
      );

      expect(result.results[0].status).toBe('MISSING');
      expect(result.missing).toBe(1);
    });

    it('should handle errors gracefully', async () => {
      const expectedCombinations = [createMockExpectedCombination()];

      mockCacheService.generateValidationCacheKey.mockReturnValue('cache-key');
      mockCacheService.getPaginatedValidationResults.mockRejectedValue(
        new Error('Cache error')
      );

      await expect(
        service.validateCodingCompleteness(1, expectedCombinations)
      ).rejects.toThrow('Could not validate coding completeness');
    });
  });

  describe('validateCodingCompleteness - Expected combination checking', () => {
    it('should process multiple combinations in batches', async () => {
      const expectedCombinations = Array.from({ length: 150 }, (_, i) => createMockExpectedCombination({
        unit_key: `unit${i}`,
        variable_id: `var${i}`
      })
      );

      mockCacheService.generateValidationCacheKey.mockReturnValue('cache-key');
      mockCacheService.getPaginatedValidationResults.mockResolvedValue(null);
      mockQueryBuilder.getCount.mockResolvedValue(1);
      mockCacheService.storeValidationResults.mockResolvedValue(true);

      await service.validateCodingCompleteness(1, expectedCombinations);

      expect(mockQueryBuilder.getCount).toHaveBeenCalledTimes(150);
    });

    it('should build correct query with all combination fields', async () => {
      const expectedCombinations = [
        createMockExpectedCombination({
          unit_key: 'test-unit',
          login_name: 'test-user',
          login_code: 'test-code',
          booklet_id: 'test-booklet',
          variable_id: 'test-variable'
        })
      ];

      mockCacheService.generateValidationCacheKey.mockReturnValue('cache-key');
      mockCacheService.getPaginatedValidationResults.mockResolvedValue(null);
      mockQueryBuilder.getCount.mockResolvedValue(1);
      mockCacheService.storeValidationResults.mockResolvedValue(true);

      await service.validateCodingCompleteness(1, expectedCombinations);

      expect(mockResponseRepository.createQueryBuilder).toHaveBeenCalledWith(
        'response'
      );
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'response.unit',
        'unit'
      );
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'unit.booklet',
        'booklet'
      );
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'booklet.person',
        'person'
      );
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'booklet.bookletinfo',
        'bookletinfo'
      );
    });
  });

  describe('validateCodingCompleteness - Pagination', () => {
    it('should use default pagination when not specified', async () => {
      const expectedCombinations = Array.from({ length: 100 }, (_, i) => createMockExpectedCombination({ variable_id: `var${i}` })
      );

      mockCacheService.generateValidationCacheKey.mockReturnValue('cache-key');
      mockCacheService.getPaginatedValidationResults.mockResolvedValue(null);
      mockQueryBuilder.getCount.mockResolvedValue(1);
      mockCacheService.storeValidationResults.mockResolvedValue(true);

      const result = await service.validateCodingCompleteness(
        1,
        expectedCombinations
      );

      expect(result.pageSize).toBe(50);
      expect(result.currentPage).toBe(1);
      expect(result.totalPages).toBe(2);
    });

    it('should use custom page and pageSize when specified', async () => {
      const expectedCombinations = Array.from({ length: 100 }, (_, i) => createMockExpectedCombination({ variable_id: `var${i}` })
      );

      mockCacheService.generateValidationCacheKey.mockReturnValue('cache-key');
      mockCacheService.getPaginatedValidationResults.mockResolvedValue(null);
      mockQueryBuilder.getCount.mockResolvedValue(1);
      mockCacheService.storeValidationResults.mockResolvedValue(true);

      const result = await service.validateCodingCompleteness(
        1,
        expectedCombinations,
        2,
        25
      );

      expect(result.pageSize).toBe(25);
      expect(result.currentPage).toBe(2);
      expect(result.totalPages).toBe(4);
    });

    it('should set hasNextPage and hasPreviousPage correctly', async () => {
      const expectedCombinations = Array.from({ length: 100 }, (_, i) => createMockExpectedCombination({ variable_id: `var${i}` })
      );

      mockCacheService.generateValidationCacheKey.mockReturnValue('cache-key');
      mockCacheService.getPaginatedValidationResults.mockResolvedValue(null);
      mockQueryBuilder.getCount.mockResolvedValue(1);
      mockCacheService.storeValidationResults.mockResolvedValue(true);

      const firstPage = await service.validateCodingCompleteness(
        1,
        expectedCombinations,
        1,
        50
      );
      expect(firstPage.hasNextPage).toBe(true);
      expect(firstPage.hasPreviousPage).toBe(false);

      mockCacheService.storeValidationResults.mockClear();
      const lastPage = await service.validateCodingCompleteness(
        1,
        expectedCombinations,
        2,
        50
      );
      expect(lastPage.hasNextPage).toBe(false);
      expect(lastPage.hasPreviousPage).toBe(true);
    });
  });

  describe('validateCodingCompleteness - Cache management', () => {
    it('should store results in cache after processing', async () => {
      const expectedCombinations = [createMockExpectedCombination()];

      mockCacheService.generateValidationCacheKey.mockReturnValue('cache-key');
      mockCacheService.getPaginatedValidationResults.mockResolvedValue(null);
      mockQueryBuilder.getCount.mockResolvedValue(1);
      mockCacheService.storeValidationResults.mockResolvedValue(true);

      await service.validateCodingCompleteness(1, expectedCombinations);

      expect(mockCacheService.storeValidationResults).toHaveBeenCalledWith(
        'cache-key',
        expect.any(Array),
        expect.objectContaining({
          total: 1,
          missing: 0,
          timestamp: expect.any(Number)
        })
      );
    });

    it('should continue without error if cache storage fails', async () => {
      const expectedCombinations = [createMockExpectedCombination()];

      mockCacheService.generateValidationCacheKey.mockReturnValue('cache-key');
      mockCacheService.getPaginatedValidationResults.mockResolvedValue(null);
      mockQueryBuilder.getCount.mockResolvedValue(1);
      mockCacheService.storeValidationResults.mockResolvedValue(false);

      const result = await service.validateCodingCompleteness(
        1,
        expectedCombinations
      );

      expect(result.results).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('getCodingIncompleteVariables - Incomplete variable detection', () => {
    it('should return cached variables when available', async () => {
      const cachedVariables = [
        {
          unitName: 'unit1',
          variableId: 'var1',
          responseCount: 5,
          casesInJobs: 2,
          availableCases: 3
        }
      ];

      mockCacheService.get.mockResolvedValue(cachedVariables);

      const result = await service.getCodingIncompleteVariables(1);

      expect(result).toEqual(cachedVariables);
      expect(mockCacheService.get).toHaveBeenCalledWith(
        'coding_incomplete_variables_v2:1'
      );
    });

    it('should fetch from database on cache miss', async () => {
      const rawResults = [
        { unitName: 'unit1', variableId: 'var1', responseCount: '5' }
      ];

      mockCacheService.get.mockResolvedValue(null);
      mockQueryBuilder.getRawMany.mockResolvedValue(rawResults);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['var1'])]])
      );
      mockCacheService.set.mockResolvedValue(true);

      const result = await service.getCodingIncompleteVariables(1);

      expect(result).toHaveLength(1);
      expect(result[0].unitName).toBe('unit1');
      expect(result[0].variableId).toBe('var1');
      expect(result[0].responseCount).toBe(5);
    });

    it('should filter variables by unit name when specified', async () => {
      const rawResults = [
        { unitName: 'specific-unit', variableId: 'var1', responseCount: '5' }
      ];

      mockQueryBuilder.getRawMany.mockResolvedValue(rawResults);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['SPECIFIC-UNIT', new Set(['var1'])]])
      );

      const result = await service.getCodingIncompleteVariables(
        1,
        'specific-unit'
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'unit.name = :unitName',
        { unitName: 'specific-unit' }
      );
      expect(result[0].unitName).toBe('specific-unit');
    });

    it('should filter out invalid variables not in unit variable map', async () => {
      const rawResults = [
        { unitName: 'unit1', variableId: 'valid-var', responseCount: '5' },
        { unitName: 'unit1', variableId: 'invalid-var', responseCount: '3' }
      ];

      mockCacheService.get.mockResolvedValue(null);
      mockQueryBuilder.getRawMany.mockResolvedValue(rawResults);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['valid-var'])]])
      );
      mockCacheService.set.mockResolvedValue(true);

      const result = await service.getCodingIncompleteVariables(1);

      expect(result).toHaveLength(1);
      expect(result[0].variableId).toBe('valid-var');
    });

    it('should handle database errors', async () => {
      mockCacheService.get.mockRejectedValue(new Error('Database error'));

      await expect(service.getCodingIncompleteVariables(1)).rejects.toThrow(
        'Could not get CODING_INCOMPLETE variables'
      );
    });
  });

  describe('getVariableCasesInJobs', () => {
    it('should return map of cases in jobs for each variable', async () => {
      const rawResults = [
        { unitName: 'unit1', variableId: 'var1', casesInJobs: '5' },
        { unitName: 'unit2', variableId: 'var2', casesInJobs: '3' }
      ];

      mockQueryBuilder.getRawMany.mockResolvedValue(rawResults);

      const result = await service.getVariableCasesInJobs(1);

      expect(result.get('unit1::var1')).toBe(5);
      expect(result.get('unit2::var2')).toBe(3);
    });

    it('should return empty map when no cases found', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      const result = await service.getVariableCasesInJobs(1);

      expect(result.size).toBe(0);
    });
  });

  describe('generateIncompleteVariablesCacheKey', () => {
    it('should generate correct cache key', () => {
      const cacheKey = service.generateIncompleteVariablesCacheKey(123);

      expect(cacheKey).toBe('coding_incomplete_variables_v2:123');
    });
  });

  describe('invalidateIncompleteVariablesCache', () => {
    it('should delete cache key for workspace', async () => {
      mockCacheService.delete.mockResolvedValue(true);

      await service.invalidateIncompleteVariablesCache(1);

      expect(mockCacheService.delete).toHaveBeenCalledWith(
        'coding_incomplete_variables_v2:1'
      );
    });
  });

  describe('getAppliedResultsCount', () => {
    it('should return 0 when no incomplete variables provided', async () => {
      const result = await service.getAppliedResultsCount(1, []);

      expect(result).toBe(0);
    });

    it('should count applied results for incomplete variables', async () => {
      const incompleteVariables = [
        { unitName: 'unit1', variableId: 'var1' },
        { unitName: 'unit2', variableId: 'var2' }
      ];

      mockResponseRepository.query.mockResolvedValue([{ applied_count: '10' }]);

      const result = await service.getAppliedResultsCount(
        1,
        incompleteVariables
      );

      expect(result).toBe(10);
      expect(mockResponseRepository.query).toHaveBeenCalled();
    });

    it('should process variables in batches', async () => {
      const incompleteVariables = Array.from({ length: 100 }, (_, i) => ({
        unitName: `unit${i}`,
        variableId: `var${i}`
      }));

      mockResponseRepository.query.mockResolvedValue([{ applied_count: '1' }]);

      await service.getAppliedResultsCount(1, incompleteVariables);

      expect(mockResponseRepository.query).toHaveBeenCalledTimes(2);
    });

    it('should handle database errors', async () => {
      const incompleteVariables = [{ unitName: 'unit1', variableId: 'var1' }];

      mockResponseRepository.query.mockRejectedValue(new Error('Query failed'));

      await expect(
        service.getAppliedResultsCount(1, incompleteVariables)
      ).rejects.toThrow('Could not get applied results count');
    });
  });
});
