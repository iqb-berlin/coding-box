import { BadRequestException } from '@nestjs/common';
import { AdminWorkspaceNotFoundException } from '../../../exceptions/admin-workspace-not-found.exception';
import Workspace from '../../entities/workspace.entity';
import WorkspaceUser from '../../entities/workspace_user.entity';
import { WorkspaceCoreService } from './workspace-core.service';

const createRepo = () => ({
  find: jest.fn(),
  findAndCount: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(value => ({ id: 9, ...value })),
  save: jest.fn(value => Promise.resolve({ id: 9, ...value }))
});

describe('WorkspaceCoreService', () => {
  let repo: ReturnType<typeof createRepo>;
  let cacheService: { delete: jest.Mock; deleteByPattern: jest.Mock; incr: jest.Mock };
  let workspaceTestResultsService: { invalidateWorkspaceStatsCache: jest.Mock };
  let queryRunner: {
    connect: jest.Mock;
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
    manager: { delete: jest.Mock };
  };
  let managerSave: jest.Mock;
  let service: WorkspaceCoreService;

  beforeEach(() => {
    repo = createRepo();
    cacheService = {
      delete: jest.fn(),
      deleteByPattern: jest.fn(),
      incr: jest.fn().mockResolvedValue(1)
    };
    workspaceTestResultsService = { invalidateWorkspaceStatsCache: jest.fn() };
    queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: { delete: jest.fn().mockResolvedValue({ affected: 1 }) }
    };
    managerSave = jest.fn((entity: unknown, value: object) => {
      if (entity === Workspace) {
        return Promise.resolve({ id: 9, ...value });
      }
      return Promise.resolve(value);
    });
    service = new WorkspaceCoreService(
      repo as never,
      {
        createQueryRunner: () => queryRunner,
        transaction: (callback: (manager: { save: jest.Mock }) => Promise<unknown>) => callback({ save: managerSave })
      } as never,
      cacheService as never,
      workspaceTestResultsService as never
    );
    jest.spyOn((service as unknown as { logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock } }).logger, 'log').mockImplementation(jest.fn());
    jest.spyOn((service as unknown as { logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock } }).logger, 'warn').mockImplementation(jest.fn());
    jest.spyOn((service as unknown as { logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock } }).logger, 'error').mockImplementation(jest.fn());
  });

  it('lists and loads workspaces', async () => {
    repo.findAndCount.mockResolvedValueOnce([[{ id: 1, name: 'A' }], 1]);
    repo.find.mockResolvedValueOnce([{ id: 2, name: 'B' }]);
    repo.findOne.mockResolvedValueOnce({ id: 1, name: 'A', settings: { ignoredUnits: ['U'] } });

    await expect(service.findAll({ page: 0, limit: 50000 })).resolves.toEqual([[{ id: 1, name: 'A' }], 1]);
    await expect(service.findAll()).resolves.toEqual([[{ id: 2, name: 'B' }], 1]);
    await expect(service.findOne(1)).resolves.toEqual({ id: 1, name: 'A', settings: { ignoredUnits: ['U'] } });
  });

  it('throws when a workspace is missing', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(service.findOne(99)).rejects.toBeInstanceOf(AdminWorkspaceNotFoundException);
  });

  it('creates, patches and removes workspaces', async () => {
    repo.findOne.mockResolvedValueOnce({ id: 1, name: 'Old', settings: {} });

    await expect(service.create({ name: 'New' } as never, 5)).resolves.toBe(9);
    expect(managerSave).toHaveBeenCalledWith(WorkspaceUser, {
      workspaceId: 9,
      userId: 5,
      accessLevel: 3,
      canCode: false
    });
    await expect(service.patch({ id: 1, name: 'Patched', settings: { a: true } } as never)).resolves.toBeUndefined();
    expect(cacheService.delete).toHaveBeenCalled();
    expect(workspaceTestResultsService.invalidateWorkspaceStatsCache).toHaveBeenCalledWith(1);
    await expect(service.remove([])).resolves.toBeUndefined();
    await expect(service.remove([1])).resolves.toBeUndefined();
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
  });

  it('rejects workspace creation without a valid creator user id', async () => {
    await expect(service.create({ name: 'New' } as never, 0)).rejects.toBeInstanceOf(BadRequestException);
    expect(managerSave).not.toHaveBeenCalled();
  });

  it('rolls back failed removals', async () => {
    queryRunner.manager.delete.mockRejectedValueOnce(new Error('db down'));

    await expect(service.remove([1])).rejects.toThrow('db down');
    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
  });

  it('gets and sets ignored units and settings', async () => {
    jest.spyOn(service, 'findOne')
      .mockResolvedValueOnce({ id: 1, name: 'A', settings: { ignoredUnits: ['U1'] } } as never)
      .mockResolvedValueOnce({ id: 1, name: 'A', settings: { theme: 'dark' } } as never);
    repo.findOne
      .mockResolvedValueOnce({ id: 1, settings: {} })
      .mockResolvedValueOnce({ id: 1, settings: { a: true } })
      .mockResolvedValueOnce(null);

    await expect(service.getIgnoredUnits(1)).resolves.toEqual(['U1']);
    await expect(service.setIgnoredUnits(1, ['U2'])).resolves.toBeUndefined();
    await expect(service.getWorkspaceSettings(1)).resolves.toEqual({ theme: 'dark' });
    await expect(service.setWorkspaceSettings(1, { b: true } as never)).resolves.toBeUndefined();
    await expect(service.setWorkspaceSettings(99, { b: true } as never)).rejects.toBeInstanceOf(AdminWorkspaceNotFoundException);
    expect(workspaceTestResultsService.invalidateWorkspaceStatsCache).toHaveBeenCalledWith(1);
    expect(cacheService.delete).toHaveBeenCalledWith('coding-statistics:schema-v4:1:v1');
    expect(cacheService.delete).toHaveBeenCalledWith('coding-statistics:schema-v4:1:v2');
    expect(cacheService.delete).toHaveBeenCalledWith('coding-statistics:schema-v4:1:v3');
    expect(cacheService.incr).toHaveBeenCalledWith('coding_incomplete_variables_version:1');
    expect(cacheService.delete).toHaveBeenCalledWith('coding_incomplete_variables_v8:1');
    expect(cacheService.delete).toHaveBeenCalledWith('coding_incomplete_variables_scope_v1:1');
    expect(cacheService.delete).toHaveBeenCalledWith('flat_response_filter_options:version:1');
    expect(cacheService.deleteByPattern).toHaveBeenCalledWith('response-analysis:1_*');
    expect(cacheService.deleteByPattern).toHaveBeenCalledWith('responses:1:*');
    expect(cacheService.deleteByPattern).toHaveBeenCalledWith('flat_response_filter_options:1:*');
  });
});
