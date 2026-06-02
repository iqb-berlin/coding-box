import { ResponseCacheSchedulerService } from './response-cache-scheduler.service';

jest.mock('libxmljs2', () => ({}));

describe('ResponseCacheSchedulerService', () => {
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
      find: jest.fn().mockResolvedValue([
        {
          id: 10,
          login: 'login-a',
          code: 'code-a',
          group: 'group-a',
          workspace_id: 47,
          consider: true
        }
      ]),
      createQueryBuilder: jest.fn()
    };
    const unitRepository = {
      createQueryBuilder: jest.fn().mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            name: 'UNIT-NAME',
            alias: 'UNIT-ALIAS',
            booklet: {
              personid: 10,
              bookletinfo: {
                name: 'BOOKLET-A'
              }
            }
          }
        ])
      })
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
      workspaceTestResultsService
    };
  };

  it('warms grouped and legacy response cache keys for unit names and aliases', async () => {
    const {
      service,
      cacheService,
      workspaceTestResultsService
    } = createService();

    await (service as unknown as {
      processWorkspace: (workspaceId: number) => Promise<void>
    }).processWorkspace(47);

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
    expect(workspaceTestResultsService.findUnitResponse).toHaveBeenCalledTimes(4);
  });
});
