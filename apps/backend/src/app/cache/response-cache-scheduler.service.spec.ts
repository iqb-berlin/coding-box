import { Logger } from '@nestjs/common';
import { MoreThan } from 'typeorm';
import { ResponseCacheSchedulerService } from './response-cache-scheduler.service';

jest.mock('libxmljs2', () => ({}));

describe('ResponseCacheSchedulerService', () => {
  const booklet = {
    id: 1001,
    login: 'login-a',
    code: 'code-a',
    group: 'group-a',
    bookletName: 'BOOKLET-A'
  };
  const unit = {
    id: 21,
    bookletId: booklet.id,
    name: 'UNIT-NAME',
    alias: 'UNIT-ALIAS'
  };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const createService = () => {
    const cacheService = {
      generateUnitResponseCacheKey: jest.fn((workspaceId: number, connector: string, unitId: string) => (
        `responses:${workspaceId}:${connector}:${unitId}`
      )),
      exists: jest.fn().mockResolvedValue(false),
      set: jest.fn().mockResolvedValue(true)
    };
    const workspaceTestResultsService = {
      findUnitResponse: jest.fn().mockResolvedValue({ responses: [] })
    };
    const personsRepository = {
      find: jest.fn().mockResolvedValue([{ id: 10 }]),
      createQueryBuilder: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([{ workspace_id: 47 }])
      })
    };
    const bookletQuery = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([booklet])
    };
    const bookletRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(bookletQuery)
    };
    const unitQuery = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([unit])
    };
    const unitRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(unitQuery)
    };

    const service = new ResponseCacheSchedulerService(
      cacheService as never,
      workspaceTestResultsService as never,
      personsRepository as never,
      bookletRepository as never,
      unitRepository as never
    );

    return {
      service,
      cacheService,
      workspaceTestResultsService,
      personsRepository,
      bookletQuery,
      unitQuery
    };
  };

  it('warms grouped and legacy response cache keys for unit names and aliases', async () => {
    const {
      service,
      cacheService,
      workspaceTestResultsService
    } = createService();

    await service.cacheAllResponses();

    expect(cacheService.generateUnitResponseCacheKey).toHaveBeenCalledWith(
      47,
      'login-a@code-a@group-a@BOOKLET-A',
      'UNIT-NAME'
    );
    expect(cacheService.generateUnitResponseCacheKey).toHaveBeenCalledWith(
      47,
      'login-a@code-a@group-a@BOOKLET-A',
      'UNIT-ALIAS'
    );
    expect(cacheService.generateUnitResponseCacheKey).toHaveBeenCalledWith(
      47,
      'login-a@code-a@BOOKLET-A',
      'UNIT-NAME'
    );
    expect(cacheService.generateUnitResponseCacheKey).toHaveBeenCalledWith(
      47,
      'login-a@code-a@BOOKLET-A',
      'UNIT-ALIAS'
    );
    expect(cacheService.exists).toHaveBeenCalledTimes(4);
    expect(cacheService.exists).toHaveBeenCalledWith('responses:47:login-a@code-a@group-a@BOOKLET-A:UNIT-NAME:v8');
    expect(workspaceTestResultsService.findUnitResponse).toHaveBeenCalledTimes(4);
  });

  it('projects only warmup columns and caches each page before loading the next one', async () => {
    const {
      service, cacheService, workspaceTestResultsService, personsRepository, bookletQuery, unitQuery
    } = createService();
    const personIds = Array.from({ length: 100 }, (_, i) => i + 1);
    personsRepository.find
      .mockResolvedValueOnce(personIds.map(id => ({ id })))
      .mockResolvedValueOnce([{ id: 105 }]);
    const firstBookletPage = Array.from({ length: 100 }, (_, i) => ({ ...booklet, id: booklet.id + i, group: '' }));
    bookletQuery.getRawMany
      .mockResolvedValueOnce(firstBookletPage)
      .mockResolvedValueOnce([{
        ...booklet, id: 1101, bookletName: 'BOOKLET-B', group: ''
      }])
      .mockResolvedValueOnce([{
        ...booklet, id: 1201, login: 'login-b', group: ''
      }]);
    const firstUnitPage = Array.from({ length: 500 }, (_, i) => ({
      ...unit, id: i + 501, alias: unit.name
    }));
    const cachedKeys = new Set(['responses:47:login-a@code-a@BOOKLET-A:ALREADY-CACHED:v8']);
    cacheService.exists.mockImplementation(async key => cachedKeys.has(key));
    cacheService.set.mockImplementation(async key => {
      cachedKeys.add(key);
      return true;
    });
    unitQuery.getRawMany
      .mockResolvedValueOnce(firstUnitPage)
      .mockResolvedValueOnce([
        { ...firstUnitPage[0], id: 1001 },
        {
          ...unit, id: 42, bookletId: 1002, name: 'ALREADY-CACHED', alias: null
        },
        {
          ...unit, id: 43, bookletId: 1002, name: 'NEXT-BOOKLET-IN-PAGE', alias: null
        }
      ])
      .mockResolvedValueOnce([{
        ...unit, id: 5, bookletId: 1101, alias: null
      }])
      .mockResolvedValueOnce([{
        ...unit, id: 6, bookletId: 1201, name: 'NEXT-PERSON', alias: null
      }]);

    await service.cacheAllResponses();

    expect(personsRepository.find).toHaveBeenCalledTimes(2);
    expect(personsRepository.find).toHaveBeenNthCalledWith(1, {
      select: { id: true },
      where: { workspace_id: 47, consider: true },
      order: { id: 'ASC' },
      take: 100
    });
    expect(personsRepository.find).toHaveBeenNthCalledWith(2, {
      select: { id: true },
      where: { workspace_id: 47, consider: true, id: MoreThan(100) },
      order: { id: 'ASC' },
      take: 100
    });
    expect(bookletQuery.select).toHaveBeenCalledWith('booklet.id', 'id');
    expect(bookletQuery.addSelect.mock.calls.slice(0, 4)).toEqual([
      ['person.login', 'login'], ['person.code', 'code'], ['person.group', 'group'],
      ['bookletInfo.name', 'bookletName']
    ]);
    expect(bookletQuery.where).toHaveBeenNthCalledWith(1, 'booklet.personid IN (:...personIds)', { personIds });
    expect(bookletQuery.where).toHaveBeenNthCalledWith(3, 'booklet.personid IN (:...personIds)', { personIds: [105] });
    expect(bookletQuery.andWhere).toHaveBeenCalledWith('booklet.id > :afterBookletId', { afterBookletId: 1100 });
    expect(bookletQuery.orderBy).toHaveBeenCalledWith('booklet.id', 'ASC');
    expect(bookletQuery.limit).toHaveBeenCalledWith(100);
    expect(bookletQuery.getRawMany).toHaveBeenCalledTimes(3);
    expect(unitQuery.select).toHaveBeenCalledWith('unit.id', 'id');
    expect(unitQuery.addSelect.mock.calls.slice(0, 3)).toEqual([
      ['CAST(unit.bookletid AS integer)', 'bookletId'], ['unit.name', 'name'], ['unit.alias', 'alias']
    ]);
    expect(unitQuery.where).toHaveBeenNthCalledWith(1, 'unit.bookletid IN (:...bookletIds)', {
      bookletIds: firstBookletPage.map(row => row.id)
    });
    expect(unitQuery.where).toHaveBeenNthCalledWith(3, 'unit.bookletid IN (:...bookletIds)', { bookletIds: [1101] });
    expect(unitQuery.where).toHaveBeenNthCalledWith(4, 'unit.bookletid IN (:...bookletIds)', { bookletIds: [1201] });
    expect(unitQuery.andWhere.mock.calls).toEqual([[
      '(unit.bookletid, unit.id) > (:afterBookletId, :afterUnitId)', { afterBookletId: 1001, afterUnitId: 1000 }
    ]]);
    expect(unitQuery.orderBy).toHaveBeenCalledWith('unit.bookletid', 'ASC');
    expect(unitQuery.addOrderBy).toHaveBeenCalledWith('unit.id', 'ASC');
    expect(unitQuery.limit).toHaveBeenCalledWith(500);
    expect(unitQuery.getRawMany).toHaveBeenCalledTimes(4);
    expect(cacheService.set.mock.invocationCallOrder[0]).toBeLessThan(unitQuery.getRawMany.mock.invocationCallOrder[1]);
    expect(workspaceTestResultsService.findUnitResponse.mock.calls).toEqual([
      [47, 'login-a@code-a@BOOKLET-A', 'UNIT-NAME'],
      [47, 'login-a@code-a@BOOKLET-A', 'NEXT-BOOKLET-IN-PAGE'],
      [47, 'login-a@code-a@BOOKLET-B', 'UNIT-NAME'],
      [47, 'login-b@code-a@BOOKLET-A', 'NEXT-PERSON']
    ]);
  });
});
