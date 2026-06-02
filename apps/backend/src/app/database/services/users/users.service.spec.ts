import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';

const createRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(value => ({ id: 77, ...value })),
  save: jest.fn(value => Promise.resolve({ id: 77, ...value })),
  upsert: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  count: jest.fn()
});

describe('UsersService', () => {
  let usersRepository: ReturnType<typeof createRepo>;
  let workspaceUserRepository: ReturnType<typeof createRepo>;
  let service: UsersService;

  beforeEach(() => {
    usersRepository = createRepo();
    workspaceUserRepository = createRepo();
    service = new UsersService(usersRepository as never, workspaceUserRepository as never);
    jest.spyOn((service as unknown as { logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock } }).logger, 'log').mockImplementation(jest.fn());
    jest.spyOn((service as unknown as { logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock } }).logger, 'warn').mockImplementation(jest.fn());
    jest.spyOn((service as unknown as { logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock } }).logger, 'error').mockImplementation(jest.fn());
  });

  it('lists users with and without workspace filters', async () => {
    workspaceUserRepository.find.mockResolvedValue([{ userId: 2, accessLevel: 3, canCode: true }]);
    usersRepository.find.mockResolvedValue([
      { id: 1, username: 'alice', isAdmin: true },
      { id: 2, username: 'bob', isAdmin: false }
    ]);

    await expect(service.getAllUsers(10)).resolves.toEqual([{ id: 2, username: 'bob', isAdmin: false }]);
    await expect(service.getUsersWithWorkspaceAccess(10)).resolves.toEqual([{
      id: 2,
      name: 'bob',
      username: 'bob',
      accessLevel: 3,
      canCode: true,
      isAdmin: false
    }]);
  });

  it('returns workspace access with explicit and legacy canCode values', async () => {
    workspaceUserRepository.find.mockResolvedValue([
      { userId: 1, accessLevel: 1 },
      { userId: 2, accessLevel: 1, canCode: false },
      { userId: 3, accessLevel: 2, canCode: true },
      { userId: 4, accessLevel: 3, canCode: false }
    ]);
    usersRepository.find.mockResolvedValue([
      { id: 1, username: 'legacy-coder', isAdmin: false },
      { id: 2, username: 'level-one-without-coding', isAdmin: false },
      { id: 3, username: 'coding-manager-coder', isAdmin: false },
      { id: 4, username: 'study-manager-no-coding', isAdmin: false }
    ]);

    await expect(service.getUsersWithWorkspaceAccess(10)).resolves.toEqual([
      expect.objectContaining({
        id: 1,
        accessLevel: 1,
        canCode: true
      }),
      expect.objectContaining({
        id: 2,
        accessLevel: 1,
        canCode: false
      }),
      expect.objectContaining({
        id: 3,
        accessLevel: 2,
        canCode: true
      }),
      expect.objectContaining({
        id: 4,
        accessLevel: 3,
        canCode: false
      })
    ]);
  });

  it('updates access and checks workspace access', async () => {
    workspaceUserRepository.findOne
      .mockResolvedValueOnce({ userId: 1, workspaceId: 2 })
      .mockResolvedValueOnce(null);
    usersRepository.findOne.mockResolvedValueOnce({ id: 3, isAdmin: true });

    await expect(service.updateUsersAccess(2, [
      { id: 1, username: 'a', accessLevel: 2 },
      {
        id: 2, username: 'b', accessLevel: 1, canCode: false
      },
      {
        id: 3, username: 'c', accessLevel: 0, canCode: true
      }
    ] as never)).resolves.toBe(true);
    expect(workspaceUserRepository.upsert).toHaveBeenCalledWith([
      {
        workspaceId: 2,
        userId: 1,
        accessLevel: 2,
        canCode: false
      },
      {
        workspaceId: 2,
        userId: 2,
        accessLevel: 1,
        canCode: false
      }
    ], ['workspaceId', 'userId']);
    expect(workspaceUserRepository.delete).toHaveBeenCalledWith({
      workspaceId: 2,
      userId: expect.any(Object)
    });
    await expect(service.canAccessWorkSpace(1, 2)).resolves.toBe(true);
    await expect(service.canAccessWorkSpace(3, 2)).resolves.toBe(true);
  });

  it('defaults canCode from accessLevel only when requests omit it', async () => {
    await expect(service.updateUsersAccess(2, [
      { id: 1, username: 'legacy-coder', accessLevel: 1 },
      {
        id: 2, username: 'level-one-without-coding', accessLevel: 1, canCode: false
      },
      {
        id: 3, username: 'coding-manager-coder', accessLevel: 2, canCode: true
      },
      { id: 4, username: 'study-manager-no-coding', accessLevel: 3 },
      {
        id: 5, username: 'no-access-with-coding-flag', accessLevel: 0, canCode: true
      }
    ] as never)).resolves.toBe(true);

    expect(workspaceUserRepository.upsert).toHaveBeenCalledWith([
      {
        workspaceId: 2,
        userId: 1,
        accessLevel: 1,
        canCode: true
      },
      {
        workspaceId: 2,
        userId: 2,
        accessLevel: 1,
        canCode: false
      },
      {
        workspaceId: 2,
        userId: 3,
        accessLevel: 2,
        canCode: true
      },
      {
        workspaceId: 2,
        userId: 4,
        accessLevel: 3,
        canCode: false
      }
    ], ['workspaceId', 'userId']);
    expect(workspaceUserRepository.delete).toHaveBeenCalledWith({
      workspaceId: 2,
      userId: expect.any(Object)
    });
  });

  it('recreates workspace access after it was removed', async () => {
    await expect(service.updateUsersAccess(2, [
      {
        id: 3, username: 'c', accessLevel: 0, canCode: false
      }
    ] as never)).resolves.toBe(true);

    expect(workspaceUserRepository.delete).toHaveBeenCalledWith({
      workspaceId: 2,
      userId: expect.any(Object)
    });

    workspaceUserRepository.delete.mockClear();
    workspaceUserRepository.upsert.mockClear();

    await expect(service.updateUsersAccess(2, [
      {
        id: 3, username: 'c', accessLevel: 3, canCode: true
      }
    ] as never)).resolves.toBe(true);

    expect(workspaceUserRepository.delete).not.toHaveBeenCalled();
    expect(workspaceUserRepository.upsert).toHaveBeenCalledWith([
      {
        workspaceId: 2,
        userId: 3,
        accessLevel: 3,
        canCode: true
      }
    ], ['workspaceId', 'userId']);
  });

  it('rejects invalid workspace access payloads before writing', async () => {
    await expect(service.updateUsersAccess(2, [
      { id: 1, username: 'a', accessLevel: 1 },
      { id: 1, username: 'a-again', accessLevel: 2 }
    ] as never)).rejects.toBeInstanceOf(BadRequestException);

    await expect(service.updateUsersAccess(2, [
      { id: 2, username: 'bad-level', accessLevel: 4 }
    ] as never)).rejects.toBeInstanceOf(BadRequestException);

    expect(workspaceUserRepository.delete).not.toHaveBeenCalled();
    expect(workspaceUserRepository.upsert).not.toHaveBeenCalled();
  });

  it('asserts users are enabled as coders in a workspace', async () => {
    workspaceUserRepository.find.mockResolvedValueOnce([{ userId: 1 }, { userId: 2 }]);

    await expect(service.assertUsersCanCodeInWorkspace([1, 2, 1], 7)).resolves.toBeUndefined();
    expect(workspaceUserRepository.find).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        workspaceId: 7,
        canCode: true,
        accessLevel: expect.any(Object)
      }),
      select: ['userId']
    }));

    workspaceUserRepository.find.mockResolvedValueOnce([{ userId: 1 }]);
    await expect(service.assertUsersCanCodeInWorkspace([1, 2], 7)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('checks whether a single user is enabled as coder in a workspace', async () => {
    workspaceUserRepository.findOne.mockResolvedValueOnce({ userId: 1 });

    await expect(service.canUserCodeInWorkspace(1, 7)).resolves.toBe(true);
    expect(workspaceUserRepository.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        workspaceId: 7,
        userId: 1,
        accessLevel: expect.any(Object),
        canCode: true
      }),
      select: ['userId']
    }));

    workspaceUserRepository.findOne.mockResolvedValueOnce(null);
    await expect(service.canUserCodeInWorkspace(2, 7)).resolves.toBe(false);
    await expect(service.canUserCodeInWorkspace(0, 7)).resolves.toBe(false);
  });

  it('returns access levels, workspace ids and users by identity or id', async () => {
    workspaceUserRepository.findOne.mockResolvedValueOnce({ accessLevel: 2 });
    workspaceUserRepository.find.mockResolvedValueOnce([{ workspaceId: 3 }, { workspaceId: 4 }]);
    usersRepository.findOne
      .mockResolvedValueOnce({ id: 5, username: 'user', isAdmin: false })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 6, username: 'by-id', isAdmin: true })
      .mockResolvedValueOnce(null);

    await expect(service.getUserAccessLevel(1, 2)).resolves.toBe(2);
    await expect(service.getUserWorkspaces(1)).resolves.toEqual([3, 4]);
    await expect(service.findUserByIdentity('id')).resolves.toEqual({ id: 5, username: 'user', isAdmin: false });
    await expect(service.findUserByIdentity('missing')).resolves.toBeNull();
    await expect(service.findUserById(6)).resolves.toEqual({ id: 6, username: 'by-id', isAdmin: true });
    await expect(service.findUserById(999)).resolves.toBeNull();
  });

  it('updates, creates and removes users', async () => {
    usersRepository.findOne.mockResolvedValueOnce({ id: 1, username: 'old' });
    usersRepository.save.mockResolvedValueOnce({ id: 1, username: 'new', isAdmin: true });

    await expect(service.updateUser(1, { id: 1, username: 'new', isAdmin: true } as never)).resolves.toEqual({ id: 1, username: 'new', isAdmin: true });
    await expect(service.create({ username: 'created' } as never)).resolves.toBe(77);
    await expect(service.remove(1)).resolves.toBeUndefined();
    expect(usersRepository.delete).toHaveBeenCalledWith(1);
  });

  it('assigns workspaces and validates deletion constraints', async () => {
    workspaceUserRepository.findOne.mockResolvedValueOnce({ userId: 1 });
    workspaceUserRepository.save.mockResolvedValueOnce([{
      userId: 1,
      workspaceId: 2,
      accessLevel: 3,
      canCode: false
    }]);

    await expect(service.assignUserWorkspaces(1, [2])).resolves.toBe(true);
    expect(workspaceUserRepository.delete).toHaveBeenCalledWith({ userId: 1 });

    await expect(service.removeIds([], 1)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.removeIds([1], 1)).rejects.toBeInstanceOf(ForbiddenException);
    usersRepository.count.mockResolvedValueOnce(2);
    await expect(service.removeIds([2, 3], 1)).rejects.toBeInstanceOf(ForbiddenException);
    usersRepository.count.mockResolvedValueOnce(5);
    await expect(service.removeIds([2], 1)).resolves.toBeUndefined();
  });

  it('creates existing and new local users', async () => {
    usersRepository.findOne
      .mockResolvedValueOnce({ id: 4, username: 'same' })
      .mockResolvedValueOnce(null);

    await expect(service.createUser({ username: 'same' } as never)).resolves.toBe(4);
    await expect(service.createUser({ username: 'new' } as never)).resolves.toBe(77);
  });

  it('handles admin checks and OIDC provider users', async () => {
    usersRepository.findOne
      .mockResolvedValueOnce({ isAdmin: true })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 10, username: 'u', identity: 'old', issuer: 'iss', isAdmin: false
      })
      .mockResolvedValueOnce(null);

    await expect(service.getUserIsAdmin(1)).resolves.toBe(true);
    await expect(service.getUserIsAdmin(2)).resolves.toBe(false);
    await expect(service.createOidcProviderUser({
      username: 'u', identity: 'new', issuer: 'iss', isAdmin: true
    } as never)).resolves.toBe(10);
    expect(usersRepository.update).toHaveBeenCalledWith({ id: 10 }, { identity: 'new', isAdmin: true });
    await expect(service.createOidcProviderUser({
      username: 'fresh', identity: 'id', issuer: 'iss', isAdmin: false
    } as never)).resolves.toBe(77);
  });

  it('does not demote existing database admins during OIDC login', async () => {
    usersRepository.findOne.mockResolvedValueOnce({
      id: 10, username: 'u', identity: 'old', issuer: 'iss', isAdmin: true
    });

    await expect(service.createOidcProviderUser({
      username: 'u', identity: 'new', issuer: 'iss', isAdmin: false
    } as never)).resolves.toBe(10);

    expect(usersRepository.update).toHaveBeenCalledWith({ id: 10 }, { identity: 'new' });
  });
});
