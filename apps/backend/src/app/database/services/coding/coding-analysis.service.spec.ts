import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { CodingAnalysisService } from './coding-analysis.service';
import { CodingJobService, ResponseMatchingFlag } from './coding-job.service';
import { CodingValidationService } from './coding-validation.service';
import { CodingStatisticsService } from './coding-statistics.service';
import { CacheService } from '../../../cache/cache.service';
import Persons from '../../entities/persons.entity';
import { Unit } from '../../entities/unit.entity';
import { Booklet } from '../../entities/booklet.entity';
import { BookletInfo } from '../../entities/bookletInfo.entity';
import { ResponseEntity } from '../../entities/response.entity';

describe('CodingAnalysisService', () => {
  let service: CodingAnalysisService;
  let mockResponseRepository: jest.Mocked<Repository<ResponseEntity>>;
  let mockPersonsRepository: jest.Mocked<Repository<Persons>>;
  let mockBookletRepository: jest.Mocked<Repository<Booklet>>;
  let mockUnitRepository: jest.Mocked<Repository<Unit>>;
  let mockCodingJobService: jest.Mocked<CodingJobService>;
  let mockCodingValidationService: jest.Mocked<CodingValidationService>;
  let mockCodingStatisticsService: jest.Mocked<CodingStatisticsService>;

  const mockQueryBuilder = {
    leftJoin: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    distinct: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(0),
    getMany: jest.fn().mockResolvedValue([]),
    getRawMany: jest.fn().mockResolvedValue([])
  };

  const createMockResponse = (
    overrides: Partial<ResponseEntity> = {}
  ): ResponseEntity => ({
    id: 1,
    unitid: 1,
    variableid: 'var1',
    status: 1,
    value: null,
    subform: null,
    status_v1: null,
    code_v1: null,
    score_v1: null,
    status_v2: null,
    code_v2: null,
    score_v2: null,
    status_v3: null,
    code_v3: null,
    score_v3: null,
    unit: null as Unit | null,
    ...overrides
  }) as ResponseEntity;

  const createMockPerson = (overrides: Partial<Persons> = {}): Persons => ({
    id: 1,
    login: 'user1',
    code: 'code1',
    workspace_id: 1,
    group: 'group1',
    uploaded_at: new Date(),
    booklets: [],
    source: 'test',
    consider: true,
    booklets_relation: [] as Booklet[],
    ...overrides
  }) as Persons;

  const createMockBooklet = (overrides: Partial<Booklet> = {}): Booklet => ({
    id: 1,
    personid: 1,
    infoid: 1,
    lastts: 0,
    firstts: 0,
    person: null as Persons | null,
    bookletinfo: { id: 1, name: 'Booklet1', size: 1 } as BookletInfo,
    sessions: [],
    bookletLogs: [],
    units: [],
    ...overrides
  }) as Booklet;

  const createMockUnit = (overrides: Partial<Unit> = {}): Unit => ({
    id: 1,
    bookletid: 1,
    name: 'Unit1',
    alias: 'unit1',
    booklet: null as Booklet | null,
    unitLogs: [],
    unitLastStates: [],
    chunks: [],
    responses: [],
    tags: [],
    notes: [],
    ...overrides
  }) as Unit;

  beforeEach(async () => {
    mockResponseRepository = {
      find: jest.fn(),
      createQueryBuilder: jest.fn(
        () => mockQueryBuilder as unknown as SelectQueryBuilder<ResponseEntity>
      ),
      update: jest.fn(),
      manager: {
        connection: {
          createQueryRunner: jest.fn(() => ({
            connect: jest.fn(),
            startTransaction: jest.fn(),
            manager: {
              update: jest.fn()
            },
            commitTransaction: jest.fn(),
            rollbackTransaction: jest.fn(),
            release: jest.fn()
          }))
        }
      }
    } as unknown as jest.Mocked<Repository<ResponseEntity>>;

    mockPersonsRepository = {
      find: jest.fn()
    } as unknown as jest.Mocked<Repository<Persons>>;

    mockBookletRepository = {
      find: jest.fn()
    } as unknown as jest.Mocked<Repository<Booklet>>;

    mockUnitRepository = {
      find: jest.fn()
    } as unknown as jest.Mocked<Repository<Unit>>;

    mockCodingJobService = {
      getResponseMatchingMode: jest.fn(),
      normalizeValue: jest.fn(),
      setAggregationThreshold: jest.fn()
    } as unknown as jest.Mocked<CodingJobService>;

    mockCodingValidationService = {
      invalidateIncompleteVariablesCache: jest.fn()
    } as unknown as jest.Mocked<CodingValidationService>;

    mockCodingStatisticsService = {
      invalidateCache: jest.fn()
    } as unknown as jest.Mocked<CodingStatisticsService>;

    const mockCacheService = {
      get: jest.fn(),
      set: jest.fn(),
      deleteByPattern: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CodingAnalysisService,
        {
          provide: getRepositoryToken(ResponseEntity),
          useValue: mockResponseRepository
        },
        {
          provide: getRepositoryToken(Persons),
          useValue: mockPersonsRepository
        },
        {
          provide: getRepositoryToken(Booklet),
          useValue: mockBookletRepository
        },
        {
          provide: getRepositoryToken(Unit),
          useValue: mockUnitRepository
        },
        {
          provide: CodingJobService,
          useValue: mockCodingJobService
        },
        {
          provide: CodingValidationService,
          useValue: mockCodingValidationService
        },
        {
          provide: CodingStatisticsService,
          useValue: mockCodingStatisticsService
        },
        {
          provide: CacheService,
          useValue: mockCacheService
        }
      ]
    }).compile();

    service = module.get<CodingAnalysisService>(CodingAnalysisService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Reset mock implementations to default
    mockQueryBuilder.getRawMany.mockResolvedValue([]);
    mockQueryBuilder.getMany.mockResolvedValue([]);
    mockQueryBuilder.getCount.mockResolvedValue(0);
  });

  describe('getResponseAnalysis - Variable analysis', () => {
    it('should return empty analysis when no persons found', async () => {
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([
        ResponseMatchingFlag.NO_AGGREGATION
      ]);
      mockPersonsRepository.find.mockResolvedValue([]);

      const result = await service.getResponseAnalysis(1);

      expect(result).toMatchObject({
        emptyResponses: { total: 0, items: [] },
        duplicateValues: {
          total: 0,
          totalResponses: 0,
          groups: [],
          isAggregationApplied: false
        },
        matchingFlags: [ResponseMatchingFlag.NO_AGGREGATION],
        analysisTimestamp: expect.any(String)
      });
    });

    it('should return empty analysis when no booklets found', async () => {
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([
        ResponseMatchingFlag.NO_AGGREGATION
      ]);
      mockPersonsRepository.find.mockResolvedValue([createMockPerson()]);
      mockBookletRepository.find.mockResolvedValue([]);

      const result = await service.getResponseAnalysis(1);

      expect(result.emptyResponses.total).toBe(0);
      expect(result.duplicateValues.total).toBe(0);
    });

    it('should return empty analysis when no units found', async () => {
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([
        ResponseMatchingFlag.NO_AGGREGATION
      ]);
      mockPersonsRepository.find.mockResolvedValue([createMockPerson()]);
      mockBookletRepository.find.mockResolvedValue([createMockBooklet()]);
      mockUnitRepository.find.mockResolvedValue([]);

      const result = await service.getResponseAnalysis(1);

      expect(result.emptyResponses.total).toBe(0);
      expect(result.duplicateValues.total).toBe(0);
    });

    it('should identify empty responses correctly', async () => {
      const mockResponses = [
        createMockResponse({
          id: 1,
          value: null,
          status_v1: 1,
          status_v2: null
        }),
        createMockResponse({
          id: 2,
          variableid: 'var2',
          value: '',
          status_v1: 1,
          status_v2: null
        }),
        createMockResponse({
          id: 3,
          variableid: 'var3',
          value: '[]',
          status_v1: 1,
          status_v2: null
        })
      ];
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([
        ResponseMatchingFlag.NO_AGGREGATION
      ]);
      mockPersonsRepository.find.mockResolvedValue([createMockPerson()]);
      mockBookletRepository.find.mockResolvedValue([createMockBooklet()]);
      mockUnitRepository.find.mockResolvedValue([createMockUnit()]);
      mockResponseRepository.find.mockResolvedValue(mockResponses);
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { unitId: 1, variableId: 'var1' }
      ]);
      mockQueryBuilder.getMany.mockResolvedValue(mockResponses);
      mockQueryBuilder.getCount.mockResolvedValue(0);

      const result = await service.getResponseAnalysis(1);

      expect(result.emptyResponses.total).toBe(3);
      expect(result.emptyResponses.items).toHaveLength(3);
    });

    it('should not include already coded responses in empty analysis', async () => {
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([
        ResponseMatchingFlag.NO_AGGREGATION
      ]);
      mockPersonsRepository.find.mockResolvedValue([createMockPerson()]);
      mockBookletRepository.find.mockResolvedValue([createMockBooklet()]);
      mockUnitRepository.find.mockResolvedValue([createMockUnit()]);
      mockResponseRepository.find.mockResolvedValue([
        createMockResponse({
          id: 1,
          value: null,
          status_v1: 1,
          status_v2: 2,
          code_v2: 1,
          score_v2: 0
        })
      ]);
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { unitId: 1, variableId: 'var1' }
      ]);
      mockQueryBuilder.getCount.mockResolvedValue(0);

      const result = await service.getResponseAnalysis(1);

      expect(result.emptyResponses.total).toBe(0);
    });
  });

  describe('getResponseAnalysis - Derivation processing', () => {
    it('should identify duplicate values correctly', async () => {
      const mockResponses = [
        createMockResponse({
          id: 1,
          value: 'answer',
          status_v1: 1,
          status_v2: null
        }),
        createMockResponse({
          id: 2,
          value: 'answer',
          status_v1: 1,
          status_v2: null
        }),
        createMockResponse({
          id: 3,
          value: 'answer',
          status_v1: 1,
          status_v2: null
        })
      ];
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([
        ResponseMatchingFlag.NO_AGGREGATION
      ]);
      mockCodingJobService.normalizeValue.mockImplementation(
        (value: string) => value
      );
      mockPersonsRepository.find.mockResolvedValue([createMockPerson()]);
      mockBookletRepository.find.mockResolvedValue([createMockBooklet()]);
      mockUnitRepository.find.mockResolvedValue([createMockUnit()]);
      mockResponseRepository.find.mockResolvedValue(mockResponses);
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { unitId: 1, variableId: 'var1' }
      ]);
      mockQueryBuilder.getMany.mockResolvedValue(mockResponses);
      mockQueryBuilder.getCount.mockResolvedValue(0);

      const result = await service.getResponseAnalysis(1);

      expect(result.duplicateValues.total).toBe(1);
      expect(result.duplicateValues.groups[0].occurrences).toHaveLength(3);
    });

    it('should use normalized values for duplicate detection', async () => {
      const mockResponses = [
        createMockResponse({
          id: 1,
          value: 'Answer',
          status_v1: 1,
          status_v2: null
        }),
        createMockResponse({
          id: 2,
          value: '  ANSWER  ',
          status_v1: 1,
          status_v2: null
        }),
        createMockResponse({
          id: 3,
          value: 'answer',
          status_v1: 1,
          status_v2: null
        })
      ];
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([
        ResponseMatchingFlag.IGNORE_CASE,
        ResponseMatchingFlag.IGNORE_WHITESPACE
      ]);
      mockCodingJobService.normalizeValue.mockImplementation((value: string) => value.toLowerCase().replace(/\s/g, '')
      );
      mockPersonsRepository.find.mockResolvedValue([createMockPerson()]);
      mockBookletRepository.find.mockResolvedValue([createMockBooklet()]);
      mockUnitRepository.find.mockResolvedValue([createMockUnit()]);
      mockResponseRepository.find.mockResolvedValue(mockResponses);
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { unitId: 1, variableId: 'var1' }
      ]);
      mockQueryBuilder.getMany.mockResolvedValue(mockResponses);
      mockQueryBuilder.getCount.mockResolvedValue(0);

      const result = await service.getResponseAnalysis(1);

      expect(result.duplicateValues.total).toBe(1);
      expect(result.duplicateValues.groups[0].normalizedValue).toBe('answer');
    });

    it('should group duplicates by unit and variable', async () => {
      const mockUnit1 = createMockUnit({ id: 1, name: 'Unit1' });
      const mockUnit2 = createMockUnit({ id: 2, name: 'Unit2' });
      const mockResponses = [
        {
          ...createMockResponse({
            id: 1,
            unitid: 1,
            value: 'answer1',
            status_v1: 1,
            status_v2: null
          }),
          unit: mockUnit1
        },
        {
          ...createMockResponse({
            id: 2,
            unitid: 1,
            value: 'answer1',
            status_v1: 1,
            status_v2: null
          }),
          unit: mockUnit1
        },
        {
          ...createMockResponse({
            id: 3,
            unitid: 2,
            variableid: 'var2',
            value: 'answer2',
            status_v1: 1,
            status_v2: null
          }),
          unit: mockUnit2
        },
        {
          ...createMockResponse({
            id: 4,
            unitid: 2,
            variableid: 'var2',
            value: 'answer2',
            status_v1: 1,
            status_v2: null
          }),
          unit: mockUnit2
        }
      ] as ResponseEntity[];
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([
        ResponseMatchingFlag.NO_AGGREGATION
      ]);
      mockCodingJobService.normalizeValue.mockImplementation(
        (value: string) => value
      );
      mockPersonsRepository.find.mockResolvedValue([createMockPerson()]);
      mockBookletRepository.find.mockResolvedValue([createMockBooklet()]);
      mockUnitRepository.find.mockResolvedValue([mockUnit1, mockUnit2]);
      mockResponseRepository.find.mockResolvedValue(mockResponses);
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { unitId: 1, variableId: 'var1' },
        { unitId: 2, variableId: 'var2' }
      ]);
      mockQueryBuilder.getMany.mockResolvedValue(mockResponses);
      mockQueryBuilder.getCount.mockResolvedValue(0);

      const result = await service.getResponseAnalysis(1);

      expect(result.duplicateValues.total).toBe(2);
      expect(result.duplicateValues.groups[1].unitName).toBe('Unit2');
      expect(result.duplicateValues.groups[1].variableId).toBe('var2');
    });

    it('should skip empty values in duplicate analysis', async () => {
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([
        ResponseMatchingFlag.NO_AGGREGATION
      ]);
      mockPersonsRepository.find.mockResolvedValue([createMockPerson()]);
      mockBookletRepository.find.mockResolvedValue([createMockBooklet()]);
      mockUnitRepository.find.mockResolvedValue([createMockUnit()]);
      mockResponseRepository.find.mockResolvedValue([
        createMockResponse({
          id: 1,
          value: null,
          status_v1: 1,
          status_v2: null
        }),
        createMockResponse({
          id: 2,
          value: '',
          status_v1: 1,
          status_v2: null
        })
      ]);
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { unitId: 1, variableId: 'var1' }
      ]);
      mockQueryBuilder.getCount.mockResolvedValue(0);

      const result = await service.getResponseAnalysis(1);

      expect(result.duplicateValues.total).toBe(0);
    });
  });

  describe('getResponseAnalysis - External service integration', () => {
    it('should call getResponseMatchingMode from CodingJobService', async () => {
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([
        ResponseMatchingFlag.IGNORE_CASE
      ]);
      mockPersonsRepository.find.mockResolvedValue([]);

      await service.getResponseAnalysis(1);

      expect(mockCodingJobService.getResponseMatchingMode).toHaveBeenCalledWith(
        1
      );
    });

    it('should pass matching flags to normalizeValue', async () => {
      const matchingFlags = [
        ResponseMatchingFlag.IGNORE_CASE,
        ResponseMatchingFlag.IGNORE_WHITESPACE
      ];
      const mockResponses = [
        createMockResponse({
          id: 1,
          value: 'answer',
          status_v1: 1,
          status_v2: null
        }),
        createMockResponse({
          id: 2,
          value: 'answer',
          status_v1: 1,
          status_v2: null
        })
      ];
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue(
        matchingFlags
      );
      mockCodingJobService.normalizeValue.mockImplementation(
        (value: string) => value
      );
      mockPersonsRepository.find.mockResolvedValue([createMockPerson()]);
      mockBookletRepository.find.mockResolvedValue([createMockBooklet()]);
      mockUnitRepository.find.mockResolvedValue([createMockUnit()]);
      mockResponseRepository.find.mockResolvedValue(mockResponses);
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { unitId: 1, variableId: 'var1' }
      ]);
      mockQueryBuilder.getMany.mockResolvedValue(mockResponses);
      mockQueryBuilder.getCount.mockResolvedValue(0);

      await service.getResponseAnalysis(1);

      expect(mockCodingJobService.normalizeValue).toHaveBeenCalledWith(
        'answer',
        matchingFlags
      );
    });

    it('should check aggregation status using query builder', async () => {
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([
        ResponseMatchingFlag.NO_AGGREGATION
      ]);
      mockPersonsRepository.find.mockResolvedValue([createMockPerson()]);
      mockBookletRepository.find.mockResolvedValue([createMockBooklet()]);
      mockUnitRepository.find.mockResolvedValue([createMockUnit()]);
      // Need at least one response to trigger the aggregation check
      mockResponseRepository.find.mockResolvedValue([
        createMockResponse({
          id: 1,
          value: 'test',
          status_v1: 1,
          status_v2: null
        })
      ]);
      // Make getRawMany return data so flow continues
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { unitId: 1, variableId: 'var1' }
      ]);
      mockQueryBuilder.getCount.mockResolvedValue(5);

      const result = await service.getResponseAnalysis(1);

      expect(mockResponseRepository.createQueryBuilder).toHaveBeenCalledWith(
        'response'
      );
      expect(result.duplicateValues.isAggregationApplied).toBe(true);
    });
  });

  describe('getResponseAnalysis - Error handling', () => {
    it('should throw error when repository throws', async () => {
      mockCodingJobService.getResponseMatchingMode.mockRejectedValue(
        new Error('Database error')
      );

      await expect(service.getResponseAnalysis(1)).rejects.toThrow(
        'Failed to analyze responses'
      );
    });

    it('should throw error when response query fails', async () => {
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([
        ResponseMatchingFlag.NO_AGGREGATION
      ]);
      // Make getRawMany return data so flow continues
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { unitId: 1, variableId: 'var1' }
      ]);
      // Make getMany throw error
      mockQueryBuilder.getMany.mockRejectedValue(new Error('Connection lost'));

      await expect(service.getResponseAnalysis(1)).rejects.toThrow(
        'Failed to analyze responses'
      );
    });

    it('should handle responses with missing relations gracefully', async () => {
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([
        ResponseMatchingFlag.NO_AGGREGATION
      ]);
      mockPersonsRepository.find.mockResolvedValue([createMockPerson()]);
      mockBookletRepository.find.mockResolvedValue([createMockBooklet()]);
      // Create a unit with bookletid that won't match any booklet (999)
      mockUnitRepository.find.mockResolvedValue([
        createMockUnit({ bookletid: 999 })
      ]);
      mockResponseRepository.find.mockResolvedValue([
        createMockResponse({
          id: 999,
          unitid: 1,
          value: null,
          status_v1: 1,
          status_v2: null
        })
      ]);
      // Make getRawMany return data so flow continues
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { unitId: 1, variableId: 'var1' }
      ]);
      mockQueryBuilder.getCount.mockResolvedValue(0);

      const result = await service.getResponseAnalysis(1);

      // The response is filtered out because booklet relation is missing
      expect(result.emptyResponses.total).toBe(0);
    });
  });

  describe('applyDuplicateAggregation - Validation', () => {
    it('should reject threshold less than 2 in aggregate mode', async () => {
      const result = await service.applyDuplicateAggregation(1, 1, true);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Threshold must be at least 2');
    });
  });

  describe('applyDuplicateAggregation - Revert mode', () => {
    it('should revert aggregation when aggregateMode is false', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { id: 1 },
        { id: 2 },
        { id: 3 }
      ]);

      const result = await service.applyDuplicateAggregation(1, 5, false);

      expect(result.success).toBe(true);
      expect(result.aggregatedResponses).toBe(3);
      expect(mockResponseRepository.update).toHaveBeenCalled();
      expect(
        mockCodingValidationService.invalidateIncompleteVariablesCache
      ).toHaveBeenCalledWith(1);
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(
        1
      );
    });

    it('should handle empty revert result', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      const result = await service.applyDuplicateAggregation(1, 5, false);

      expect(result.success).toBe(true);
      expect(result.aggregatedResponses).toBe(0);
      expect(result.message).toContain('No aggregated responses found');
    });
  });

  describe('applyDuplicateAggregation - Aggregate mode', () => {
    beforeEach(() => {
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([
        ResponseMatchingFlag.NO_AGGREGATION
      ]);
      mockCodingJobService.normalizeValue.mockImplementation(
        (value: string) => value
      );
      // Mock getRawMany to return variable groups so analysis continues
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { unitId: 1, variableId: 'var1' }
      ]);
    });

    it('should aggregate duplicate responses meeting threshold', async () => {
      const mockResponses = [
        createMockResponse({
          id: 10,
          value: 'duplicate',
          status_v1: 1,
          status_v2: null
        }),
        createMockResponse({
          id: 20,
          value: 'duplicate',
          status_v1: 1,
          status_v2: null
        }),
        createMockResponse({
          id: 30,
          value: 'duplicate',
          status_v1: 1,
          status_v2: null
        })
      ];
      mockPersonsRepository.find.mockResolvedValue([createMockPerson()]);
      mockBookletRepository.find.mockResolvedValue([createMockBooklet()]);
      mockUnitRepository.find.mockResolvedValue([createMockUnit()]);
      mockResponseRepository.find.mockResolvedValue(mockResponses);
      // Mock getMany to return responses for the chunked query
      mockQueryBuilder.getMany.mockResolvedValue(mockResponses);
      mockQueryBuilder.getCount.mockResolvedValue(0);

      const result = await service.applyDuplicateAggregation(1, 2, true);

      expect(result.success).toBe(true);
      expect(result.aggregatedGroups).toBe(1);
      expect(result.aggregatedResponses).toBe(2);
      expect(mockCodingJobService.setAggregationThreshold).toHaveBeenCalledWith(
        1,
        2
      );
      expect(
        mockCodingValidationService.invalidateIncompleteVariablesCache
      ).toHaveBeenCalledWith(1);
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(
        1
      );
    });

    it('should not aggregate groups below threshold', async () => {
      const mockResponses = [
        createMockResponse({
          id: 10,
          value: 'dup',
          status_v1: 1,
          status_v2: null
        }),
        createMockResponse({
          id: 20,
          value: 'dup',
          status_v1: 1,
          status_v2: null
        })
      ];
      mockPersonsRepository.find.mockResolvedValue([createMockPerson()]);
      mockBookletRepository.find.mockResolvedValue([createMockBooklet()]);
      mockUnitRepository.find.mockResolvedValue([createMockUnit()]);
      mockResponseRepository.find.mockResolvedValue(mockResponses);
      // Mock getMany to return responses for the chunked query
      mockQueryBuilder.getMany.mockResolvedValue(mockResponses);
      mockQueryBuilder.getCount.mockResolvedValue(0);

      const result = await service.applyDuplicateAggregation(1, 3, true);

      expect(result.success).toBe(true);
      expect(result.aggregatedGroups).toBe(0);
      expect(result.message).toContain('No duplicate groups meet');
    });
  });

  describe('applyDuplicateAggregation - Error handling', () => {
    it('should return error response on exception', async () => {
      mockCodingJobService.getResponseMatchingMode.mockRejectedValue(
        new Error('Service unavailable')
      );

      const result = await service.applyDuplicateAggregation(1, 2, true);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Service unavailable');
    });

    it('should rollback transaction on error during aggregation', async () => {
      const queryRunnerMock = {
        connect: jest.fn(),
        startTransaction: jest.fn(),
        manager: {
          update: jest.fn().mockRejectedValue(new Error('Update failed'))
        },
        commitTransaction: jest.fn(),
        rollbackTransaction: jest.fn(),
        release: jest.fn()
      };
      (mockResponseRepository.manager.connection
        .createQueryRunner as jest.Mock) = jest.fn(() => queryRunnerMock);

      const mockResponses = [
        createMockResponse({
          id: 10,
          value: 'dup',
          status_v1: 1,
          status_v2: null
        }),
        createMockResponse({
          id: 20,
          value: 'dup',
          status_v1: 1,
          status_v2: null
        })
      ];
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([
        ResponseMatchingFlag.NO_AGGREGATION
      ]);
      mockPersonsRepository.find.mockResolvedValue([createMockPerson()]);
      mockBookletRepository.find.mockResolvedValue([createMockBooklet()]);
      mockUnitRepository.find.mockResolvedValue([createMockUnit()]);
      mockResponseRepository.find.mockResolvedValue(mockResponses);
      // Mock getMany to return responses for the chunked query
      mockQueryBuilder.getMany.mockResolvedValue(mockResponses);
      mockQueryBuilder.getCount.mockResolvedValue(0);
      // Mock getRawMany to return variable groups so analysis continues
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { unitId: 1, variableId: 'var1' }
      ]);

      const result = await service.applyDuplicateAggregation(1, 2, true);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Update failed');
      expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunnerMock.release).toHaveBeenCalled();
    });
  });

  describe('createEmptyAnalysisResult', () => {
    it('should create empty result with provided matching flags', () => {
      const flags = [
        ResponseMatchingFlag.IGNORE_CASE,
        ResponseMatchingFlag.NO_AGGREGATION
      ];

      // Access private method via typed interface for testing
      const result = (
        service as unknown as {
          createEmptyAnalysisResult: (flags: ResponseMatchingFlag[]) => {
            matchingFlags: ResponseMatchingFlag[];
            emptyResponses: { total: number };
            duplicateValues: { total: number };
            analysisTimestamp: string;
          };
        }
      ).createEmptyAnalysisResult(flags);

      expect(result.matchingFlags).toEqual(flags);
      expect(result.emptyResponses.total).toBe(0);
      expect(result.duplicateValues.total).toBe(0);
      expect(result.analysisTimestamp).toBeDefined();
    });

    it('should set isAggregationApplied based on NO_AGGREGATION flag', () => {
      // Access private method via typed interface for testing
      const resultWithAggregation = (
        service as unknown as {
          createEmptyAnalysisResult: (flags: ResponseMatchingFlag[]) => {
            duplicateValues: { isAggregationApplied: boolean };
          };
        }
      ).createEmptyAnalysisResult([ResponseMatchingFlag.IGNORE_CASE]);
      const resultWithoutAggregation = (
        service as unknown as {
          createEmptyAnalysisResult: (flags: ResponseMatchingFlag[]) => {
            duplicateValues: { isAggregationApplied: boolean };
          };
        }
      ).createEmptyAnalysisResult([ResponseMatchingFlag.NO_AGGREGATION]);

      expect(resultWithAggregation.duplicateValues.isAggregationApplied).toBe(
        true
      );
      expect(
        resultWithoutAggregation.duplicateValues.isAggregationApplied
      ).toBe(false);
    });
  });
});
