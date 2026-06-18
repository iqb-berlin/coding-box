import User from '../../entities/user.entity';
import Workspace from '../../entities/workspace.entity';
import WorkspaceUser from '../../entities/workspace_user.entity';
import { WorkspaceUsersService } from './workspace-users.service';

const createLockedRowsQuery = (rows: unknown[] = []) => ({
  setLock: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue(rows)
});

const createRepo = () => {
  const repo = {
    createQueryBuilder: jest.fn(() => createLockedRowsQuery()),
    find: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    manager: {
      transaction: jest.fn()
    }
  };
  repo.manager.transaction.mockImplementation(callback => callback({
    getRepository: jest.fn(() => repo)
  }));
  return repo;
};

const mockLockedWorkspaceUsers = (
  workspaceUsersRepository: ReturnType<typeof createRepo>,
  rows: unknown[]
) => {
  workspaceUsersRepository.createQueryBuilder.mockReturnValueOnce(createLockedRowsQuery(rows));
};

describe('WorkspaceUsersService', () => {
  let workspaceUsersRepository: ReturnType<typeof createRepo>;
  let usersRepository: ReturnType<typeof createRepo>;
  let workspacesRepository: ReturnType<typeof createRepo>;
  let service: WorkspaceUsersService;

  beforeEach(() => {
    workspaceUsersRepository = createRepo();
    usersRepository = createRepo();
    workspacesRepository = createRepo();
    const transactionManager = {
      getRepository: jest.fn(entity => {
        if (entity === WorkspaceUser) {
          return workspaceUsersRepository;
        }
        if (entity === User) {
          return usersRepository;
        }
        if (entity === Workspace) {
          return workspacesRepository;
        }
        return workspaceUsersRepository;
      })
    };
    workspaceUsersRepository.manager.transaction.mockImplementation(callback => callback(transactionManager));
    service = new WorkspaceUsersService(
      workspaceUsersRepository as never,
      usersRepository as never,
      workspacesRepository as never
    );
    jest.spyOn((service as unknown as { logger: { log: jest.Mock; error: jest.Mock } }).logger, 'log').mockImplementation(jest.fn());
    jest.spyOn((service as unknown as { logger: { log: jest.Mock; error: jest.Mock } }).logger, 'error').mockImplementation(jest.fn());
  });

  it('finds coders by canCode rather than access level', async () => {
    workspaceUsersRepository.find.mockResolvedValue([
      {
        workspaceId: 3,
        userId: 11,
        accessLevel: 3,
        canCode: true
      }
    ]);
    usersRepository.find.mockResolvedValue([{ id: 11, username: 'manager-coder' }]);

    await expect(service.findCoders(3)).resolves.toEqual([
      [{
        workspaceId: 3,
        userId: 11,
        accessLevel: 3,
        canCode: true,
        username: 'manager-coder'
      }],
      1
    ]);
    expect(workspaceUsersRepository.find).toHaveBeenCalledWith({
      where: {
        workspaceId: 3,
        accessLevel: expect.any(Object),
        canCode: true
      },
      order: { userId: 'ASC' }
    });
  });

  it('finds active coders across coder, coding manager and study manager roles', async () => {
    workspaceUsersRepository.find.mockResolvedValue([
      {
        workspaceId: 3,
        userId: 10,
        accessLevel: 1,
        canCode: true
      },
      {
        workspaceId: 3,
        userId: 11,
        accessLevel: 2,
        canCode: true
      },
      {
        workspaceId: 3,
        userId: 12,
        accessLevel: 3,
        canCode: true
      }
    ]);
    usersRepository.find.mockResolvedValue([
      { id: 10, username: 'coder' },
      { id: 11, username: 'coding-manager' },
      { id: 12, username: 'study-manager' }
    ]);

    await expect(service.findCoders(3)).resolves.toEqual([
      [
        expect.objectContaining({
          userId: 10,
          accessLevel: 1,
          canCode: true,
          username: 'coder'
        }),
        expect.objectContaining({
          userId: 11,
          accessLevel: 2,
          canCode: true,
          username: 'coding-manager'
        }),
        expect.objectContaining({
          userId: 12,
          accessLevel: 3,
          canCode: true,
          username: 'study-manager'
        })
      ],
      3
    ]);
    expect(workspaceUsersRepository.find).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        workspaceId: 3,
        accessLevel: expect.any(Object),
        canCode: true
      }
    }));
  });

  it('lists only users with active workspace access', async () => {
    workspaceUsersRepository.findAndCount.mockResolvedValue([
      [{
        workspaceId: 3,
        userId: 11,
        accessLevel: 3,
        canCode: false
      }],
      1
    ]);

    await expect(service.findUsers(3, { page: 1, limit: 20 })).resolves.toEqual([
      [{
        workspaceId: 3,
        userId: 11,
        accessLevel: 3,
        canCode: false
      }],
      1
    ]);
    expect(workspaceUsersRepository.findAndCount).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        workspaceId: 3,
        accessLevel: expect.any(Object)
      }
    }));
  });

  it('preserves existing workspace memberships and defaults new users to coding access', async () => {
    mockLockedWorkspaceUsers(workspaceUsersRepository, [
      {
        userId: 10,
        workspaceId: 3,
        accessLevel: 3,
        canCode: false
      },
      {
        userId: 12,
        workspaceId: 3,
        accessLevel: 1,
        canCode: true
      }
    ]);
    workspaceUsersRepository.save.mockResolvedValue([{ userId: 10 }, { userId: 11 }]);

    await expect(service.setWorkspaceUsers(3, [10, 11])).resolves.toBe(true);
    expect(workspaceUsersRepository.delete).toHaveBeenCalledWith({
      workspaceId: 3,
      userId: expect.any(Object)
    });
    expect(workspaceUsersRepository.save).toHaveBeenCalledWith([
      {
        userId: 10,
        workspaceId: 3,
        accessLevel: 3,
        canCode: false
      },
      {
        userId: 11,
        workspaceId: 3,
        accessLevel: 1,
        canCode: true
      }
    ]);
  });

  it('rejects workspace memberships without a remaining study manager', async () => {
    mockLockedWorkspaceUsers(workspaceUsersRepository, [
      {
        userId: 10,
        workspaceId: 3,
        accessLevel: 3,
        canCode: false
      }
    ]);

    await expect(service.setWorkspaceUsers(3, [11])).rejects.toThrow('At least one study manager');
    expect(workspaceUsersRepository.delete).not.toHaveBeenCalled();
    expect(workspaceUsersRepository.save).not.toHaveBeenCalled();
  });
});
