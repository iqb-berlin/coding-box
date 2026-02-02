import { Repository, DataSource } from 'typeorm';
import { PassThrough } from 'stream';
import { WorkspaceTestResultsService } from './workspace-test-results.service';
import { ResponseManagementService } from './response-management.service';
import Persons from '../../entities/persons.entity';
import { Unit } from '../../entities/unit.entity';
import { Booklet } from '../../entities/booklet.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { BookletInfo } from '../../entities/bookletInfo.entity';
import { BookletLog } from '../../entities/bookletLog.entity';
import { Session } from '../../entities/session.entity';
import { UnitLog } from '../../entities/unitLog.entity';
import { ChunkEntity } from '../../entities/chunk.entity';
import { UnitTagService } from '../workspace/unit-tag.service';
import { JournalService } from '../shared';
import { CacheService } from '../../../cache/cache.service';
import { CodingListService } from '../coding/coding-list.service';
import { WorkspaceCoreService } from '../workspace/workspace-core.service';

const mockQueryBuilder = () => ({
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  innerJoinAndSelect: jest.fn().mockReturnThis(),
  leftJoin: jest.fn().mockReturnThis(),
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  getRawMany: jest.fn().mockResolvedValue([]),
  getCount: jest.fn().mockResolvedValue(0),
  getMany: jest.fn().mockResolvedValue([]),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn(),
  stream: jest.fn(),
  getRawOne: jest.fn().mockResolvedValue({}),
  clone: jest.fn().mockReturnThis(),
  setParameter: jest.fn().mockReturnThis(),
  addGroupBy: jest.fn().mockReturnThis(),
  addOrderBy: jest.fn().mockReturnThis(),
  offset: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  distinct: jest.fn().mockReturnThis()
});

