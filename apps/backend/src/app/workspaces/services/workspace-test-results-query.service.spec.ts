import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkspaceTestResultsQueryService } from './workspace-test-results-query.service';
import { Persons, Unit, ResponseEntity } from '../../common';
import { Booklet } from '../entities/booklet.entity';
import { BookletLog } from '../entities/bookletLog.entity';
import { UnitLog } from '../entities/unitLog.entity';
import { Session } from '../entities/session.entity';
import { UnitTagService } from './unit-tag.service';
import { JournalService } from './journal.service';

describe('WorkspaceTestResultsQueryService', () => {
  let service: WorkspaceTestResultsQueryService;
  let personsRepository: jest.Mocked<Repository<Persons>>;
  let unitRepository: jest.Mocked<Repository<Unit>>;
  let bookletRepository: jest.Mocked<Repository<Booklet>>;
  let responseRepository: jest.Mocked<Repository<ResponseEntity>>;
  let bookletLogRepository: jest.Mocked<Repository<BookletLog>>;
  let unitTagService: jest.Mocked<UnitTagService>;

  const createMockQueryBuilder = (mockData: unknown[] = []) => ({
    select: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(mockData),
    getManyAndCount: jest.fn().mockResolvedValue([mockData, mockData.length])
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceTestResultsQueryService,
        {
          provide: getRepositoryToken(Persons),
          useValue: {
            createQueryBuilder: jest.fn()
          }
        },
        {
          provide: getRepositoryToken(Unit),
          useValue: {
            createQueryBuilder: jest.fn()
          }
        },
        {
          provide: getRepositoryToken(Booklet),
          useValue: {
            createQueryBuilder: jest.fn()
          }
        },
        {
          provide: getRepositoryToken(ResponseEntity),
          useValue: {
            find: jest.fn(),
            findAndCount: jest.fn()
          }
        },
        {
          provide: getRepositoryToken(BookletLog),
          useValue: {
            createQueryBuilder: jest.fn()
          }
        },
        {
          provide: getRepositoryToken(UnitLog),
          useValue: {
            createQueryBuilder: jest.fn()
          }
        },
        {
          provide: getRepositoryToken(Session),
          useValue: {
            createQueryBuilder: jest.fn()
          }
        },
        {
          provide: UnitTagService,
          useValue: {
            findAllByUnitIds: jest.fn()
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

    service = module.get<WorkspaceTestResultsQueryService>(
      WorkspaceTestResultsQueryService
    );
    personsRepository = module.get(getRepositoryToken(Persons));
    unitRepository = module.get(getRepositoryToken(Unit));
    bookletRepository = module.get(getRepositoryToken(Booklet));
    responseRepository = module.get(getRepositoryToken(ResponseEntity));
    bookletLogRepository = module.get(getRepositoryToken(BookletLog));
    unitTagService = module.get(UnitTagService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findPersonTestResults', () => {
    it('should return comprehensive person test results', async () => {
      const personId = 1;
      const workspaceId = 1;

      const mockBooklets = [
        {
          id: 1,
          bookletinfo: { name: 'Test Booklet' }
        }
      ];

      const mockUnits = [
        {
          id: 1,
          name: 'Unit1',
          alias: 'U1',
          bookletid: 1,
          responses: [
            {
              id: 1,
              unitid: 1,
              variableid: 'var1',
              status: 1,
              value: 'test',
              subform: '',
              code_v1: 1,
              score_v1: 10,
              status_v1: 1
            }
          ]
        }
      ];

      const mockLogs = [
        {
          id: 1,
          bookletid: 1,
          ts: new Date('2024-01-01'),
          key: 'test',
          parameter: 'param'
        }
      ];

      const mockTags = [
        {
          id: 1,
          unitId: 1,
          tag: 'important',
          color: 'red',
          createdAt: new Date()
        }
      ];

      bookletRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(createMockQueryBuilder(mockBooklets));

      unitRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(createMockQueryBuilder(mockUnits));

      bookletLogRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(createMockQueryBuilder(mockLogs));

      unitTagService.findAllByUnitIds.mockResolvedValue(mockTags);

      const result = await service.findPersonTestResults(personId, workspaceId);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 1,
        name: 'Test Booklet',
        logs: expect.any(Array),
        units: expect.arrayContaining([
          expect.objectContaining({
            id: 1,
            name: 'Unit1',
            alias: 'U1',
            results: expect.any(Array),
            tags: expect.any(Array)
          })
        ])
      });
    });

    it('should return empty array when no booklets found', async () => {
      bookletRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(createMockQueryBuilder([]));

      const result = await service.findPersonTestResults(1, 1);

      expect(result).toEqual([]);
    });

    it('should throw error when personId or workspaceId is missing', async () => {
      await expect(service.findPersonTestResults(0, 1)).rejects.toThrow(
        'Both personId and workspaceId are required.'
      );

      await expect(service.findPersonTestResults(1, 0)).rejects.toThrow(
        'Both personId and workspaceId are required.'
      );
    });
  });

  describe('findTestResults', () => {
    it('should return paginated test results', async () => {
      const mockPersons = [
        {
          id: 1,
          group: 'A',
          login: 'user1',
          code: 'code1',
          uploaded_at: new Date()
        }
      ];

      personsRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(createMockQueryBuilder(mockPersons));

      const result = await service.findTestResults(1, {
        page: 1,
        limit: 10
      });

      expect(result).toEqual([mockPersons, mockPersons.length]);
    });

    it('should apply search filter when provided', async () => {
      const mockQueryBuilder = createMockQueryBuilder([]);
      personsRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockQueryBuilder);

      await service.findTestResults(1, {
        page: 1,
        limit: 10,
        searchText: 'test'
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('ILIKE'),
        expect.objectContaining({ searchText: '%test%' })
      );
    });

    it('should enforce maximum limit', async () => {
      const mockQueryBuilder = createMockQueryBuilder([]);
      personsRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockQueryBuilder);

      await service.findTestResults(1, {
        page: 1,
        limit: 1000 // Exceeds MAX_LIMIT
      });

      expect(mockQueryBuilder.take).toHaveBeenCalledWith(500); // MAX_LIMIT
    });

    it('should throw error for invalid workspace_id', async () => {
      await expect(
        service.findTestResults(0, { page: 1, limit: 10 })
      ).rejects.toThrow('Invalid workspace_id provided');
    });
  });

  describe('findWorkspaceResponses', () => {
    it('should return paginated responses when options provided', async () => {
      const mockResponses = [
        {
          id: 1,
          unitid: 1,
          variableid: 'var1',
          status: 1,
          value: 'test',
          subform: '',
          code_v1: null,
          score_v1: null,
          status_v1: 1,
          code_v2: null,
          score_v2: null,
          status_v2: null,
          code_v3: null,
          score_v3: null,
          status_v3: null,
          unit: {} as Unit
        },
        {
          id: 2,
          unitid: 1,
          variableid: 'var2',
          status: 1,
          value: 'test2',
          subform: '',
          code_v1: null,
          score_v1: null,
          status_v1: 1,
          code_v2: null,
          score_v2: null,
          status_v2: null,
          code_v3: null,
          score_v3: null,
          status_v3: null,
          unit: {} as Unit
        }
      ];

      responseRepository.findAndCount.mockResolvedValue([
        mockResponses,
        mockResponses.length
      ]);

      const result = await service.findWorkspaceResponses(1, {
        page: 1,
        limit: 10
      });

      expect(result).toEqual([mockResponses, mockResponses.length]);
      expect(responseRepository.findAndCount).toHaveBeenCalledWith({
        skip: 0,
        take: 10,
        order: { id: 'ASC' }
      });
    });

    it('should return all responses when no options provided', async () => {
      const mockResponses = [
        {
          id: 1,
          unitid: 1,
          variableid: 'var1',
          status: 1,
          value: 'test',
          subform: '',
          code_v1: null,
          score_v1: null,
          status_v1: 1,
          code_v2: null,
          score_v2: null,
          status_v2: null,
          code_v3: null,
          score_v3: null,
          status_v3: null,
          unit: {} as Unit
        },
        {
          id: 2,
          unitid: 1,
          variableid: 'var2',
          status: 1,
          value: 'test2',
          subform: '',
          code_v1: null,
          score_v1: null,
          status_v1: 1,
          code_v2: null,
          score_v2: null,
          status_v2: null,
          code_v3: null,
          score_v3: null,
          status_v3: null,
          unit: {} as Unit
        }
      ];

      responseRepository.find.mockResolvedValue(mockResponses);

      const result = await service.findWorkspaceResponses(1);

      expect(result).toEqual([mockResponses, mockResponses.length]);
      expect(responseRepository.find).toHaveBeenCalledWith({
        order: { id: 'ASC' }
      });
    });

    it('should enforce maximum limit', async () => {
      responseRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.findWorkspaceResponses(1, {
        page: 1,
        limit: 1000
      });

      expect(responseRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 500 // MAX_LIMIT
        })
      );
    });
  });
});
