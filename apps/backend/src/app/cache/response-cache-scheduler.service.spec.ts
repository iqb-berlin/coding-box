import { Logger } from '@nestjs/common';
import { MoreThan } from 'typeorm';
import { ResponseCacheSchedulerService } from './response-cache-scheduler.service';

jest.mock('libxmljs2', () => ({}));

describe('ResponseCacheSchedulerService', () => {
  const unit = {
    id: 21,
    name: 'UNIT-NAME',
    alias: 'UNIT-ALIAS',
    login: 'login-a',
    code: 'code-a',
    group: 'group-a',
    bookletName: 'BOOKLET-A'
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
    const unitQuery = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
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
      unitRepository as never
    );

    return {
      service,
      cacheService,
      workspaceTestResultsService,
      personsRepository,
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
    expect(cacheService.exists).toHaveBeenCalledWith('responses:47:login-a@code-a@group-a@BOOKLET-A:UNIT-NAME:v7');
    expect(workspaceTestResultsService.findUnitResponse).toHaveBeenCalledTimes(4);
  });

  it('projects only warmup columns and caches each page before loading the next one', async () => {
    const {
      service, cacheService, workspaceTestResultsService, personsRepository, unitQuery
    } = createService();
    const personIds = Array.from({ length: 100 }, (_, i) => i + 1);
    personsRepository.find
      .mockResolvedValueOnce(personIds.map(id => ({ id })))
      .mockResolvedValueOnce([{ id: 105 }]);
    const firstUnitPage = Array.from({ length: 500 }, (_, i) => ({
      ...unit, id: i + 1, alias: unit.name, group: ''
    }));
    const cachedKeys = new Set(['responses:47:login-a@code-a@BOOKLET-A:ALREADY-CACHED:v7']);
    cacheService.exists.mockImplementation(async key => cachedKeys.has(key));
    cacheService.set.mockImplementation(async key => {
      cachedKeys.add(key);
      return true;
    });
    unitQuery.getRawMany
      .mockResolvedValueOnce(firstUnitPage)
      .mockResolvedValueOnce([
        { ...firstUnitPage[0], id: 501 },
        {
          ...firstUnitPage[0], id: 502, name: 'ALREADY-CACHED', alias: null
        }
      ])
      .mockResolvedValueOnce([
        {
          ...unit, id: 550, name: 'NEXT-PERSON', alias: null, group: ''
        }
      ]);

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
    expect(unitQuery.select).toHaveBeenCalledWith('unit.id', 'id');
    expect(unitQuery.addSelect.mock.calls.slice(0, 6)).toEqual([
      ['unit.name', 'name'], ['unit.alias', 'alias'],
      ['person.login', 'login'], ['person.code', 'code'], ['person.group', 'group'],
      ['bookletInfo.name', 'bookletName']
    ]);
    expect(unitQuery.where).toHaveBeenNthCalledWith(1, 'booklet.personid IN (:...personIds)', { personIds });
    expect(unitQuery.where).toHaveBeenNthCalledWith(3, 'booklet.personid IN (:...personIds)', { personIds: [105] });
    expect(unitQuery.andWhere).toHaveBeenCalledWith('unit.id > :afterUnitId', { afterUnitId: 500 });
    expect(unitQuery.orderBy).toHaveBeenCalledWith('unit.id', 'ASC');
    expect(unitQuery.limit).toHaveBeenCalledWith(500);
    expect(unitQuery.getRawMany).toHaveBeenCalledTimes(3);
    expect(cacheService.set.mock.invocationCallOrder[0]).toBeLessThan(unitQuery.getRawMany.mock.invocationCallOrder[1]);
    expect(workspaceTestResultsService.findUnitResponse.mock.calls).toEqual([
      [47, 'login-a@code-a@BOOKLET-A', 'UNIT-NAME'],
      [47, 'login-a@code-a@BOOKLET-A', 'NEXT-PERSON']
    ]);
  });
});