describe('WorkspaceTestResultsService', () => {
  let service: WorkspaceTestResultsService;
  let responseManagementService: ResponseManagementService;
  let workspaceCoreService: WorkspaceCoreService;
  let unitTagService: UnitTagService;
  let personsRepository: Repository<Persons>;
  let unitRepository: Repository<Unit>;
  let bookletRepository: Repository<Booklet>;
  let responseRepository: Repository<ResponseEntity>;
  let sessionRepository: Repository<Session>;
  let bookletLogRepository: Repository<BookletLog>;
  let chunkRepository: Repository<ChunkEntity>;
  let dataSource: DataSource;

  beforeEach(() => {
    responseManagementService = {
      resolveDuplicateResponses: jest.fn().mockResolvedValue({ resolvedCount: 1, success: true }),
      deleteResponse: jest.fn(),
      updateResponsesInDatabase: jest.fn()
    } as unknown as ResponseManagementService;

    workspaceCoreService = {
      getIgnoredUnits: jest.fn().mockResolvedValue([])
    } as unknown as WorkspaceCoreService;

    unitTagService = {
      findAllByUnitIds: jest.fn().mockResolvedValue([])
    } as unknown as UnitTagService;

    personsRepository = {
      count: jest.fn(),
      createQueryBuilder: jest.fn(() => mockQueryBuilder())
    } as unknown as Repository<Persons>;

    unitRepository = {
      createQueryBuilder: jest.fn(() => mockQueryBuilder())
    } as unknown as Repository<Unit>;

    bookletRepository = {
      createQueryBuilder: jest.fn(() => mockQueryBuilder())
    } as unknown as Repository<Booklet>;

    responseRepository = {
      createQueryBuilder: jest.fn(() => mockQueryBuilder()),
      findAndCount: jest.fn()
    } as unknown as Repository<ResponseEntity>;

    sessionRepository = {
      createQueryBuilder: jest.fn(() => mockQueryBuilder())
    } as unknown as Repository<Session>;

    bookletLogRepository = {
      createQueryBuilder: jest.fn(() => mockQueryBuilder())
    } as unknown as Repository<BookletLog>;

    chunkRepository = {
      createQueryBuilder: jest.fn(() => mockQueryBuilder())
    } as unknown as Repository<ChunkEntity>;

    dataSource = {
      getRepository: jest.fn().mockReturnValue({
        createQueryBuilder: jest.fn(() => mockQueryBuilder())
      })
    } as unknown as DataSource;

    service = new WorkspaceTestResultsService(
      personsRepository,
      unitRepository,
      bookletRepository,
      responseRepository,
      {} as unknown as Repository<BookletInfo>,
      bookletLogRepository,
      sessionRepository,
      {} as unknown as Repository<UnitLog>,
      chunkRepository,
      dataSource,
      unitTagService,
      {} as unknown as JournalService,
      {} as unknown as CacheService,
      {} as unknown as CodingListService,
      responseManagementService,
      workspaceCoreService
    );
  });

  describe('resolveDuplicateResponses', () => {
    it('should delegate to ResponseManagementService', async () => {
      const workspaceId = 1;
      const resolutionMap = { key: 123 };
      const userId = 'user-1';

      const result = await service.resolveDuplicateResponses(workspaceId, resolutionMap, userId);

      expect(responseManagementService.resolveDuplicateResponses).toHaveBeenCalledWith(workspaceId, resolutionMap, userId);
      expect(result).toEqual({ resolvedCount: 1, success: true });
    });
  });

  describe('getWorkspaceTestResultsOverview', () => {
    it('should return correct statistics', async () => {
      const workspaceId = 1;

      (personsRepository.count as jest.Mock).mockResolvedValue(10);

      const personQb = mockQueryBuilder();
      (personsRepository.createQueryBuilder as jest.Mock).mockReturnValue(personQb);
      personQb.getRawMany.mockResolvedValue([{ group: 'group1' }, { group: 'group2' }]);

      const bookletQb = mockQueryBuilder();
      (bookletRepository.createQueryBuilder as jest.Mock).mockReturnValue(bookletQb);
      bookletQb.getRawMany.mockResolvedValue([{ name: 'booklet1' }]);

      const unitQb = mockQueryBuilder();
      (unitRepository.createQueryBuilder as jest.Mock).mockReturnValue(unitQb);
      unitQb.getRawMany.mockResolvedValue(['unit1', 'unit2']);

      const responseCountQb = mockQueryBuilder();
      const responseStatusQb = mockQueryBuilder();
      (responseRepository.createQueryBuilder as jest.Mock)
        .mockReturnValueOnce(responseCountQb)
        .mockReturnValueOnce(responseStatusQb);
      responseCountQb.getCount.mockResolvedValue(100);
      responseStatusQb.getRawMany.mockResolvedValue([
        { status: '0', count: '5' },
        { status: '1', count: '10' }
      ]);

      const sessionBrowserQb = mockQueryBuilder();
      const sessionOsQb = mockQueryBuilder();
      const sessionScreenQb = mockQueryBuilder();
      (sessionRepository.createQueryBuilder as jest.Mock)
        .mockReturnValueOnce(sessionBrowserQb)
        .mockReturnValueOnce(sessionOsQb)
        .mockReturnValueOnce(sessionScreenQb);

      sessionBrowserQb.getRawMany.mockResolvedValue([{ value: 'Chrome', count: 20 }]);
      sessionOsQb.getRawMany.mockResolvedValue([{ value: 'Windows', count: 20 }]);
      sessionScreenQb.getRawMany.mockResolvedValue([{ value: '1920x1080', count: 20 }]);

      const result = await service.getWorkspaceTestResultsOverview(workspaceId);

      expect(result.testPersons).toBe(10);
      expect(result.testGroups).toBe(2);
      expect(result.uniqueBooklets).toBe(1); // 1 booklet row mock
      expect(result.uniqueUnits).toBe(2);
      expect(result.uniqueResponses).toBe(100);
      expect(result.responseStatusCounts).toEqual({ UNSET: 5, NOT_REACHED: 10 });
      expect(result.sessionBrowserCounts).toEqual({ Chrome: 20 });
    });

    it('should handle ignored units correctly', async () => {
      const workspaceId = 1;

      (workspaceCoreService.getIgnoredUnits as jest.Mock).mockResolvedValue(['unit1.xml']);
      (personsRepository.count as jest.Mock).mockResolvedValue(5);

      // default mocks for the rest to avoid errors
      const qb = mockQueryBuilder();
      qb.getRawMany.mockResolvedValue([]);
      qb.getCount.mockResolvedValue(0);
      (personsRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);
      (bookletRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      // Mock specific unit query for inspection
      const unitQb = mockQueryBuilder();
      (unitRepository.createQueryBuilder as jest.Mock).mockReturnValue(unitQb);
      unitQb.getRawMany.mockResolvedValue([]);

      // Mock response qb for inspection
      const responseQb = mockQueryBuilder();
      (responseRepository.createQueryBuilder as jest.Mock).mockReturnValue(responseQb);
      responseQb.getCount.mockResolvedValue(0);
      responseQb.getRawMany.mockResolvedValue([]);

      (sessionRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await service.getWorkspaceTestResultsOverview(workspaceId);

      expect(unitQb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('UPPER(unit.name) NOT IN'),
        expect.objectContaining({ ignoredUnits: ['UNIT1'] }) // .XML stripped and uppercase
      );
    });
  });

  describe('findPersonTestResults', () => {
    it('should aggregate test results correctly', async () => {
      const personId = 123;
      const workspaceId = 1;

      (workspaceCoreService.getIgnoredUnits as jest.Mock).mockResolvedValue([]);

      const bookletQb = mockQueryBuilder();
      (bookletRepository.createQueryBuilder as jest.Mock).mockReturnValue(bookletQb);
      bookletQb.getMany.mockResolvedValue([
        { id: 10, bookletinfo: { name: 'Booklet 1' } }
      ]);

      const unitQb = mockQueryBuilder();
      (unitRepository.createQueryBuilder as jest.Mock).mockReturnValue(unitQb);
      unitQb.getMany.mockResolvedValue([
        {
          id: 101,
          name: 'Unit 1',
          alias: 'U1',
          bookletid: 10,
          responses: [
            {
              id: 1001,
              unitid: 101,
              variableid: 'var1',
              status: 3, // DISPLAYED
              value: 'val1',
              subform: 'sf',
              code_v1: 1,
              score_v1: 2,
              status_v1: 2 // SOURCE_MISSING (example)
            }
          ]
        }
      ]);

      const bookletLogQb = mockQueryBuilder();
      (bookletLogRepository.createQueryBuilder as jest.Mock).mockReturnValue(bookletLogQb);
      bookletLogQb.getMany.mockResolvedValue([
        {
          id: 50, bookletid: 10, ts: 1000, parameter: 'p', key: 'k'
        }
      ]);

      (unitTagService.findAllByUnitIds as jest.Mock).mockResolvedValue([
        { unitId: 101, tag: 'tag1', color: 'red' }
      ]);

      const result = await service.findPersonTestResults(personId, workspaceId);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Booklet 1');

      expect(result[0].logs).toHaveLength(1);
      expect(result[0].logs[0].key).toBe('k');

      expect(result[0].units).toHaveLength(1);
      expect(result[0].units[0].name).toBe('Unit 1');

      expect(result[0].units[0].results).toHaveLength(1);
      expect(result[0].units[0].results[0].status).toBe('VALUE_CHANGED');
      expect(result[0].units[0].results[0].code).toBe(1);

      expect(result[0].units[0].tags).toHaveLength(1);
      expect(result[0].units[0].tags[0].tag).toBe('tag1');
    });
  });

  describe('findFlatResponses', () => {
    it('should filter responses correctly', async () => {
      const workspaceId = 1;
      const options = {
        page: 1,
        limit: 10,
        code: 'abc',
        processingDurationMin: '01:00'
      };

      const qb = mockQueryBuilder();
      (responseRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      (workspaceCoreService.getIgnoredUnits as jest.Mock).mockResolvedValue([]);

      await service.findFlatResponses(workspaceId, options);

      expect(qb.where).toHaveBeenCalledWith('person.workspace_id = :workspaceId', { workspaceId });
      expect(qb.andWhere).toHaveBeenCalledWith('person.code ILIKE :code', { code: '%abc%' });
    });
  });

  describe('exportTestResultsToStream', () => {
    it('should attempt to fetch data for export', async () => {
      const workspaceId = 1;
      const resStream = new PassThrough();

      const qb = mockQueryBuilder();
      (responseRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);
      // Mock stream to return async iterator or getRawMany if implementations uses it.
      const unitQb = mockQueryBuilder();
      (unitRepository.createQueryBuilder as jest.Mock).mockReturnValue(unitQb);
      unitQb.getMany.mockResolvedValueOnce([{
        id: 1,
        booklet: {
          person: { group: 'g', login: 'l', code: 'c' },
          bookletinfo: { name: 'b' }
        }
      }]); // Return one unit to enter loop
      unitQb.getCount.mockResolvedValue(1);

      qb.stream = jest.fn().mockReturnValue({
        on: jest.fn((event, cb) => {
          if (event === 'end') cb();
          return this;
        }),
        pause: jest.fn(),
        resume: jest.fn()
      });

      // We might trigger an error if stream logic isn't fully mocked.
      await service.exportTestResultsToStream(workspaceId, resStream, {});

      expect(qb.getMany).toHaveBeenCalled();
    });
  });
});
