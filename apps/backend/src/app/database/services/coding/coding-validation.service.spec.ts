import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Brackets, Repository, SelectQueryBuilder } from 'typeorm';
import { ExpectedCombinationDto } from '../../../../../../../api-dto/coding/expected-combination.dto';
import { CodingValidationService } from './coding-validation.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CacheService } from '../../../cache/cache.service';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { WorkspacePlayerService } from '../workspace/workspace-player.service';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { CodingJobService, ResponseMatchingFlag } from './coding-job.service';
import { getManualCodingScopeKey } from '../../utils/manual-coding-scope.util';
import { statusStringToNumber } from '../../utils/response-status-converter';

describe('CodingValidationService', () => {
  let service: CodingValidationService;
  let mockResponseRepository: jest.Mocked<Repository<ResponseEntity>>;
  let mockCodingJobUnitRepository: jest.Mocked<Repository<CodingJobUnit>>;
  let mockCacheService: jest.Mocked<CacheService>;
  let mockWorkspaceFilesService: jest.Mocked<WorkspaceFilesService>;
  let mockWorkspacePlayerService: jest.Mocked<WorkspacePlayerService>;
  let mockCodingJobService: jest.Mocked<CodingJobService>;

  const mockQueryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orWhere: jest.fn().mockReturnThis(),
    getCount: jest.fn(),
    getOne: jest.fn(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    distinct: jest.fn().mockReturnThis(),
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

  const createMockResponse = (
    overrides: Partial<ResponseEntity> = {}
  ): ResponseEntity => ({
    id: 1,
    value: 'response-value',
    variableid: 'var1',
    unit: {
      name: 'unit1',
      alias: 'unit-alias',
      booklet: {
        person: {
          login: 'user1',
          code: 'code1',
          group: 'group1',
          workspace_id: 1
        },
        bookletinfo: {
          name: 'booklet1'
        }
      }
    },
    ...overrides
  } as unknown as ResponseEntity);

  const createQueryBuilderMock = <T extends Record<string, unknown>>(rawResults: T[] = []) => ({
    innerJoin: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orWhere: jest.fn().mockReturnThis(),
    getCount: jest.fn(),
    getOne: jest.fn(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    distinct: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rawResults)
  }) as unknown as jest.Mocked<SelectQueryBuilder<ResponseEntity>>;

  const createSlimResponses = (
    unitName: string,
    variableid: string,
    count: number,
    overrides: Partial<{ value: string | null; statusV1: number | null }> = {}
  ) => Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    unitName,
    variableid,
    value: overrides.value ?? `value-${index + 1}`,
    ...(overrides.statusV1 !== undefined ? { statusV1: overrides.statusV1 } : {}),
    personLogin: `${variableid}-person-${index + 1}`,
    personCode: `${index + 1}`,
    personGroup: 'group'
  }));

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
      delete: jest.fn(),
      getNumber: jest.fn().mockResolvedValue(0),
      incr: jest.fn().mockResolvedValue(1)
    } as unknown as jest.Mocked<CacheService>;

    mockWorkspaceFilesService = {
      getUnitVariableMap: jest.fn(),
      getIntendedIncompleteSchemeVariableMap: jest.fn(),
      getUnitVariableDetails: jest.fn(),
      getDerivedVariableMap: jest.fn(),
      getCoderTrainingRequiredVariableMap: jest.fn(),
      getDerivedVariablesBySourceMap: jest.fn(),
      getManualInstructionVariableMap: jest.fn()
    } as unknown as jest.Mocked<WorkspaceFilesService>;

    mockWorkspacePlayerService = {
      findUnitDef: jest.fn().mockResolvedValue([{ file_id: 'UNIT1.VOUD' }]),
      findUnit: jest.fn().mockResolvedValue([{
        file_id: 'UNIT1',
        data: '<Unit><DefinitionRef player="VERONA-1.0.0"/></Unit>'
      }]),
      findPlayer: jest.fn().mockResolvedValue([{ file_id: 'VERONA-1.0.0' }])
    } as unknown as jest.Mocked<WorkspacePlayerService>;

    mockCodingJobService = {
      getResponseMatchingMode: jest.fn().mockResolvedValue([]),
      getAggregationThreshold: jest.fn().mockResolvedValue(2),
      getSlimResponsesForVariables: jest.fn().mockResolvedValue([]),
      getSlimResponsesForVariableCoverage: jest.fn(),
      aggregateResponsesByValue: jest.fn().mockReturnValue([])
    } as unknown as jest.Mocked<CodingJobService>;
    mockCodingJobService.getSlimResponsesForVariableCoverage.mockImplementation(
      async (workspaceId, variables) => (
        mockCodingJobService.getSlimResponsesForVariables(workspaceId, variables)
      )
    );
    mockQueryBuilder.getRawMany.mockResolvedValue([]);
    mockQueryBuilder.getCount.mockResolvedValue(0);
    mockWorkspaceFilesService.getManualInstructionVariableMap.mockResolvedValue(new Map());

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
        },
        {
          provide: WorkspacePlayerService,
          useValue: mockWorkspacePlayerService
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
          provide: CodingJobService,
          useValue: mockCodingJobService
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
      mockQueryBuilder.getOne.mockResolvedValue(createMockResponse());
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
      expect(mockQueryBuilder.getOne).toHaveBeenCalled();
    });

    it('should return MISSING status when response not found', async () => {
      const expectedCombinations = [createMockExpectedCombination()];

      mockCacheService.generateValidationCacheKey.mockReturnValue('cache-key');
      mockCacheService.getPaginatedValidationResults.mockResolvedValue(null);
      mockQueryBuilder.getOne.mockResolvedValue(null);
      mockCacheService.storeValidationResults.mockResolvedValue(true);

      const result = await service.validateCodingCompleteness(
        1,
        expectedCombinations
      );

      expect(result.results[0].status).toBe('MISSING');
      expect(result.results[0].responseFound).toBe(false);
      expect(result.missing).toBe(1);
    });

    it('should return MISSING status when replay unit file is missing', async () => {
      const expectedCombinations = [createMockExpectedCombination()];

      mockCacheService.generateValidationCacheKey.mockReturnValue('cache-key');
      mockCacheService.getPaginatedValidationResults.mockResolvedValue(null);
      mockQueryBuilder.getOne.mockResolvedValue(createMockResponse());
      mockWorkspacePlayerService.findUnit.mockResolvedValueOnce([]);
      mockCacheService.storeValidationResults.mockResolvedValue(true);

      const result = await service.validateCodingCompleteness(
        1,
        expectedCombinations
      );

      expect(result.results[0].status).toBe('MISSING');
      expect(result.results[0].responseFound).toBe(true);
      expect(result.results[0].issues).toContain('Unit-Datei fehlt: UNIT1.');
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
      mockQueryBuilder.getOne.mockResolvedValue(createMockResponse());
      mockCacheService.storeValidationResults.mockResolvedValue(true);

      await service.validateCodingCompleteness(1, expectedCombinations);

      expect(mockQueryBuilder.getOne).toHaveBeenCalledTimes(150);
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
      mockQueryBuilder.getOne.mockResolvedValue(createMockResponse());
      mockCacheService.storeValidationResults.mockResolvedValue(true);

      await service.validateCodingCompleteness(1, expectedCombinations);

      expect(mockResponseRepository.createQueryBuilder).toHaveBeenCalledWith(
        'response'
      );
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'response.unit',
        'unit'
      );
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'unit.booklet',
        'booklet'
      );
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'booklet.person',
        'person'
      );
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'booklet.bookletinfo',
        'bookletinfo'
      );
    });

    it('should filter by person group when supplied by the coding list', async () => {
      const expectedCombinations = [
        createMockExpectedCombination({ person_group: 'group-a' })
      ];

      mockCacheService.generateValidationCacheKey.mockReturnValue('cache-key');
      mockCacheService.getPaginatedValidationResults.mockResolvedValue(null);
      mockQueryBuilder.getOne.mockResolvedValue(createMockResponse());
      mockCacheService.storeValidationResults.mockResolvedValue(true);

      await service.validateCodingCompleteness(1, expectedCombinations);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'person.group = :personGroup',
        { personGroup: 'group-a' }
      );
    });
  });

  describe('validateCodingCompleteness - Pagination', () => {
    it('should use default pagination when not specified', async () => {
      const expectedCombinations = Array.from({ length: 100 }, (_, i) => createMockExpectedCombination({ variable_id: `var${i}` })
      );

      mockCacheService.generateValidationCacheKey.mockReturnValue('cache-key');
      mockCacheService.getPaginatedValidationResults.mockResolvedValue(null);
      mockQueryBuilder.getOne.mockResolvedValue(createMockResponse());
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
      mockQueryBuilder.getOne.mockResolvedValue(createMockResponse());
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
      mockQueryBuilder.getOne.mockResolvedValue(createMockResponse());
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
      const expectedCombinations = [
        {
          ...createMockExpectedCombination(),
          url: 'https://example.test/#/replay/person/unit?auth=secret-token'
        } as ExpectedCombinationDto & { url: string }
      ];

      mockCacheService.generateValidationCacheKey.mockReturnValue('cache-key');
      mockCacheService.getPaginatedValidationResults.mockResolvedValue(null);
      mockQueryBuilder.getOne.mockResolvedValue(createMockResponse());
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
      expect(
        mockCacheService.storeValidationResults.mock.calls[0][1][0].combination
      ).not.toHaveProperty('url');
      expect(
        mockCacheService.storeValidationResults.mock.calls[0][1][0].responseFound
      ).toBe(true);
    });

    it('should continue without error if cache storage fails', async () => {
      const expectedCombinations = [createMockExpectedCombination()];

      mockCacheService.generateValidationCacheKey.mockReturnValue('cache-key');
      mockCacheService.getPaginatedValidationResults.mockResolvedValue(null);
      mockQueryBuilder.getOne.mockResolvedValue(createMockResponse());
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
        'coding_incomplete_variables_v9:1'
      );
    });

    it('should filter cached variables by unit name without case sensitivity', async () => {
      const cachedVariables = [{
        unitName: 'Unit1',
        variableId: 'var1',
        responseCount: 5,
        deriveErrorResponseCount: 0,
        casesInJobs: 0,
        availableCases: 5,
        uniqueCasesAfterAggregation: 5,
        isDerived: false,
        coderTrainingRequired: false
      }];
      mockCacheService.get.mockResolvedValue(cachedVariables);

      await expect(
        service.getCodingIncompleteVariables(1, 'UNIT1')
      ).resolves.toEqual(cachedVariables);
    });

    it('should include all unit-name case aliases in a scoped database query', async () => {
      const unitAliasesQb = createQueryBuilderMock([
        { unitName: 'UNIT1' },
        { unitName: 'unit1' }
      ]);
      const codingIncompleteQb = createQueryBuilderMock([
        { unitName: 'UNIT1', variableId: 'var1', responseCount: '2' },
        { unitName: 'unit1', variableId: 'var1', responseCount: '3' }
      ]);
      const intendedIncompleteQb = createQueryBuilderMock([]);
      const deriveErrorQb = createQueryBuilderMock([]);
      const assignedResponsesQb = createQueryBuilderMock([]);
      mockResponseRepository.createQueryBuilder = jest.fn()
        .mockReturnValueOnce(unitAliasesQb)
        .mockReturnValueOnce(codingIncompleteQb)
        .mockReturnValueOnce(intendedIncompleteQb)
        .mockReturnValueOnce(deriveErrorQb);
      (mockCodingJobUnitRepository.createQueryBuilder as jest.Mock)
        .mockReturnValue(assignedResponsesQb);
      mockCacheService.get.mockResolvedValue(null);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['var1'])]])
      );
      mockWorkspaceFilesService.getDerivedVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getCoderTrainingRequiredVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getDerivedVariablesBySourceMap.mockResolvedValue(new Map());
      mockCodingJobService.getAggregationThreshold.mockResolvedValue(null);
      mockCodingJobService.getSlimResponsesForVariables.mockResolvedValue([
        ...createSlimResponses('UNIT1', 'var1', 2),
        ...createSlimResponses('unit1', 'var1', 3).map((response, index) => ({
          ...response,
          id: index + 3,
          value: `lower-value-${index + 1}`,
          personLogin: `lower-person-${index + 1}`,
          personCode: `lower-${index + 1}`
        }))
      ] as never);

      const result = await service.getCodingIncompleteVariables(1, 'Unit1');

      expect(result).toEqual([
        expect.objectContaining({
          unitName: 'UNIT1',
          variableId: 'var1',
          responseCount: 5,
          uniqueCasesAfterAggregation: 5
        })
      ]);
      expect(unitAliasesQb.andWhere).toHaveBeenCalledWith(
        'UPPER(unit.name) = UPPER(:unitName)',
        { unitName: 'Unit1' }
      );
      [codingIncompleteQb, intendedIncompleteQb, deriveErrorQb]
        .forEach(query => {
          expect(query.andWhere).toHaveBeenCalledWith(
            'unit.name IN (:...scopedUnitNames)',
            { scopedUnitNames: ['UNIT1', 'unit1'] }
          );
        });
      expect(mockCodingJobService.getSlimResponsesForVariables).toHaveBeenCalledWith(
        1,
        [
          { unitName: 'UNIT1', variableId: 'var1' },
          { unitName: 'unit1', variableId: 'var1' }
        ]
      );
    });

    it('should ignore cached variables from an older invalidation version', async () => {
      const codingIncompleteQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId: 'fresh-var', responseCount: '1' }
      ]);
      const intendedIncompleteQb = createQueryBuilderMock([]);
      const deriveErrorQb = createQueryBuilderMock([]);
      const casesInJobsQb = createQueryBuilderMock([]);

      mockResponseRepository.createQueryBuilder = jest.fn()
        .mockReturnValueOnce(codingIncompleteQb)
        .mockReturnValueOnce(intendedIncompleteQb)
        .mockReturnValueOnce(deriveErrorQb);
      (mockCodingJobUnitRepository.createQueryBuilder as jest.Mock).mockReturnValue(casesInJobsQb);

      mockCacheService.getNumber.mockResolvedValue(2);
      mockCacheService.get.mockImplementation(async key => (
        key === 'coding_incomplete_variables_v9:1' ?
          {
            invalidationVersion: 1,
            data: [
              {
                unitName: 'unit1',
                variableId: 'stale-var',
                responseCount: 9,
                deriveErrorResponseCount: 0,
                casesInJobs: 0,
                availableCases: 9,
                uniqueCasesAfterAggregation: 9,
                isDerived: false,
                coderTrainingRequired: false
              }
            ]
          } :
          null
      ));
      mockCacheService.set.mockResolvedValue(true);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['fresh-var'])]])
      );
      mockWorkspaceFilesService.getDerivedVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getCoderTrainingRequiredVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getDerivedVariablesBySourceMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getManualInstructionVariableMap.mockResolvedValue(new Map());
      mockCodingJobService.getAggregationThreshold.mockResolvedValue(null);
      mockCodingJobService.getSlimResponsesForVariables.mockResolvedValue(
        createSlimResponses('unit1', 'fresh-var', 1) as never
      );

      const result = await service.getCodingIncompleteVariables(1);

      expect(result).toEqual([
        expect.objectContaining({
          unitName: 'unit1',
          variableId: 'fresh-var',
          responseCount: 1
        })
      ]);
      expect(mockCacheService.set).toHaveBeenCalledWith(
        'coding_incomplete_variables_v9:1',
        {
          invalidationVersion: 2,
          data: result
        },
        300
      );
    });

    it('should include INTENDED_INCOMPLETE variables even when they are defined in the scheme', async () => {
      const codingIncompleteQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId: 'var1', responseCount: '5' }
      ]);
      const intendedIncompleteQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId: 'var1', responseCount: '3' },
        { unitName: 'unit1', variableId: 'intended-only', responseCount: '2' }
      ]);
      const deriveErrorQb = createQueryBuilderMock([]);
      const casesInJobsQb = createQueryBuilderMock([]);

      mockResponseRepository.createQueryBuilder = jest.fn()
        .mockReturnValueOnce(codingIncompleteQb)
        .mockReturnValueOnce(intendedIncompleteQb)
        .mockReturnValueOnce(deriveErrorQb);
      (mockCodingJobUnitRepository.createQueryBuilder as jest.Mock).mockReturnValue(casesInJobsQb);

      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(true);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['var1', 'intended-only'])]])
      );
      mockWorkspaceFilesService.getIntendedIncompleteSchemeVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['var1', 'intended-only'])]])
      );
      mockWorkspaceFilesService.getDerivedVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getCoderTrainingRequiredVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getDerivedVariablesBySourceMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getManualInstructionVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['var1', 'intended-only'])]])
      );
      mockCodingJobService.getAggregationThreshold.mockResolvedValue(null);
      mockCodingJobService.getSlimResponsesForVariables.mockResolvedValue([
        ...createSlimResponses('unit1', 'var1', 8),
        ...createSlimResponses('unit1', 'intended-only', 2)
      ] as never);

      const result = await service.getCodingIncompleteVariables(1);

      expect(result).toEqual([
        expect.objectContaining({
          unitName: 'unit1',
          variableId: 'var1',
          responseCount: 8,
          availableCases: 8,
          uniqueCasesAfterAggregation: 8
        }),
        expect.objectContaining({
          unitName: 'unit1',
          variableId: 'intended-only',
          responseCount: 2,
          availableCases: 2,
          uniqueCasesAfterAggregation: 2
        })
      ]);
      expect(mockCacheService.set).toHaveBeenCalledWith(
        'coding_incomplete_variables_v9:1',
        {
          invalidationVersion: 0,
          data: result
        },
        300
      );
      expect(mockCacheService.set).toHaveBeenCalledWith(
        'coding_incomplete_variables_scope_v2:1',
        expect.objectContaining({
          invalidationVersion: 0,
          data: expect.objectContaining({
            variables: expect.arrayContaining([
              expect.objectContaining({
                unitName: 'unit1',
                variableId: 'var1'
              })
            ])
          })
        }),
        300
      );
    });

    it('should not cache variables when invalidated while the query is running', async () => {
      const codingIncompleteQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId: 'var1', responseCount: '1' }
      ]);
      const intendedIncompleteQb = createQueryBuilderMock([]);
      const deriveErrorQb = createQueryBuilderMock([]);
      const casesInJobsQb = createQueryBuilderMock([]);

      mockResponseRepository.createQueryBuilder = jest.fn()
        .mockReturnValueOnce(codingIncompleteQb)
        .mockReturnValueOnce(intendedIncompleteQb)
        .mockReturnValueOnce(deriveErrorQb);
      (mockCodingJobUnitRepository.createQueryBuilder as jest.Mock).mockReturnValue(casesInJobsQb);

      mockCacheService.getNumber
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(6)
        .mockResolvedValueOnce(6);
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(true);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['var1'])]])
      );
      mockWorkspaceFilesService.getDerivedVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getCoderTrainingRequiredVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getDerivedVariablesBySourceMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getManualInstructionVariableMap.mockResolvedValue(new Map());
      mockCodingJobService.getAggregationThreshold.mockResolvedValue(null);
      mockCodingJobService.getSlimResponsesForVariables.mockResolvedValue(
        createSlimResponses('unit1', 'var1', 1) as never
      );

      const result = await service.getCodingIncompleteVariables(1);

      expect(result).toEqual([
        expect.objectContaining({
          unitName: 'unit1',
          variableId: 'var1',
          responseCount: 1
        })
      ]);
      expect(mockCacheService.set).not.toHaveBeenCalled();
    });

    it('should exclude INTENDED_INCOMPLETE variables without manual instruction', async () => {
      const codingIncompleteQb = createQueryBuilderMock([]);
      const intendedIncompleteQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId: 'manual-var', responseCount: '2' },
        { unitName: 'unit1', variableId: 'auto-only-var', responseCount: '3' }
      ]);
      const deriveErrorQb = createQueryBuilderMock([]);
      const casesInJobsQb = createQueryBuilderMock([]);

      mockResponseRepository.createQueryBuilder = jest.fn()
        .mockReturnValueOnce(codingIncompleteQb)
        .mockReturnValueOnce(intendedIncompleteQb)
        .mockReturnValueOnce(deriveErrorQb);
      (mockCodingJobUnitRepository.createQueryBuilder as jest.Mock).mockReturnValue(casesInJobsQb);

      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(true);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['manual-var', 'auto-only-var'])]])
      );
      mockWorkspaceFilesService.getDerivedVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getCoderTrainingRequiredVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getDerivedVariablesBySourceMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getManualInstructionVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['manual-var'])]])
      );
      mockCodingJobService.getAggregationThreshold.mockResolvedValue(null);
      mockCodingJobService.getSlimResponsesForVariables.mockResolvedValue(
        createSlimResponses('unit1', 'manual-var', 2) as never
      );

      const result = await service.getCodingIncompleteVariables(1);

      expect(result.map(variable => variable.variableId)).toEqual(['manual-var']);
    });

    it('should expose DERIVE_ERROR response counts per manual coding variable', async () => {
      const codingIncompleteQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId: 'var1', responseCount: '5' },
        { unitName: 'unit1', variableId: 'var2', responseCount: '2' }
      ]);
      const intendedIncompleteQb = createQueryBuilderMock([]);
      const deriveErrorQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId: 'var1', responseCount: '3' }
      ]);
      const casesInJobsQb = createQueryBuilderMock([]);

      mockResponseRepository.createQueryBuilder = jest.fn()
        .mockReturnValueOnce(codingIncompleteQb)
        .mockReturnValueOnce(intendedIncompleteQb)
        .mockReturnValueOnce(deriveErrorQb);
      (mockCodingJobUnitRepository.createQueryBuilder as jest.Mock).mockReturnValue(casesInJobsQb);

      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(true);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['var1', 'var2'])]])
      );
      mockWorkspaceFilesService.getDerivedVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getCoderTrainingRequiredVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getDerivedVariablesBySourceMap.mockResolvedValue(new Map());
      mockCodingJobService.getAggregationThreshold.mockResolvedValue(null);
      mockCodingJobService.getSlimResponsesForVariables.mockResolvedValue([
        ...createSlimResponses('unit1', 'var1', 5),
        ...createSlimResponses('unit1', 'var2', 2)
      ] as never);

      const result = await service.getCodingIncompleteVariables(1);

      expect(result).toEqual([
        expect.objectContaining({
          variableId: 'var1',
          deriveErrorResponseCount: 3
        }),
        expect.objectContaining({
          variableId: 'var2',
          deriveErrorResponseCount: 0
        })
      ]);
    });

    it('should apply training deduplication to standard case counts without aggregation', async () => {
      const codingIncompleteQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId: 'var1', responseCount: '3' }
      ]);
      const intendedIncompleteQb = createQueryBuilderMock([]);
      const deriveErrorQb = createQueryBuilderMock([]);
      const assignedResponsesQb = createQueryBuilderMock([]);

      mockResponseRepository.createQueryBuilder = jest.fn()
        .mockReturnValueOnce(codingIncompleteQb)
        .mockReturnValueOnce(intendedIncompleteQb)
        .mockReturnValueOnce(deriveErrorQb);
      (mockCodingJobUnitRepository.createQueryBuilder as jest.Mock)
        .mockReturnValueOnce(assignedResponsesQb);

      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(true);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['var1'])]])
      );
      mockWorkspaceFilesService.getDerivedVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getCoderTrainingRequiredVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getDerivedVariablesBySourceMap.mockResolvedValue(new Map());
      mockCodingJobService.getAggregationThreshold.mockResolvedValue(null);
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([]);
      mockCodingJobService.getSlimResponsesForVariables.mockResolvedValue([
        {
          id: 1, unitName: 'unit1', variableid: 'var1', value: 'same', personLogin: 'person', personCode: 'code', personGroup: 'group'
        },
        {
          id: 2, unitName: 'unit1', variableid: 'var1', value: 'same', personLogin: 'person', personCode: 'code', personGroup: 'group'
        },
        {
          id: 3, unitName: 'unit1', variableid: 'var1', value: 'other', personLogin: 'person', personCode: 'code', personGroup: 'group'
        }
      ] as never);

      const result = await service.getCodingIncompleteVariables(1);

      expect(result).toEqual([
        expect.objectContaining({
          unitName: 'unit1',
          variableId: 'var1',
          responseCount: 3,
          availableCases: 2,
          uniqueCasesAfterAggregation: 2
        })
      ]);
    });

    it('should exclude INTENDED_INCOMPLETE source variables covered by derived manual variables', async () => {
      const codingIncompleteQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId: 'derived-var', responseCount: '3' }
      ]);
      const intendedIncompleteQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId: 'base-var', responseCount: '3' },
        { unitName: 'unit1', variableId: 'standalone-var', responseCount: '2' }
      ]);
      const deriveErrorQb = createQueryBuilderMock([]);
      const casesInJobsQb = createQueryBuilderMock([]);

      mockResponseRepository.createQueryBuilder = jest.fn()
        .mockReturnValueOnce(codingIncompleteQb)
        .mockReturnValueOnce(intendedIncompleteQb)
        .mockReturnValueOnce(deriveErrorQb)
        .mockReturnValueOnce(createQueryBuilderMock([
          { unitName: 'unit1', variableId: 'derived-var', responseCount: '3' }
        ]))
        .mockReturnValueOnce(createQueryBuilderMock([
          { unitName: 'unit1', variableId: 'base-var', responseCount: '3' },
          { unitName: 'unit1', variableId: 'standalone-var', responseCount: '2' }
        ]))
        .mockReturnValueOnce(createQueryBuilderMock([]));
      (mockCodingJobUnitRepository.createQueryBuilder as jest.Mock).mockReturnValue(casesInJobsQb);

      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(true);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['base-var', 'derived-var', 'standalone-var'])]])
      );
      mockWorkspaceFilesService.getDerivedVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['derived-var'])]])
      );
      mockWorkspaceFilesService.getCoderTrainingRequiredVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getDerivedVariablesBySourceMap.mockResolvedValue(
        new Map([
          [getManualCodingScopeKey('unit1', 'base-var'), new Set(['derived-var'])]
        ])
      );
      mockWorkspaceFilesService.getManualInstructionVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['base-var', 'standalone-var'])]])
      );
      mockCodingJobService.getAggregationThreshold.mockResolvedValue(null);
      mockCodingJobService.getSlimResponsesForVariables.mockResolvedValue([
        ...createSlimResponses('unit1', 'derived-var', 3),
        ...createSlimResponses('unit1', 'standalone-var', 2)
      ] as never);

      const result = await service.getCodingIncompleteVariables(1);
      const summary = await service.getManualCodingScopeSummary(1);

      expect(result.map(variable => variable.variableId)).toEqual([
        'derived-var',
        'standalone-var'
      ]);
      expect(summary).toMatchObject({
        manualVariableCount: 2,
        manualResponseCount: 5,
        coveredSourceVariableCount: 1,
        coveredSourceResponseCount: 3,
        coveredSourceVariables: [
          {
            unitName: 'unit1',
            variableId: 'base-var',
            responseCount: 3,
            derivedVariableIds: ['derived-var']
          }
        ]
      });
    });

    it('should return manual coding scope summary from cache without querying responses', async () => {
      mockCacheService.get.mockImplementation(async key => (
        key === 'coding_incomplete_variables_scope_v2:1' ?
          {
            variables: [
              {
                unitName: 'unit1',
                variableId: 'var1',
                responseCount: 5,
                deriveErrorResponseCount: 0,
                isDerived: false,
                coderTrainingRequired: false
              }
            ],
            excludedSourceSummary: {
              coveredSourceVariableCount: 1,
              coveredSourceResponseCount: 3,
              coveredSourceVariables: [
                {
                  unitName: 'unit1',
                  variableId: 'source-var',
                  responseCount: 3,
                  derivedVariableIds: ['var1']
                }
              ]
            }
          } :
          null
      ));

      const summary = await service.getManualCodingScopeSummary(1);

      expect(summary).toEqual({
        manualVariableCount: 1,
        manualResponseCount: 5,
        coveredSourceVariableCount: 1,
        coveredSourceResponseCount: 3,
        coveredSourceVariables: [
          {
            unitName: 'unit1',
            variableId: 'source-var',
            responseCount: 3,
            derivedVariableIds: ['var1']
          }
        ]
      });
      expect(mockResponseRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should not collapse empty responses when counting unique cases after aggregation', async () => {
      const codingIncompleteQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId: 'var1', responseCount: '4' }
      ]);
      const intendedIncompleteQb = createQueryBuilderMock([]);
      const deriveErrorQb = createQueryBuilderMock([]);
      const casesInJobsQb = createQueryBuilderMock([]);

      mockResponseRepository.createQueryBuilder = jest.fn()
        .mockReturnValueOnce(codingIncompleteQb)
        .mockReturnValueOnce(intendedIncompleteQb)
        .mockReturnValueOnce(deriveErrorQb);
      (mockCodingJobUnitRepository.createQueryBuilder as jest.Mock).mockReturnValue(casesInJobsQb);

      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(true);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['var1'])]])
      );
      mockWorkspaceFilesService.getDerivedVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getCoderTrainingRequiredVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getDerivedVariablesBySourceMap.mockResolvedValue(new Map());
      mockCodingJobService.getAggregationThreshold.mockResolvedValue(2);
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([]);
      mockCodingJobService.getSlimResponsesForVariables.mockResolvedValue([
        {
          id: 1,
          unitName: 'unit1',
          variableid: 'var1',
          value: '',
          personLogin: 'person-1'
        },
        {
          id: 2,
          unitName: 'unit1',
          variableid: 'var1',
          value: '',
          personLogin: 'person-2'
        },
        {
          id: 3,
          unitName: 'unit1',
          variableid: 'var1',
          value: null,
          personLogin: 'person-3'
        },
        {
          id: 4,
          unitName: 'unit1',
          variableid: 'var1',
          value: '[]',
          personLogin: 'person-4'
        }
      ] as never);

      const result = await service.getCodingIncompleteVariables(1);

      expect(result).toEqual([
        expect.objectContaining({
          unitName: 'unit1',
          variableId: 'var1',
          responseCount: 4,
          availableCases: 4,
          uniqueCasesAfterAggregation: 4
        })
      ]);
    });

    it('should keep derived variables at their raw case count when aggregation is active', async () => {
      const codingIncompleteQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId: 'derived-var', responseCount: '4' }
      ]);
      const intendedIncompleteQb = createQueryBuilderMock([]);
      const deriveErrorQb = createQueryBuilderMock([]);
      const casesInJobsQb = createQueryBuilderMock([]);

      mockResponseRepository.createQueryBuilder = jest.fn()
        .mockReturnValueOnce(codingIncompleteQb)
        .mockReturnValueOnce(intendedIncompleteQb)
        .mockReturnValueOnce(deriveErrorQb);
      (mockCodingJobUnitRepository.createQueryBuilder as jest.Mock).mockReturnValue(casesInJobsQb);

      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(true);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['derived-var'])]])
      );
      mockWorkspaceFilesService.getDerivedVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['derived-var'])]])
      );
      mockWorkspaceFilesService.getCoderTrainingRequiredVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getDerivedVariablesBySourceMap.mockResolvedValue(new Map());
      mockCodingJobService.getAggregationThreshold.mockResolvedValue(2);
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([]);
      mockCodingJobService.getSlimResponsesForVariables.mockResolvedValue(
        createSlimResponses('unit1', 'derived-var', 4) as never
      );

      const result = await service.getCodingIncompleteVariables(1);

      expect(result).toEqual([
        expect.objectContaining({
          unitName: 'unit1',
          variableId: 'derived-var',
          responseCount: 4,
          availableCases: 4,
          uniqueCasesAfterAggregation: 4,
          isDerived: true
        })
      ]);
      expect(mockCodingJobService.getSlimResponsesForVariables).toHaveBeenCalledWith(
        1,
        [{ unitName: 'unit1', variableId: 'derived-var' }]
      );
    });

    it('should calculate availability on aggregation groups instead of raw job response counts', async () => {
      const codingIncompleteQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId: 'var1', responseCount: '6' }
      ]);
      const intendedIncompleteQb = createQueryBuilderMock([]);
      const deriveErrorQb = createQueryBuilderMock([]);
      const assignedResponsesQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId: 'var1', responseId: '1' },
        { unitName: 'unit1', variableId: 'var1', responseId: '2' },
        { unitName: 'unit1', variableId: 'var1', responseId: '3' },
        { unitName: 'unit1', variableId: 'var1', responseId: '5' }
      ]);

      mockResponseRepository.createQueryBuilder = jest.fn()
        .mockReturnValueOnce(codingIncompleteQb)
        .mockReturnValueOnce(intendedIncompleteQb)
        .mockReturnValueOnce(deriveErrorQb);
      (mockCodingJobUnitRepository.createQueryBuilder as jest.Mock)
        .mockReturnValueOnce(assignedResponsesQb);

      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(true);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['var1'])]])
      );
      mockWorkspaceFilesService.getDerivedVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getCoderTrainingRequiredVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getDerivedVariablesBySourceMap.mockResolvedValue(new Map());
      mockCodingJobService.getAggregationThreshold.mockResolvedValue(4);
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([]);
      mockCodingJobService.getSlimResponsesForVariables.mockResolvedValue([
        {
          id: 1, unitName: 'unit1', variableid: 'var1', value: 'same', personLogin: 'person-1'
        },
        {
          id: 2, unitName: 'unit1', variableid: 'var1', value: 'same', personLogin: 'person-2'
        },
        {
          id: 3, unitName: 'unit1', variableid: 'var1', value: 'same', personLogin: 'person-3'
        },
        {
          id: 4, unitName: 'unit1', variableid: 'var1', value: 'same', personLogin: 'person-4'
        },
        {
          id: 5, unitName: 'unit1', variableid: 'var1', value: 'single', personLogin: 'person-5'
        },
        {
          id: 6, unitName: 'unit1', variableid: 'var1', value: 'single', personLogin: 'person-6'
        }
      ] as never);

      const result = await service.getCodingIncompleteVariables(1);

      expect(result).toEqual([
        expect.objectContaining({
          unitName: 'unit1',
          variableId: 'var1',
          responseCount: 6,
          casesInJobs: 2,
          availableCases: 1,
          uniqueCasesAfterAggregation: 3
        })
      ]);
    });

    it('should keep an open sibling unavailable when its completed aggregation peer is assigned', async () => {
      const codingIncompleteQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId: 'var1', responseCount: '1' }
      ]);
      const intendedIncompleteQb = createQueryBuilderMock([]);
      const deriveErrorQb = createQueryBuilderMock([]);
      const assignedResponsesQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId: 'var1', responseId: '1' }
      ]);

      mockResponseRepository.createQueryBuilder = jest.fn()
        .mockReturnValueOnce(codingIncompleteQb)
        .mockReturnValueOnce(intendedIncompleteQb)
        .mockReturnValueOnce(deriveErrorQb);
      (mockCodingJobUnitRepository.createQueryBuilder as jest.Mock)
        .mockReturnValueOnce(assignedResponsesQb);
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(true);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['var1'])]])
      );
      mockWorkspaceFilesService.getDerivedVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getCoderTrainingRequiredVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getDerivedVariablesBySourceMap.mockResolvedValue(new Map());
      mockCodingJobService.getAggregationThreshold.mockResolvedValue(2);
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([
        ResponseMatchingFlag.IGNORE_CASE,
        ResponseMatchingFlag.IGNORE_WHITESPACE
      ]);
      mockCodingJobService.getSlimResponsesForVariableCoverage.mockResolvedValue([
        {
          id: 2,
          unitName: 'unit1',
          variableid: 'var1',
          value: 'Same answer',
          statusV2: null,
          personLogin: 'person-2'
        },
        {
          id: 1,
          unitName: 'UNIT1',
          variableid: 'var1',
          value: ' sameanswer ',
          statusV2: statusStringToNumber('CODING_COMPLETE'),
          personLogin: 'person-1'
        }
      ] as never);

      const result = await service.getCodingIncompleteVariables(1);

      expect(result).toEqual([
        expect.objectContaining({
          unitName: 'unit1',
          variableId: 'var1',
          casesInJobs: 1,
          availableCases: 0,
          uniqueCasesAfterAggregation: 1
        })
      ]);
      expect(assignedResponsesQb.andWhere).toHaveBeenCalledWith(
        'cju.response_id IN (:...responseIds)',
        { responseIds: [2, 1] }
      );
    });

    it('should treat assigned duplicate responses as assigned after deduplication and aggregation', async () => {
      const codingIncompleteQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId: 'var1', responseCount: '4' }
      ]);
      const intendedIncompleteQb = createQueryBuilderMock([]);
      const deriveErrorQb = createQueryBuilderMock([]);
      const assignedResponsesQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId: 'var1', responseId: '2' }
      ]);

      mockResponseRepository.createQueryBuilder = jest.fn()
        .mockReturnValueOnce(codingIncompleteQb)
        .mockReturnValueOnce(intendedIncompleteQb)
        .mockReturnValueOnce(deriveErrorQb);
      (mockCodingJobUnitRepository.createQueryBuilder as jest.Mock)
        .mockReturnValueOnce(assignedResponsesQb);

      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(true);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['var1'])]])
      );
      mockWorkspaceFilesService.getDerivedVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getCoderTrainingRequiredVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getDerivedVariablesBySourceMap.mockResolvedValue(new Map());
      mockCodingJobService.getAggregationThreshold.mockResolvedValue(2);
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([]);
      mockCodingJobService.getSlimResponsesForVariables.mockResolvedValue([
        {
          id: 1, unitName: 'unit1', variableid: 'var1', value: 'same-value', personLogin: 'person-1', personCode: 'code-1', personGroup: 'group'
        },
        {
          id: 2, unitName: 'unit1', variableid: 'var1', value: 'same-value', personLogin: 'person-1', personCode: 'code-1', personGroup: 'group'
        },
        {
          id: 3, unitName: 'unit1', variableid: 'var1', value: 'same-value', personLogin: 'person-2', personCode: 'code-2', personGroup: 'group'
        },
        {
          id: 4, unitName: 'unit1', variableid: 'var1', value: 'other-value', personLogin: 'person-3', personCode: 'code-3', personGroup: 'group'
        }
      ] as never);

      const result = await service.getCodingIncompleteVariables(1);

      expect(result).toEqual([
        expect.objectContaining({
          unitName: 'unit1',
          variableId: 'var1',
          responseCount: 4,
          casesInJobs: 1,
          availableCases: 1,
          uniqueCasesAfterAggregation: 2
        })
      ]);
    });

    it('should not deduplicate same-person responses from different booklets when counting availability', async () => {
      const codingIncompleteQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId: 'var1', responseCount: '3' }
      ]);
      const intendedIncompleteQb = createQueryBuilderMock([]);
      const deriveErrorQb = createQueryBuilderMock([]);
      const assignedResponsesQb = createQueryBuilderMock([]);

      mockResponseRepository.createQueryBuilder = jest.fn()
        .mockReturnValueOnce(codingIncompleteQb)
        .mockReturnValueOnce(intendedIncompleteQb)
        .mockReturnValueOnce(deriveErrorQb);
      (mockCodingJobUnitRepository.createQueryBuilder as jest.Mock)
        .mockReturnValueOnce(assignedResponsesQb);

      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(true);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['var1'])]])
      );
      mockWorkspaceFilesService.getDerivedVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getCoderTrainingRequiredVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getDerivedVariablesBySourceMap.mockResolvedValue(new Map());
      mockCodingJobService.getAggregationThreshold.mockResolvedValue(null);
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([]);
      mockCodingJobService.getSlimResponsesForVariables.mockResolvedValue([
        {
          id: 1, unitName: 'unit1', variableid: 'var1', value: 'same-value', personLogin: 'person-1', personCode: 'code-1', personGroup: 'group', bookletName: 'Booklet A'
        },
        {
          id: 2, unitName: 'unit1', variableid: 'var1', value: 'same-value', personLogin: 'person-1', personCode: 'code-1', personGroup: 'group', bookletName: 'Booklet A'
        },
        {
          id: 3, unitName: 'unit1', variableid: 'var1', value: 'same-value', personLogin: 'person-1', personCode: 'code-1', personGroup: 'group', bookletName: 'Booklet B'
        }
      ] as never);

      const result = await service.getCodingIncompleteVariables(1);

      expect(result).toEqual([
        expect.objectContaining({
          unitName: 'unit1',
          variableId: 'var1',
          responseCount: 3,
          casesInJobs: 0,
          availableCases: 2,
          uniqueCasesAfterAggregation: 2
        })
      ]);
    });

    it('should expose aggregation-aware case counts when DERIVE_ERROR is included', async () => {
      const codingIncompleteQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId: 'var1', responseCount: '2' }
      ]);
      const intendedIncompleteQb = createQueryBuilderMock([]);
      const deriveErrorQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId: 'var1', responseCount: '1' }
      ]);
      const casesInJobsQb = createQueryBuilderMock([]);
      const codingIncompleteStatus = statusStringToNumber('CODING_INCOMPLETE');
      const deriveErrorStatus = statusStringToNumber('DERIVE_ERROR');

      mockResponseRepository.createQueryBuilder = jest.fn()
        .mockReturnValueOnce(codingIncompleteQb)
        .mockReturnValueOnce(intendedIncompleteQb)
        .mockReturnValueOnce(deriveErrorQb);
      (mockCodingJobUnitRepository.createQueryBuilder as jest.Mock)
        .mockReturnValue(casesInJobsQb);

      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(true);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['var1'])]])
      );
      mockWorkspaceFilesService.getDerivedVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getCoderTrainingRequiredVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getDerivedVariablesBySourceMap.mockResolvedValue(new Map());
      mockCodingJobService.getAggregationThreshold.mockResolvedValue(2);
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([]);
      mockCodingJobService.getSlimResponsesForVariables.mockResolvedValue([
        {
          id: 1, unitName: 'unit1', variableid: 'var1', value: 'same', statusV1: codingIncompleteStatus
        },
        {
          id: 2, unitName: 'unit1', variableid: 'var1', value: 'same', statusV1: codingIncompleteStatus
        },
        {
          id: 3, unitName: 'unit1', variableid: 'var1', value: 'same', statusV1: deriveErrorStatus
        }
      ] as never);

      const result = await service.getCodingIncompleteVariables(
        1,
        undefined,
        undefined,
        true
      );

      expect(mockCodingJobService.getSlimResponsesForVariables).toHaveBeenCalledWith(
        1,
        [{ unitName: 'unit1', variableId: 'var1', includeDeriveError: true }]
      );
      expect(result).toEqual([
        expect.objectContaining({
          unitName: 'unit1',
          variableId: 'var1',
          responseCount: 2,
          deriveErrorResponseCount: 1,
          uniqueCasesAfterAggregation: 1,
          uniqueCasesAfterAggregationWithDeriveError: 1
        })
      ]);
    });

    it('should exclude DERIVE_ERROR-only source variables covered by derived variables with manual instructions', async () => {
      const codingIncompleteQb = createQueryBuilderMock([]);
      const intendedIncompleteQb = createQueryBuilderMock([]);
      const deriveErrorQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId: 'source-var', responseCount: '2' },
        { unitName: 'unit1', variableId: 'derived-var', responseCount: '2' }
      ]);
      const assignedResponsesQb = createQueryBuilderMock([]);
      const deriveErrorStatus = statusStringToNumber('DERIVE_ERROR');

      mockResponseRepository.createQueryBuilder = jest.fn()
        .mockReturnValueOnce(codingIncompleteQb)
        .mockReturnValueOnce(intendedIncompleteQb)
        .mockReturnValueOnce(deriveErrorQb);
      (mockCodingJobUnitRepository.createQueryBuilder as jest.Mock)
        .mockReturnValueOnce(assignedResponsesQb);

      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(true);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['source-var', 'derived-var'])]])
      );
      mockWorkspaceFilesService.getDerivedVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['derived-var'])]])
      );
      mockWorkspaceFilesService.getCoderTrainingRequiredVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getDerivedVariablesBySourceMap.mockResolvedValue(
        new Map([
          [getManualCodingScopeKey('unit1', 'source-var'), new Set(['derived-var'])]
        ])
      );
      mockWorkspaceFilesService.getManualInstructionVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['derived-var'])]])
      );
      mockCodingJobService.getAggregationThreshold.mockResolvedValue(null);
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([]);
      mockCodingJobService.getSlimResponsesForVariables.mockResolvedValue(
        createSlimResponses(
          'unit1',
          'derived-var',
          2,
          { statusV1: deriveErrorStatus }
        ) as never
      );

      const result = await service.getCodingIncompleteVariables(
        1,
        undefined,
        undefined,
        true
      );

      expect(result.map(variable => variable.variableId)).toEqual(['derived-var']);
      expect(mockCodingJobService.getSlimResponsesForVariables).toHaveBeenCalledWith(
        1,
        [{ unitName: 'unit1', variableId: 'derived-var', includeDeriveError: true }]
      );
    });

    it('should suppress DERIVE_ERROR counts for covered source variables that remain regular candidates', async () => {
      const codingIncompleteQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId: 'source-var', responseCount: '1' },
        { unitName: 'unit1', variableId: 'derived-var', responseCount: '1' }
      ]);
      const intendedIncompleteQb = createQueryBuilderMock([]);
      const deriveErrorQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId: 'source-var', responseCount: '2' },
        { unitName: 'unit1', variableId: 'derived-var', responseCount: '2' }
      ]);
      const assignedResponsesQb = createQueryBuilderMock([]);
      const codingIncompleteStatus = statusStringToNumber('CODING_INCOMPLETE');
      const deriveErrorStatus = statusStringToNumber('DERIVE_ERROR');

      mockResponseRepository.createQueryBuilder = jest.fn()
        .mockReturnValueOnce(codingIncompleteQb)
        .mockReturnValueOnce(intendedIncompleteQb)
        .mockReturnValueOnce(deriveErrorQb);
      (mockCodingJobUnitRepository.createQueryBuilder as jest.Mock)
        .mockReturnValueOnce(assignedResponsesQb);

      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(true);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['source-var', 'derived-var'])]])
      );
      mockWorkspaceFilesService.getDerivedVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['derived-var'])]])
      );
      mockWorkspaceFilesService.getCoderTrainingRequiredVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getDerivedVariablesBySourceMap.mockResolvedValue(
        new Map([
          [getManualCodingScopeKey('unit1', 'source-var'), new Set(['derived-var'])]
        ])
      );
      mockWorkspaceFilesService.getManualInstructionVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['derived-var'])]])
      );
      mockCodingJobService.getAggregationThreshold.mockResolvedValue(null);
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([]);
      mockCodingJobService.getSlimResponsesForVariables.mockResolvedValue([
        ...createSlimResponses(
          'unit1',
          'source-var',
          1,
          { statusV1: codingIncompleteStatus }
        ),
        ...createSlimResponses(
          'unit1',
          'derived-var',
          1,
          { statusV1: codingIncompleteStatus }
        ),
        ...createSlimResponses(
          'unit1',
          'derived-var',
          2,
          { statusV1: deriveErrorStatus }
        ).map((response, index) => ({ ...response, id: index + 10 }))
      ] as never);

      const result = await service.getCodingIncompleteVariables(
        1,
        undefined,
        undefined,
        true
      );

      expect(result).toEqual([
        expect.objectContaining({
          variableId: 'source-var',
          deriveErrorResponseCount: 0
        }),
        expect.objectContaining({
          variableId: 'derived-var',
          deriveErrorResponseCount: 2
        })
      ]);
      expect(mockCodingJobService.getSlimResponsesForVariables).toHaveBeenCalledWith(
        1,
        [
          { unitName: 'unit1', variableId: 'source-var' },
          { unitName: 'unit1', variableId: 'derived-var', includeDeriveError: true }
        ]
      );
    });

    it('should apply training deduplication when DERIVE_ERROR case counts are requested without aggregation', async () => {
      const codingIncompleteQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId: 'var1', responseCount: '3' }
      ]);
      const intendedIncompleteQb = createQueryBuilderMock([]);
      const deriveErrorQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId: 'var1', responseCount: '1' }
      ]);
      const casesInJobsQb = createQueryBuilderMock([]);
      const assignedResponsesQb = createQueryBuilderMock([]);
      const codingIncompleteStatus = statusStringToNumber('CODING_INCOMPLETE');
      const deriveErrorStatus = statusStringToNumber('DERIVE_ERROR');

      mockResponseRepository.createQueryBuilder = jest.fn()
        .mockReturnValueOnce(codingIncompleteQb)
        .mockReturnValueOnce(intendedIncompleteQb)
        .mockReturnValueOnce(deriveErrorQb);
      (mockCodingJobUnitRepository.createQueryBuilder as jest.Mock)
        .mockReturnValueOnce(casesInJobsQb)
        .mockReturnValueOnce(assignedResponsesQb);

      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(true);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set(['var1'])]])
      );
      mockWorkspaceFilesService.getDerivedVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getCoderTrainingRequiredVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getDerivedVariablesBySourceMap.mockResolvedValue(new Map());
      mockCodingJobService.getAggregationThreshold.mockResolvedValue(null);
      mockCodingJobService.getResponseMatchingMode.mockResolvedValue([]);
      mockCodingJobService.getSlimResponsesForVariables.mockResolvedValue([
        {
          id: 1, unitName: 'unit1', variableid: 'var1', value: 'same', statusV1: codingIncompleteStatus, personLogin: 'person', personCode: 'code', personGroup: 'group'
        },
        {
          id: 2, unitName: 'unit1', variableid: 'var1', value: 'same', statusV1: codingIncompleteStatus, personLogin: 'person', personCode: 'code', personGroup: 'group'
        },
        {
          id: 3, unitName: 'unit1', variableid: 'var1', value: 'other', statusV1: codingIncompleteStatus, personLogin: 'person', personCode: 'code', personGroup: 'group'
        },
        {
          id: 4, unitName: 'unit1', variableid: 'var1', value: 'other', statusV1: deriveErrorStatus, personLogin: 'person', personCode: 'code', personGroup: 'group'
        }
      ] as never);

      const result = await service.getCodingIncompleteVariables(
        1,
        undefined,
        undefined,
        true
      );

      expect(result).toEqual([
        expect.objectContaining({
          unitName: 'unit1',
          variableId: 'var1',
          responseCount: 3,
          deriveErrorResponseCount: 1,
          uniqueCasesAfterAggregation: 2,
          uniqueCasesAfterAggregationWithDeriveError: 2
        })
      ]);
    });

    it.skip('should fetch from database on cache miss', async () => {
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

    it.skip('should filter variables by unit name when specified', async () => {
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

    it.skip('should filter out invalid variables not in unit variable map', async () => {
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
        'Could not get manual coding variables'
      );
    });
  });

  describe('validateManualCodeAvailability', () => {
    const mockManualScopeQueries = (
      variableId = 'var1'
    ): void => {
      const codingIncompleteQb = createQueryBuilderMock([
        { unitName: 'unit1', variableId, responseCount: '5' }
      ]);
      const intendedIncompleteQb = createQueryBuilderMock([]);
      const deriveErrorQb = createQueryBuilderMock([]);
      const casesInJobsQb = createQueryBuilderMock([]);

      mockResponseRepository.createQueryBuilder = jest.fn()
        .mockReturnValueOnce(codingIncompleteQb)
        .mockReturnValueOnce(intendedIncompleteQb)
        .mockReturnValueOnce(deriveErrorQb);
      (mockCodingJobUnitRepository.createQueryBuilder as jest.Mock)
        .mockReturnValue(casesInJobsQb);

      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(true);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['UNIT1', new Set([variableId])]])
      );
      mockWorkspaceFilesService.getDerivedVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getCoderTrainingRequiredVariableMap.mockResolvedValue(new Map());
      mockWorkspaceFilesService.getDerivedVariablesBySourceMap.mockResolvedValue(new Map());
      mockCodingJobService.getAggregationThreshold.mockResolvedValue(null);
      mockCodingJobService.getSlimResponsesForVariables.mockResolvedValue(
        createSlimResponses('unit1', variableId, 5) as never
      );
    };

    it('should warn when a manual variable has no selectable regular codes', async () => {
      mockManualScopeQueries();
      mockWorkspaceFilesService.getUnitVariableDetails.mockResolvedValue([
        {
          unitName: 'unit1',
          unitId: 'unit1',
          variables: [
            {
              id: 'var1',
              alias: 'var1',
              type: 'string',
              hasCodingScheme: true,
              codes: [
                {
                  id: 1,
                  label: 'Auto',
                  manualInstruction: ''
                },
                {
                  id: 2,
                  label: 'Whitespace',
                  manualInstruction: '   '
                },
                {
                  id: 3,
                  label: 'Visually empty HTML',
                  manualInstruction: '<p style="margin-top: 0; min-height: 1em"></p>'
                }
              ]
            }
          ]
        }
      ]);

      const result = await service.validateManualCodeAvailability(1);

      expect(result).toEqual({
        checkedVariables: 1,
        warningCount: 1,
        warnings: [
          expect.objectContaining({
            unitName: 'unit1',
            variableId: 'var1',
            responseCount: 5,
            casesInJobs: 0,
            availableCases: 5,
            uniqueCasesAfterAggregation: 5,
            regularCodeCount: 3,
            selectableRegularCodeCount: 0,
            onlySpecialOptionsAvailable: true
          })
        ]
      });
    });

    it('should not warn when at least one regular code has a manual instruction', async () => {
      mockManualScopeQueries();
      mockWorkspaceFilesService.getUnitVariableDetails.mockResolvedValue([
        {
          unitName: 'unit1',
          unitId: 'unit1',
          variables: [
            {
              id: 'coding-var',
              alias: 'var1',
              type: 'string',
              hasCodingScheme: true,
              codes: [
                {
                  id: 1,
                  label: 'Hidden',
                  manualInstruction: ''
                },
                {
                  id: 2,
                  label: 'Manual',
                  manualInstruction: '<p>Manuell auswählbar</p>'
                }
              ]
            }
          ]
        }
      ]);

      const result = await service.validateManualCodeAvailability(1);

      expect(result).toEqual({
        checkedVariables: 1,
        warningCount: 0,
        warnings: []
      });
    });

    it('should match manual code availability by alias when ids collide with aliases', async () => {
      mockManualScopeQueries('04');
      mockWorkspaceFilesService.getUnitVariableDetails.mockResolvedValue([
        {
          unitName: 'unit1',
          unitId: 'unit1',
          variables: [
            {
              id: '04',
              alias: '02',
              type: 'string',
              hasCodingScheme: true,
              codes: [
                {
                  id: 1,
                  label: 'Only special',
                  manualInstruction: ''
                }
              ]
            },
            {
              id: '07',
              alias: '04',
              type: 'string',
              hasCodingScheme: true,
              codes: [
                {
                  id: 2,
                  label: 'Manual',
                  manualInstruction: '<p>Manuell auswählbar</p>'
                }
              ]
            }
          ]
        }
      ]);

      const result = await service.validateManualCodeAvailability(1);

      expect(result).toEqual({
        checkedVariables: 1,
        warningCount: 0,
        warnings: []
      });
    });

    it('should reuse an in-flight validation for identical manual code availability requests', async () => {
      mockCacheService.get.mockImplementation(async key => (
        key === 'coding_incomplete_variables_v9:1' ?
          [
            {
              unitName: 'unit1',
              variableId: 'var1',
              responseCount: 5,
              deriveErrorResponseCount: 0,
              casesInJobs: 0,
              availableCases: 5,
              uniqueCasesAfterAggregation: 5,
              isDerived: false,
              coderTrainingRequired: false
            }
          ] :
          null
      ));
      let resolveDetails!: (details: unknown[]) => void;
      const detailsPromise = new Promise<unknown[]>(resolve => {
        resolveDetails = resolve;
      });
      mockWorkspaceFilesService.getUnitVariableDetails
        .mockReturnValue(detailsPromise as never);

      const first = service.validateManualCodeAvailability(1);
      const second = service.validateManualCodeAvailability(1);
      resolveDetails([
        {
          unitName: 'unit1',
          unitId: 'unit1',
          variables: [
            {
              id: 'var1',
              alias: 'var1',
              type: 'string',
              hasCodingScheme: true,
              codes: [
                {
                  id: 1,
                  label: 'Manual',
                  manualInstruction: '<p>Manuell auswählbar</p>'
                }
              ]
            }
          ]
        }
      ]);

      const [firstResult, secondResult] = await Promise.all([first, second]);

      expect(firstResult).toEqual(secondResult);
      expect(mockWorkspaceFilesService.getUnitVariableDetails)
        .toHaveBeenCalledTimes(1);
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

      expect(cacheKey).toBe('coding_incomplete_variables_v9:123');
    });
  });

  describe('invalidateIncompleteVariablesCache', () => {
    it('should increment version and delete cache keys for workspace', async () => {
      mockCacheService.delete.mockResolvedValue(true);

      await service.invalidateIncompleteVariablesCache(1);

      expect(mockCacheService.incr).toHaveBeenCalledWith(
        'coding_incomplete_variables_version:1'
      );
      expect(mockCacheService.delete).toHaveBeenCalledWith(
        'coding_incomplete_variables_v9:1'
      );
      expect(mockCacheService.delete).toHaveBeenCalledWith(
        'coding_incomplete_variables_scope_v2:1'
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

      mockQueryBuilder.getCount.mockResolvedValueOnce(10);

      const result = await service.getAppliedResultsCount(
        1,
        incompleteVariables
      );

      expect(result).toBe(10);
      expect(mockResponseRepository.createQueryBuilder).toHaveBeenCalledWith(
        'response'
      );
      expect(mockQueryBuilder.getCount).toHaveBeenCalled();
    });

    it('should match applied-result unit names case-insensitively', async () => {
      mockQueryBuilder.getCount.mockResolvedValueOnce(1);

      await service.getAppliedResultsCount(1, [
        { unitName: 'UNIT_A', variableId: 'VAR' }
      ]);

      const bracketCalls = mockQueryBuilder.andWhere.mock.calls
        .filter(([condition]) => condition instanceof Brackets);
      const variableFilter = bracketCalls[bracketCalls.length - 1]?.[0] as Brackets;
      const bracketBuilder = {
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis()
      };
      variableFilter.whereFactory(bracketBuilder as never);

      expect(bracketBuilder.where).toHaveBeenCalledWith(
        '(UPPER(unit.name) = UPPER(:appliedUnitName0) AND response.variableid = :appliedVariableId0)',
        {
          appliedUnitName0: 'UNIT_A',
          appliedVariableId0: 'VAR'
        }
      );
    });

    it('should count applied DERIVE_ERROR job variables even without incomplete variables', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValueOnce([
        { unitName: 'unitDerive', variableId: 'varDerive' }
      ]);
      mockQueryBuilder.getCount.mockResolvedValueOnce(1);

      const result = await service.getAppliedResultsCount(1, []);

      expect(result).toBe(1);
      expect(mockResponseRepository.createQueryBuilder).toHaveBeenCalledWith(
        'response'
      );
      expect(mockQueryBuilder.getCount).toHaveBeenCalledTimes(1);
    });

    it('should treat invalid incomplete variable payloads as empty', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValueOnce([
        { unitName: 'unitDerive', variableId: 'varDerive' }
      ]);
      mockQueryBuilder.getCount.mockResolvedValueOnce(1);

      const result = await service.getAppliedResultsCount(1, undefined as never);

      expect(result).toBe(1);
      expect(mockQueryBuilder.getCount).toHaveBeenCalledTimes(1);
    });

    it('should process variables in batches', async () => {
      const incompleteVariables = Array.from({ length: 100 }, (_, i) => ({
        unitName: `unit${i}`,
        variableId: `var${i}`
      }));

      mockQueryBuilder.getCount.mockResolvedValue(1);

      await service.getAppliedResultsCount(1, incompleteVariables);

      expect(mockResponseRepository.createQueryBuilder).toHaveBeenCalledTimes(2);
      expect(mockQueryBuilder.getCount).toHaveBeenCalledTimes(2);
    });

    it('should handle database errors', async () => {
      const incompleteVariables = [{ unitName: 'unit1', variableId: 'var1' }];

      mockQueryBuilder.getCount.mockRejectedValue(new Error('Query failed'));

      await expect(
        service.getAppliedResultsCount(1, incompleteVariables)
      ).rejects.toThrow('Could not get applied results count');
    });
  });
});
