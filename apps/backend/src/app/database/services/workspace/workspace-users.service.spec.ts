import { WorkspaceUsersService } from './workspace-users.service';

const createRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  save: jest.fn(),
  delete: jest.fn()
});

describe('WorkspaceUsersService', () => {
  let workspaceUsersRepository: ReturnType<typeof createRepo>;
  let usersRepository: ReturnType<typeof createRepo>;
  let workspacesRepository: ReturnType<typeof createRepo>;
  let service: WorkspaceUsersService;

  beforeEach(() => {
    workspaceUsersRepository = createRepo();
    usersRepository = createRepo();
    workspacesRepository = createRepo();
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

  it('creates workspace memberships without enabling coding by default', async () => {
    workspaceUsersRepository.save.mockResolvedValue([{ userId: 11 }]);

    await expect(service.setWorkspaceUsers(3, [11])).resolves.toBe(true);
    expect(workspaceUsersRepository.save).toHaveBeenCalledWith([{
      userId: 11,
      workspaceId: 3,
      accessLevel: 3,
      canCode: false
    }]);
  });
});
