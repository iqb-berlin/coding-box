import { Repository, DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';
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
import { UnitLastState } from '../../entities/unitLastState.entity';
import { ChunkEntity } from '../../entities/chunk.entity';
import { UnitTag } from '../../entities/unitTag.entity';
import { UnitNote } from '../../entities/unitNote.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CoderTrainingDiscussionResult } from '../../entities/coder-training-discussion-result.entity';
import { UnitTagService } from '../workspace/unit-tag.service';
import { JournalService } from '../shared';
import { CacheService } from '../../../cache/cache.service';
import { CodingListService } from '../coding/coding-list.service';
import { CodingValidationService } from '../coding/coding-validation.service';
import { WorkspaceCoreService } from '../workspace/workspace-core.service';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';

const mockQueryBuilder = () => ({
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
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
  distinct: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  execute: jest.fn().mockResolvedValue({ affected: 0 })
});

describe('WorkspaceTestResultsService', () => {
  let service: WorkspaceTestResultsService;
  let responseManagementService: ResponseManagementService;
  let workspaceCoreService: WorkspaceCoreService;
  let workspaceExclusionService: WorkspaceExclusionService;
  let unitTagService: UnitTagService;
  let journalService: JournalService;
  let personsRepository: Repository<Persons>;
  let unitRepository: Repository<Unit>;
  let bookletRepository: Repository<Booklet>;
  let responseRepository: Repository<ResponseEntity>;
  let sessionRepository: Repository<Session>;
  let bookletLogRepository: Repository<BookletLog>;
  let chunkRepository: Repository<ChunkEntity>;
  let codingValidationService: CodingValidationService;
  let cacheService: {
    generateUnitResponseCacheKey: jest.Mock;
    get: jest.Mock;
    set: jest.Mock;
    delete: jest.Mock;
    deleteByPattern: jest.Mock;
  };
  let dataSource: DataSource;

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    responseManagementService = {
      resolveDuplicateResponses: jest.fn().mockResolvedValue({ resolvedCount: 1, success: true }),
      deleteResponse: jest.fn(),
      updateResponsesInDatabase: jest.fn()
    } as unknown as ResponseManagementService;

    workspaceCoreService = {
      getIgnoredUnits: jest.fn().mockResolvedValue([])
    } as unknown as WorkspaceCoreService;

    workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({ globalIgnoredUnits: [], ignoredBooklets: [], testletIgnoredUnits: [] })
    } as unknown as WorkspaceExclusionService;

    unitTagService = {
      findAllByUnitIds: jest.fn().mockResolvedValue([])
    } as unknown as UnitTagService;

    codingValidationService = {
      invalidateIncompleteVariablesCache: jest.fn().mockResolvedValue(undefined)
    } as unknown as CodingValidationService;

    journalService = {
      createEntry: jest.fn().mockResolvedValue(undefined)
    } as unknown as JournalService;

    cacheService = {
      generateUnitResponseCacheKey: jest.fn((workspaceId: number, connector: string, unitId: string) => `${workspaceId}:${connector}:${unitId}`),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      deleteByPattern: jest.fn().mockResolvedValue(undefined)
    };

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
      createQueryBuilder: jest.fn(() => mockQueryBuilder()),
      find: jest.fn().mockResolvedValue([])
    } as unknown as Repository<ChunkEntity>;

    dataSource = {
      createQueryBuilder: jest.fn(() => mockQueryBuilder()),
      getRepository: jest.fn().mockReturnValue({
        createQueryBuilder: jest.fn(() => mockQueryBuilder())
      }),
      transaction: jest.fn()
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
      journalService,
      cacheService as unknown as CacheService,
      {} as unknown as CodingListService,
      codingValidationService,
      responseManagementService,
      workspaceCoreService,
      workspaceExclusionService
    );
  });

  describe('previewDeleteTestResults', () => {
    it('uses overview-compatible counts for bulk deletion previews', async () => {
      const workspaceId = 1;
      const targetQb = mockQueryBuilder();
      const personsCountQb = mockQueryBuilder();
      const bookletsCountQb = mockQueryBuilder();
      const unitsCountQb = mockQueryBuilder();
      const responsesCountQb = mockQueryBuilder();
      const metadataQb = mockQueryBuilder();

      (personsRepository.createQueryBuilder as jest.Mock).mockReturnValue(targetQb);
      targetQb.getMany.mockResolvedValue([{ id: 10 }, { id: 11 }]);
      (dataSource.createQueryBuilder as jest.Mock)
        .mockReturnValueOnce(personsCountQb)
        .mockReturnValueOnce(bookletsCountQb)
        .mockReturnValueOnce(unitsCountQb)
        .mockReturnValueOnce(responsesCountQb)
        .mockReturnValueOnce(metadataQb);
      (workspaceExclusionService.resolveExclusionsForQueries as jest.Mock).mockResolvedValue({
        globalIgnoredUnits: ['IGNORED_UNIT.XML'],
        ignoredBooklets: ['IGNORED_BOOKLET'],
        testletIgnoredUnits: []
      });

      personsCountQb.getRawOne.mockResolvedValue({ count: '2' });
      bookletsCountQb.getRawOne.mockResolvedValue({ count: '4' });
      unitsCountQb.getRawOne.mockResolvedValue({ count: '33' });
      responsesCountQb.getRawOne.mockResolvedValue({ count: '10725' });
      metadataQb.getRawOne.mockResolvedValue({
        groups: ['G1'],
        bookletNames: ['BOOKLET_1'],
        unitNames: ['UNIT_1']
      });

      const result = await service.previewDeleteTestResults(workspaceId, {
        scope: 'filteredPersons'
      });

      expect(result).toMatchObject({
        persons: 2,
        booklets: 4,
        units: 33,
        responses: 10725
      });
      expect(bookletsCountQb.select).toHaveBeenCalledWith(
        'COUNT(DISTINCT bookletinfo.name)',
        'count'
      );
      expect(unitsCountQb.select).toHaveBeenCalledWith(
        'COUNT(DISTINCT COALESCE(unit.alias, unit.name))',
        'count'
      );
      expect(bookletsCountQb.andWhere).toHaveBeenCalledWith(
        'UPPER(bookletinfo.name) NOT IN (:...ignoredBookletsOnly)',
        { ignoredBookletsOnly: ['IGNORED_BOOKLET'] }
      );
      expect(unitsCountQb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining("REGEXP_REPLACE(UPPER(unit.name), '\\.XML$', '', 'i') NOT IN"),
        expect.objectContaining({ workspaceExclusionIgnoredUnits: ['IGNORED_UNIT'] })
      );
      expect(responsesCountQb.andWhere).toHaveBeenCalledWith(
        'response.is_autocoder_generated IS NOT TRUE'
      );
    });
  });

  describe('bulk deletion safety', () => {
    it('previews log deletion with log-specific counts', async () => {
      const privateService = service as unknown as {
        resolveDeleteTargets: jest.Mock;
        collectLogDeleteSnapshot: jest.Mock;
        getLogDeleteCounts: jest.Mock;
      };
      const resolveSpy = jest
        .spyOn(privateService, 'resolveDeleteTargets')
        .mockResolvedValue({
          kind: 'booklets',
          ids: [20],
          preview: {
            scope: 'booklets',
            label: 'Testheft(e): BOOKLET_1',
            persons: 1,
            booklets: 1,
            units: 3,
            responses: 9,
            groups: ['G1'],
            bookletNames: ['BOOKLET_1'],
            unitNames: ['UNIT_1'],
            warnings: []
          }
        });
      const snapshotSpy = jest
        .spyOn(privateService, 'collectLogDeleteSnapshot')
        .mockResolvedValue({
          bookletIds: [20],
          unitIds: [30, 31, 32]
        });
      const countsSpy = jest
        .spyOn(privateService, 'getLogDeleteCounts')
        .mockResolvedValue({
          bookletLogs: 4,
          unitLogs: 12,
          sessions: 1
        });

      const result = await service.previewDeleteTestLogs(1, {
        scope: 'booklets',
        bookletNames: ['BOOKLET_1']
      });

      expect(result).toMatchObject({
        targetType: 'logs',
        bookletLogs: 4,
        unitLogs: 12,
        sessions: 1,
        responses: 9
      });

      resolveSpy.mockRestore();
      snapshotSpy.mockRestore();
      countsSpy.mockRestore();
    });

    it('deletes only log and session tables for log deletion jobs', async () => {
      const deletedFrom: unknown[] = [];
      const manager = {
        createQueryBuilder: jest.fn(() => {
          const qb = {} as {
            delete: jest.Mock;
            from: jest.Mock;
            where: jest.Mock;
            execute: jest.Mock;
          };
          qb.delete = jest.fn(() => qb);
          qb.from = jest.fn((entity: unknown) => {
            deletedFrom.push(entity);
            return qb;
          });
          qb.where = jest.fn(() => qb);
          qb.execute = jest.fn().mockResolvedValue({ affected: 1 });
          return qb;
        })
      };
      const privateService = service as unknown as {
        resolveDeleteTargets: jest.Mock;
        buildLogDeletePreview: jest.Mock;
        collectLogDeleteSnapshot: jest.Mock;
        assertLogDeleteCompleted: jest.Mock;
      };
      const resolveSpy = jest
        .spyOn(privateService, 'resolveDeleteTargets')
        .mockResolvedValue({
          kind: 'persons',
          ids: [10],
          preview: {
            scope: 'persons',
            label: '1 ausgewählte Testperson(en)',
            persons: 1,
            booklets: 1,
            units: 2,
            responses: 8,
            groups: [],
            bookletNames: [],
            unitNames: [],
            warnings: []
          }
        });
      const previewSpy = jest
        .spyOn(privateService, 'buildLogDeletePreview')
        .mockResolvedValue({
          targetType: 'logs',
          scope: 'persons',
          label: '1 ausgewählte Testperson(en)',
          persons: 1,
          booklets: 1,
          units: 2,
          responses: 8,
          bookletLogs: 2,
          unitLogs: 3,
          sessions: 1,
          groups: [],
          bookletNames: [],
          unitNames: [],
          warnings: []
        });
      const snapshotSpy = jest
        .spyOn(privateService, 'collectLogDeleteSnapshot')
        .mockResolvedValue({
          bookletIds: [20],
          unitIds: [30, 31]
        });
      const assertSpy = jest
        .spyOn(privateService, 'assertLogDeleteCompleted')
        .mockResolvedValue(undefined);

      (dataSource.transaction as jest.Mock).mockImplementation(cb => cb(manager));

      const result = await service.deleteTestLogsByRequest(
        1,
        { scope: 'persons', personIds: [10] },
        'user-1'
      );

      expect(deletedFrom).toEqual([UnitLog, BookletLog, Session]);
      expect(deletedFrom).not.toContain(ResponseEntity);
      expect(deletedFrom).not.toContain(Booklet);
      expect(result).toMatchObject({
        targetType: 'logs',
        deletedBookletLogs: 1,
        deletedUnitLogs: 1,
        deletedSessions: 1,
        deletedTargetCount: 3
      });
      expect(cacheService.delete).toHaveBeenCalledWith(
        'workspace-overview-stats-1'
      );
      expect(journalService.createEntry).toHaveBeenCalledWith(
        'user-1',
        1,
        'delete',
        'test-logs',
        0,
        expect.objectContaining({
          deletedTargetCount: 3
        })
      );

      resolveSpy.mockRestore();
      previewSpy.mockRestore();
      snapshotSpy.mockRestore();
      assertSpy.mockRestore();
    });

    it('explicitly deletes known unit dependents before removing unit targets', async () => {
      const deletedFrom: unknown[] = [];
      const manager = {
        createQueryBuilder: jest.fn(() => {
          const qb = {} as {
            delete: jest.Mock;
            from: jest.Mock;
            where: jest.Mock;
            execute: jest.Mock;
          };
          qb.delete = jest.fn(() => qb);
          qb.from = jest.fn((entity: unknown) => {
            deletedFrom.push(entity);
            return qb;
          });
          qb.where = jest.fn(() => qb);
          qb.execute = jest.fn().mockResolvedValue({ affected: 1 });
          return qb;
        })
      };
      const privateService = service as unknown as {
        deleteKnownDeleteDependents: (
          managerArg: unknown,
          kind: 'units',
          snapshot: {
            bookletIds: number[];
            unitIds: number[];
            responseIds: number[];
            bookletInfoIds: number[];
          }
        ) => Promise<void>;
      };

      await privateService.deleteKnownDeleteDependents(manager, 'units', {
        bookletIds: [],
        unitIds: [100],
        responseIds: [500],
        bookletInfoIds: []
      });

      expect(deletedFrom).toEqual([
        CodingJobUnit,
        CoderTrainingDiscussionResult,
        ResponseEntity,
        UnitNote,
        UnitTag,
        UnitLog,
        UnitLastState,
        ChunkEntity
      ]);
      expect(deletedFrom).not.toContain(Unit);
    });

    it('does not complete when a known dependent row remains', async () => {
      (dataSource.createQueryBuilder as jest.Mock).mockImplementation(() => {
        const qb = mockQueryBuilder();
        let selectedEntity: unknown;
        qb.from.mockImplementation((entity: unknown) => {
          selectedEntity = entity;
          return qb;
        });
        qb.getRawOne.mockImplementation(() => Promise.resolve({
          count: selectedEntity === UnitNote ? '1' : '0'
        }));
        return qb;
      });
      const privateService = service as unknown as {
        assertDeleteCompleted: (
          kind: 'units',
          targetIds: number[],
          snapshot: {
            bookletIds: number[];
            unitIds: number[];
            responseIds: number[];
            bookletInfoIds: number[];
          }
        ) => Promise<void>;
      };

      await expect(privateService.assertDeleteCompleted('units', [100], {
        bookletIds: [],
        unitIds: [100],
        responseIds: [],
        bookletInfoIds: []
      })).rejects.toThrow('Unit-Notiz');
    });
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

  describe('searchResponses', () => {
    it('should filter by autocoder-generated responses when derivedOnly is set', async () => {
      const qb = mockQueryBuilder();
      (responseRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);
      qb.getCount.mockResolvedValue(0);

      const result = await service.searchResponses(
        1,
        { derivedOnly: true },
        { page: 1, limit: 100 }
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        'response.is_autocoder_generated = :derivedOnly',
        { derivedOnly: true }
      );
      expect(qb.andWhere).toHaveBeenCalledWith('response.status_v1 IS NOT NULL');
      expect(qb.andWhere).toHaveBeenCalledWith(
        'response.status_v1 NOT IN (:...ignoredDerivedCodingStatuses)',
        { ignoredDerivedCodingStatuses: [0, 1, 2, 3, 10] }
      );
      expect(result).toEqual({ data: [], total: 0 });
    });

    it('should exclude autocoder-generated responses from default response searches', async () => {
      const qb = mockQueryBuilder();
      (responseRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);
      qb.getCount.mockResolvedValue(0);

      await service.searchResponses(
        1,
        {},
        { page: 1, limit: 100 }
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        'response.is_autocoder_generated IS NOT TRUE'
      );
    });

    it('should apply the v3 fallback status expression for derived-only searches', async () => {
      const qb = mockQueryBuilder();
      (responseRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);
      qb.getCount.mockResolvedValue(0);

      await service.searchResponses(
        1,
        { derivedOnly: true, version: 'v3' },
        { page: 1, limit: 100 }
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('COALESCE(CASE WHEN response.status_v3')
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('NOT IN (:...ignoredDerivedCodingStatuses)'),
        { ignoredDerivedCodingStatuses: [0, 1, 2, 3, 10] }
      );
    });
  });

  describe('getResponsesByStatus', () => {
    it('should include all raw response statuses used by coding statistics', async () => {
      const qb = mockQueryBuilder();
      (responseRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);
      qb.getManyAndCount.mockResolvedValue([[], 2180]);

      const result = await service.getResponsesByStatus(
        1,
        '5',
        'v1',
        { page: 1, limit: 100 }
      );

      expect(qb.where).toHaveBeenCalledWith(
        'response.status IN (:...codingResponseStatuses)',
        { codingResponseStatuses: [1, 2, 3] }
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        'response.status_v1 = :statusParam',
        { statusParam: 5 }
      );
      expect(result).toEqual([[], 2180]);
    });

    it('should use the selected coding version for status filtering', async () => {
      const qb = mockQueryBuilder();
      (responseRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.getResponsesByStatus(
        1,
        'CODING_COMPLETE',
        'v3',
        { page: 1, limit: 100 }
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('COALESCE(CASE WHEN response.status_v3'),
        { statusParam: 5 }
      );
    });
  });

  describe('getWorkspaceTestResultsOverview', () => {
    it('should return correct statistics', async () => {
      const workspaceId = 1;

      (personsRepository.count as jest.Mock).mockResolvedValue(10);

      const personQb = mockQueryBuilder();
      (personsRepository.createQueryBuilder as jest.Mock).mockReturnValue(personQb);
      personQb.getRawMany.mockResolvedValue([{ group: 'group1' }, { group: 'group2' }]);
      personQb.getRawOne.mockResolvedValue({ count: 2 });

      const bookletQb = mockQueryBuilder();
      (bookletRepository.createQueryBuilder as jest.Mock).mockReturnValue(bookletQb);
      bookletQb.getRawMany.mockResolvedValue([{ name: 'booklet1' }]);
      bookletQb.getRawOne.mockResolvedValue({ count: 1 });

      const unitQb = mockQueryBuilder();
      (unitRepository.createQueryBuilder as jest.Mock).mockReturnValue(unitQb);
      unitQb.getRawMany.mockResolvedValue(['unit1', 'unit2']);
      unitQb.getRawOne.mockResolvedValue({ count: 2 });

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
      expect(responseCountQb.andWhere).toHaveBeenCalledWith(
        'response.is_autocoder_generated IS NOT TRUE'
      );
      expect(responseStatusQb.andWhere).toHaveBeenCalledWith(
        'response.is_autocoder_generated IS NOT TRUE'
      );
    });

    it('should handle ignored units correctly', async () => {
      const workspaceId = 1;

      (workspaceExclusionService.resolveExclusionsForQueries as jest.Mock).mockResolvedValue({
        globalIgnoredUnits: ['unit1.xml'],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      });
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
        expect.stringContaining("REGEXP_REPLACE(UPPER(unit.name), '\\.XML$', '', 'i') NOT IN"),
        expect.objectContaining({ workspaceExclusionIgnoredUnits: ['UNIT1'] }) // .XML stripped and uppercase
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

  describe('findWorkspaceResponses', () => {
    it('scopes response list to the workspace and applies exclusions', async () => {
      const qb = mockQueryBuilder();
      (responseRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      (workspaceExclusionService.resolveExclusionsForQueries as jest.Mock).mockResolvedValue({
        globalIgnoredUnits: ['UNIT1'],
        ignoredBooklets: ['BOOKLET1'],
        testletIgnoredUnits: []
      });

      await service.findWorkspaceResponses(1, { page: 1, limit: 10 });

      expect(qb.where).toHaveBeenCalledWith('person.workspace_id = :workspace_id', { workspace_id: 1 });
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining("REGEXP_REPLACE(UPPER(unit.name), '\\.XML$', '', 'i') NOT IN"),
        expect.objectContaining({ workspaceExclusionIgnoredUnits: ['UNIT1'] })
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('UPPER(bookletinfo.name) NOT IN'),
        expect.objectContaining({ workspaceExclusionIgnoredBooklets: ['BOOKLET1'] })
      );
    });
  });

  describe('findUnitResponse', () => {
    it('returns no replay responses for an ignored booklet without looking up the unit', async () => {
      (workspaceExclusionService.resolveExclusionsForQueries as jest.Mock).mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: ['BOOKLET-A'],
        testletIgnoredUnits: []
      });

      const result = await service.findUnitResponse(
        1,
        'login-a@code-a@group-a@BOOKLET-A',
        'unit-original-id'
      );

      expect(result).toEqual({ responses: [] });
      expect(unitRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should look up replay units by alias first', async () => {
      const unitQb = mockQueryBuilder();
      (unitRepository.createQueryBuilder as jest.Mock).mockReturnValue(unitQb);
      unitQb.getRawOne.mockResolvedValue({ unitId: 77 });

      const responseQb = mockQueryBuilder();
      (responseRepository.createQueryBuilder as jest.Mock).mockReturnValue(responseQb);
      responseQb.getRawMany.mockResolvedValue([]);

      const result = await service.findUnitResponse(
        1,
        'login-a@code-a@group-a@booklet-a',
        'unit-original-id'
      );

      expect(result).toEqual({ responses: [] });
      expect(unitQb.andWhere).toHaveBeenCalledWith('unit.alias = :unitId', {
        unitId: 'unit-original-id'
      });
      expect(unitRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
    });

    it('should fall back to visible unit name when alias lookup misses', async () => {
      const aliasQb = mockQueryBuilder();
      const nameQb = mockQueryBuilder();
      (unitRepository.createQueryBuilder as jest.Mock)
        .mockReturnValueOnce(aliasQb)
        .mockReturnValueOnce(nameQb);
      aliasQb.getRawOne.mockResolvedValue(null);
      nameQb.getRawOne.mockResolvedValue({ unitId: 77 });

      const responseQb = mockQueryBuilder();
      (responseRepository.createQueryBuilder as jest.Mock).mockReturnValue(responseQb);
      responseQb.getRawMany.mockResolvedValue([]);

      const result = await service.findUnitResponse(
        1,
        'login-a@code-a@group-a@booklet-a',
        'unit-visible-id'
      );

      expect(result).toEqual({ responses: [] });
      expect(aliasQb.andWhere).toHaveBeenCalledWith('unit.alias = :unitId', {
        unitId: 'unit-visible-id'
      });
      expect(nameQb.andWhere).toHaveBeenCalledWith('unit.name = :unitId', {
        unitId: 'unit-visible-id'
      });
    });
  });

  describe('exportTestResultsToStream', () => {
    const collectStream = (stream: PassThrough): Promise<string> => new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', reject);
    });

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
      expect(qb.andWhere).toHaveBeenCalledWith(
        'response.is_autocoder_generated IS NOT TRUE'
      );
    });

    it('should keep legacy headers when log anomalies are not requested', async () => {
      const resStream = new PassThrough();
      const outputPromise = collectStream(resStream);
      const unitQb = mockQueryBuilder();
      const responseQb = mockQueryBuilder();
      const chunkQb = mockQueryBuilder();
      const lastStateQb = mockQueryBuilder();
      const unit = {
        id: 1,
        name: 'unit-a',
        alias: 'unit-original-a',
        booklet: {
          id: 10,
          person: { group: 'group-a', login: 'login-a', code: 'code-a' },
          bookletinfo: { name: 'booklet-a' }
        }
      };

      (unitRepository.createQueryBuilder as jest.Mock).mockReturnValue(unitQb);
      unitQb.getCount.mockResolvedValue(1);
      unitQb.getMany
        .mockResolvedValueOnce([unit])
        .mockResolvedValueOnce([]);
      (responseRepository.createQueryBuilder as jest.Mock).mockReturnValue(responseQb);
      responseQb.getMany.mockResolvedValue([]);
      (chunkRepository.createQueryBuilder as jest.Mock).mockReturnValue(chunkQb);
      chunkQb.getMany.mockResolvedValue([]);
      (dataSource.getRepository as jest.Mock).mockReturnValue({
        createQueryBuilder: jest.fn(() => lastStateQb)
      });
      lastStateQb.getMany.mockResolvedValue([]);

      await service.exportTestResultsToStream(1, resStream, {});

      const output = await outputPromise;
      const [header] = output.trim().split('\n');

      expect(header).toBe(
        'groupname;loginname;code;bookletname;unitname;responses;laststate;originalUnitId'
      );
      expect(header).not.toContain('log_anomaly_');
    });

    it('should add log anomaly columns when requested', async () => {
      const workspaceId = 1;
      const resStream = new PassThrough();
      const outputPromise = collectStream(resStream);
      const unitQb = mockQueryBuilder();
      const responseQb = mockQueryBuilder();
      const chunkQb = mockQueryBuilder();
      const lastStateQb = mockQueryBuilder();
      const unit = {
        id: 1,
        name: 'unit-a',
        alias: 'unit-original-a',
        booklet: {
          id: 10,
          person: { group: 'group-a', login: 'login-a', code: 'code-a' },
          bookletinfo: { name: 'booklet-a' }
        }
      };
      const anomalyService = service as unknown as {
        findLogAnomaliesForBooklets: (
          bookletIds: number[],
          thresholds: unknown
        ) => Promise<Map<number, Array<{
          code: string;
          severity: 'critical' | 'warning' | 'info';
          label: string;
          evidence: string;
          count: number;
        }>>>;
      };

      (unitRepository.createQueryBuilder as jest.Mock).mockReturnValue(unitQb);
      unitQb.getCount.mockResolvedValue(1);
      unitQb.getMany
        .mockResolvedValueOnce([unit])
        .mockResolvedValueOnce([]);
      (responseRepository.createQueryBuilder as jest.Mock).mockReturnValue(responseQb);
      responseQb.getMany.mockResolvedValue([]);
      (chunkRepository.createQueryBuilder as jest.Mock).mockReturnValue(chunkQb);
      chunkQb.getMany.mockResolvedValue([]);
      (dataSource.getRepository as jest.Mock).mockReturnValue({
        createQueryBuilder: jest.fn(() => lastStateQb)
      });
      lastStateQb.getMany.mockResolvedValue([]);
      jest
        .spyOn(anomalyService, 'findLogAnomaliesForBooklets')
        .mockResolvedValue(new Map([
          [
            10,
            [
              {
                code: 'controller_error',
                severity: 'critical',
                label: 'Controller error',
                evidence: '',
                count: 1
              },
              {
                code: 'connection_lost',
                severity: 'warning',
                label: 'Connection lost',
                evidence: '',
                count: 2
              }
            ]
          ]
        ]));

      await service.exportTestResultsToStream(
        workspaceId,
        resStream,
        { includeLogAnomalies: true }
      );

      const output = await outputPromise;
      const [header, row] = output.trim().split('\n');

      expect(header).toContain(
        'log_anomaly_count;log_anomaly_max_severity;log_anomaly_codes;log_anomaly_labels'
      );
      expect(row).toContain(
        '3;critical;"controller_error|connection_lost";"Controller error|Connection lost"'
      );
    });
  });

  describe('deletion methods', () => {
    it('deleteTestPersons should invalidate cache', async () => {
      const workspaceId = 1;
      const testPersonIds = '1,2';
      const userId = 'user1';

      const personQb = mockQueryBuilder();
      personQb.getMany.mockResolvedValue([{ id: 1, login: 'l1' }, { id: 2, login: 'l2' }]);
      (personsRepository.createQueryBuilder as jest.Mock).mockReturnValue(personQb);
      // Mock transaction
      (dataSource.transaction as jest.Mock).mockImplementation(cb => cb({
        createQueryBuilder: jest.fn(() => ({
          select: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([{ id: 1, login: 'l1' }, { id: 2, login: 'l2' }]),
          delete: jest.fn().mockReturnThis(),
          from: jest.fn().mockReturnThis(),
          execute: jest.fn().mockResolvedValue({})
        }))
      }));

      await service.deleteTestPersons(workspaceId, testPersonIds, userId);

      expect(codingValidationService.invalidateIncompleteVariablesCache).toHaveBeenCalledWith(workspaceId);
      expect(cacheService.delete).toHaveBeenCalledWith(`workspace-overview-stats-${workspaceId}`);
      expect(cacheService.deleteByPattern).toHaveBeenCalledWith(`flat-frequencies-${workspaceId}-*`);
    });

    it('deleteUnit should invalidate cache', async () => {
      const workspaceId = 1;
      const unitId = 101;
      const userId = 'user1';

      (dataSource.transaction as jest.Mock).mockImplementation(cb => cb({
        createQueryBuilder: jest.fn(() => ({
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue({ id: 101, name: 'U1' }),
          delete: jest.fn().mockReturnThis(),
          from: jest.fn().mockReturnThis(),
          execute: jest.fn().mockResolvedValue({})
        }))
      }));

      await service.deleteUnit(workspaceId, unitId, userId);

      expect(codingValidationService.invalidateIncompleteVariablesCache).toHaveBeenCalledWith(workspaceId);
      expect(cacheService.delete).toHaveBeenCalledWith(`workspace-overview-stats-${workspaceId}`);
      expect(cacheService.deleteByPattern).toHaveBeenCalledWith(`flat-frequencies-${workspaceId}-*`);
    });

    it('deleteResponse should invalidate cache', async () => {
      const workspaceId = 1;
      const responseId = 500;
      const userId = 'user1';

      (responseManagementService.deleteResponse as jest.Mock).mockResolvedValue({ success: true });

      await service.deleteResponse(workspaceId, responseId, userId);

      expect(codingValidationService.invalidateIncompleteVariablesCache).toHaveBeenCalledWith(workspaceId);
    });

    it('deleteBooklet should invalidate cache', async () => {
      const workspaceId = 1;
      const bookletId = 202;
      const userId = 'user1';

      (dataSource.transaction as jest.Mock).mockImplementation(cb => cb({
        createQueryBuilder: jest.fn(() => ({
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue({ id: 202, bookletinfo: { name: 'B1' } }),
          delete: jest.fn().mockReturnThis(),
          from: jest.fn().mockReturnThis(),
          execute: jest.fn().mockResolvedValue({})
        }))
      }));

      await service.deleteBooklet(workspaceId, bookletId, userId);

      expect(codingValidationService.invalidateIncompleteVariablesCache).toHaveBeenCalledWith(workspaceId);
      expect(cacheService.delete).toHaveBeenCalledWith(`workspace-overview-stats-${workspaceId}`);
      expect(cacheService.deleteByPattern).toHaveBeenCalledWith(`flat-frequencies-${workspaceId}-*`);
    });
  });

  describe('parseStoredResponseValue', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parse = (value: string | null, variableId?: string) => (WorkspaceTestResultsService as any).parseStoredResponseValue(value, variableId);

    it('should normalize flat marking tokens to nested arrays', () => {
      const parsed = parse('["2-2-#f9f871","4-4-#f9f871"]', 'marking-panel_1');
      expect(parsed).toEqual([['2-2-#f9f871', '4-4-#f9f871']]);
    });

    it('should return empty array for non-array marking-panel payloads', () => {
      const parsed = parse('{"unexpected":true}', 'marking-panel_1');
      expect(parsed).toEqual([]);
    });

    it('should keep non-json primitive strings for non-marking variables', () => {
      const parsed = parse('false', 'image_1');
      expect(parsed).toBe('false');
    });

    it('should parse JSON arrays for non-marking variables', () => {
      const parsed = parse('[true,false,true]', 'hotspot-image_1');
      expect(parsed).toEqual([true, false, true]);
    });

    it('should keep JSON objects as strings for non-marking variables', () => {
      const parsed = parse('{"k":"v"}', 'text_1');
      expect(parsed).toBe('{"k":"v"}');
    });

    it('should keep arrays of objects as strings for non-marking variables', () => {
      const parsed = parse('[{"k":"v"}]', 'text_1');
      expect(parsed).toBe('[{"k":"v"}]');
    });
  });
});
