import { Repository } from 'typeorm';
import { PersonQueryService } from './person-query.service';
import Persons from '../../entities/persons.entity';
import { Booklet } from '../../entities/booklet.entity';
import { Unit } from '../../entities/unit.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { BookletLog } from '../../entities/bookletLog.entity';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';

const mockQueryBuilder = () => ({
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  leftJoin: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  addGroupBy: jest.fn().mockReturnThis(),
  getRawMany: jest.fn().mockResolvedValue([]),
  getRawOne: jest.fn().mockResolvedValue({ count: 0 }),
  getCount: jest.fn().mockResolvedValue(0)
});

describe('PersonQueryService', () => {
  let service: PersonQueryService;
  let personsRepository: Repository<Persons>;
  let bookletRepository: Repository<Booklet>;
  let unitRepository: Repository<Unit>;
  let responseRepository: Repository<ResponseEntity>;
  let bookletLogRepository: Repository<BookletLog>;
  let workspaceExclusionService: Pick<WorkspaceExclusionService, 'resolveExclusionsForQueries'>;

  beforeEach(() => {
    personsRepository = {
      count: jest.fn(),
      createQueryBuilder: jest.fn(() => mockQueryBuilder())
    } as unknown as Repository<Persons>;

    bookletRepository = {
      createQueryBuilder: jest.fn(() => mockQueryBuilder())
    } as unknown as Repository<Booklet>;

    unitRepository = {
      createQueryBuilder: jest.fn(() => mockQueryBuilder())
    } as unknown as Repository<Unit>;

    responseRepository = {
      createQueryBuilder: jest.fn(() => mockQueryBuilder())
    } as unknown as Repository<ResponseEntity>;

    bookletLogRepository = {
      createQueryBuilder: jest.fn(() => mockQueryBuilder())
    } as unknown as Repository<BookletLog>;

    workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };

    service = new PersonQueryService(
      personsRepository,
      bookletRepository,
      unitRepository,
      responseRepository,
      bookletLogRepository,
      workspaceExclusionService as WorkspaceExclusionService
    );
  });

  describe('getWorkspaceGroups', () => {
    it('should return distinct groups for a workspace', async () => {
      const mockGroups = [{ group: 'Group A' }, { group: 'Group B' }];
      const qb = mockQueryBuilder();
      qb.getRawMany.mockResolvedValue(mockGroups);
      (personsRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const result = await service.getWorkspaceGroups(1);

      expect(result).toEqual(['Group A', 'Group B']);
      expect(personsRepository.createQueryBuilder).toHaveBeenCalledWith('person');
    });

    it('should return empty array when no groups exist', async () => {
      const qb = mockQueryBuilder();
      qb.getRawMany.mockResolvedValue([]);
      (personsRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const result = await service.getWorkspaceGroups(1);

      expect(result).toEqual([]);
    });

    it('should handle database errors gracefully', async () => {
      (personsRepository.createQueryBuilder as jest.Mock).mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await service.getWorkspaceGroups(1);

      expect(result).toEqual([]);
    });
  });

  describe('getWorkspaceUploadStats', () => {
    it('should return complete statistics for a workspace', async () => {
      (personsRepository.count as jest.Mock).mockResolvedValue(10);

      const groupsQb = mockQueryBuilder();
      groupsQb.getRawOne.mockResolvedValue({ count: '2' });

      const bookletsQb = mockQueryBuilder();
      bookletsQb.getRawOne.mockResolvedValue({ count: '2' });

      const unitsQb = mockQueryBuilder();
      unitsQb.getRawOne.mockResolvedValue({ count: '2' });

      const responsesQb = mockQueryBuilder();
      responsesQb.getCount.mockResolvedValue(50);

      (personsRepository.createQueryBuilder as jest.Mock).mockReturnValue(groupsQb);
      (bookletRepository.createQueryBuilder as jest.Mock).mockReturnValue(bookletsQb);
      (unitRepository.createQueryBuilder as jest.Mock).mockReturnValue(unitsQb);
      (responseRepository.createQueryBuilder as jest.Mock).mockReturnValue(responsesQb);

      const result = await service.getWorkspaceUploadStats(1);

      expect(result).toEqual({
        testPersons: 10,
        testGroups: 2,
        uniqueBooklets: 2,
        uniqueUnits: 2,
        uniqueResponses: 50
      });
      expect(workspaceExclusionService.resolveExclusionsForQueries).toHaveBeenCalledWith(1);
    });

    it('should return zero values when workspace is empty', async () => {
      (personsRepository.count as jest.Mock).mockResolvedValue(0);

      const qb = mockQueryBuilder();
      qb.getRawMany.mockResolvedValue([]);
      qb.getRawOne.mockResolvedValue({ count: 0 });
      qb.getCount.mockResolvedValue(0);

      (personsRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);
      (bookletRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);
      (unitRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);
      (responseRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const result = await service.getWorkspaceUploadStats(1);

      expect(result).toEqual({
        testPersons: 0,
        testGroups: 0,
        uniqueBooklets: 0,
        uniqueUnits: 0,
        uniqueResponses: 0
      });
    });

    it('should use the same exclusions and autocoder filtering as the workspace overview', async () => {
      (workspaceExclusionService.resolveExclusionsForQueries as jest.Mock).mockResolvedValue({
        globalIgnoredUnits: ['ignored-unit.xml'],
        ignoredBooklets: ['ignored-booklet'],
        testletIgnoredUnits: [{ bookletId: 'booklet-a', unitId: 'testlet-unit.xml' }]
      });
      (personsRepository.count as jest.Mock).mockResolvedValue(10);

      const groupsQb = mockQueryBuilder();
      groupsQb.getRawOne.mockResolvedValue({ count: '2' });

      const bookletsQb = mockQueryBuilder();
      bookletsQb.getRawOne.mockResolvedValue({ count: '1' });

      const unitsQb = mockQueryBuilder();
      unitsQb.getRawOne.mockResolvedValue({ count: '3' });

      const responsesQb = mockQueryBuilder();
      responsesQb.getCount.mockResolvedValue(30);

      (personsRepository.createQueryBuilder as jest.Mock).mockReturnValue(groupsQb);
      (bookletRepository.createQueryBuilder as jest.Mock).mockReturnValue(bookletsQb);
      (unitRepository.createQueryBuilder as jest.Mock).mockReturnValue(unitsQb);
      (responseRepository.createQueryBuilder as jest.Mock).mockReturnValue(responsesQb);

      await service.getWorkspaceUploadStats(1);

      expect(bookletsQb.andWhere).toHaveBeenCalledWith(
        'UPPER(bookletinfo.name) NOT IN (:...ignoredBookletsOnly)',
        { ignoredBookletsOnly: ['IGNORED-BOOKLET'] }
      );
      expect(unitsQb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining("REGEXP_REPLACE(UPPER(unit.name), '\\.XML$', '', 'i') NOT IN"),
        expect.objectContaining({ workspaceExclusionIgnoredUnits: ['IGNORED-UNIT'] })
      );
      expect(unitsQb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('UPPER(bookletinfo.name) NOT IN'),
        expect.objectContaining({ workspaceExclusionIgnoredBooklets: ['IGNORED-BOOKLET'] })
      );
      expect(unitsQb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('NOT ((UPPER(bookletinfo.name) = :workspaceExclusionBooklet0'),
        expect.objectContaining({
          workspaceExclusionBooklet0: 'BOOKLET-A',
          workspaceExclusionUnit0: 'TESTLET-UNIT'
        })
      );
      expect(responsesQb.andWhere).toHaveBeenCalledWith(
        'response.is_autocoder_generated IS NOT TRUE'
      );
    });

    it('should surface database errors instead of returning misleading zero stats', async () => {
      (personsRepository.count as jest.Mock).mockRejectedValue(new Error('DB Error'));

      await expect(service.getWorkspaceUploadStats(1)).rejects.toThrow('DB Error');
    });
  });

  describe('hasBookletLogsForGroup', () => {
    it('should return true when logs exist for group', async () => {
      const qb = mockQueryBuilder();
      qb.getCount.mockResolvedValue(5);
      (bookletLogRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const result = await service.hasBookletLogsForGroup(1, 'TestGroup');

      expect(result).toBe(true);
    });

    it('should return false when no logs exist for group', async () => {
      const qb = mockQueryBuilder();
      qb.getCount.mockResolvedValue(0);
      (bookletLogRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const result = await service.hasBookletLogsForGroup(1, 'TestGroup');

      expect(result).toBe(false);
    });

    it('should handle database errors gracefully', async () => {
      (bookletLogRepository.createQueryBuilder as jest.Mock).mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await service.hasBookletLogsForGroup(1, 'TestGroup');

      expect(result).toBe(false);
    });
  });

  describe('getGroupsWithBookletLogs', () => {
    it('should return map of groups with log status', async () => {
      const groupsQb = mockQueryBuilder();
      groupsQb.getRawMany.mockResolvedValue([
        { group: 'Group A' },
        { group: 'Group B' },
        { group: 'Group C' }
      ]);
      const logsQb = mockQueryBuilder();
      logsQb.getRawMany.mockResolvedValue([
        { group: 'Group A', logCount: '2' },
        { group: 'Group C', logCount: '5' }
      ]);
      (personsRepository.createQueryBuilder as jest.Mock)
        .mockReturnValue(groupsQb);
      (bookletLogRepository.createQueryBuilder as jest.Mock)
        .mockReturnValue(logsQb);

      const result = await service.getGroupsWithBookletLogs(1);

      expect(result.get('Group A')).toBe(true);
      expect(result.get('Group B')).toBe(false);
      expect(result.get('Group C')).toBe(true);
      expect(bookletLogRepository.createQueryBuilder)
        .toHaveBeenCalledWith('bookletlog');
      expect(logsQb.groupBy).toHaveBeenCalledWith('person.group');
    });

    it('should reuse supplied workspace groups when available', async () => {
      const logsQb = mockQueryBuilder();
      logsQb.getRawMany.mockResolvedValue([
        { group: 'Group A', logCount: '1' }
      ]);
      (bookletLogRepository.createQueryBuilder as jest.Mock)
        .mockReturnValue(logsQb);

      const result = await service.getGroupsWithBookletLogs(1, [
        'Group A',
        'Group B'
      ]);

      expect(result).toEqual(new Map([
        ['Group A', true],
        ['Group B', false]
      ]));
      expect(personsRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should return empty map when no groups exist', async () => {
      const qb = mockQueryBuilder();
      qb.getRawMany.mockResolvedValue([]);
      (bookletLogRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const result = await service.getGroupsWithBookletLogs(1);

      expect(result.size).toBe(0);
    });

    it('should handle errors gracefully', async () => {
      (bookletLogRepository.createQueryBuilder as jest.Mock).mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await service.getGroupsWithBookletLogs(1);

      expect(result).toEqual(new Map<string, boolean>());
    });
  });

  describe('getImportStatistics', () => {
    it('should return import statistics for a workspace', async () => {
      (personsRepository.count as jest.Mock).mockResolvedValue(15);

      const bookletsQb = mockQueryBuilder();
      bookletsQb.getCount.mockResolvedValue(8);

      const unitsQb = mockQueryBuilder();
      unitsQb.getCount.mockResolvedValue(24);

      (bookletRepository.createQueryBuilder as jest.Mock).mockReturnValue(bookletsQb);
      (unitRepository.createQueryBuilder as jest.Mock).mockReturnValue(unitsQb);

      const result = await service.getImportStatistics(1);

      expect(result).toEqual({
        persons: 15,
        booklets: 8,
        units: 24
      });
    });

    it('should return zero values when no data exists', async () => {
      (personsRepository.count as jest.Mock).mockResolvedValue(0);

      const qb = mockQueryBuilder();
      qb.getCount.mockResolvedValue(0);

      (bookletRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);
      (unitRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const result = await service.getImportStatistics(1);

      expect(result).toEqual({
        persons: 0,
        booklets: 0,
        units: 0
      });
    });

    it('should handle database errors gracefully', async () => {
      (personsRepository.count as jest.Mock).mockRejectedValue(new Error('DB Error'));

      const result = await service.getImportStatistics(1);

      expect(result).toEqual({
        persons: 0,
        booklets: 0,
        units: 0
      });
    });
  });
});
