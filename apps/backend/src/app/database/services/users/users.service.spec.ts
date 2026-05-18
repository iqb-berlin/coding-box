import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';

const createRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(value => ({ id: 77, ...value })),
  save: jest.fn(value => Promise.resolve({ id: 77, ...value })),
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
    workspaceUserRepository.find.mockResolvedValue([{ userId: 2, accessLevel: 3 }]);
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
      isAdmin: false
    }]);
  });

  it('updates access and checks workspace access', async () => {
    workspaceUserRepository.findOne
      .mockResolvedValueOnce({ userId: 1, workspaceId: 2 })
      .mockResolvedValueOnce(null);
    usersRepository.findOne.mockResolvedValueOnce({ id: 3, isAdmin: true });

    await expect(service.updateUsersAccess(2, [{ id: 1, username: 'a', accessLevel: 2 } as never])).resolves.toBe(true);
    expect(workspaceUserRepository.update).toHaveBeenCalledWith({ workspaceId: 2, userId: 1 }, { accessLevel: 2 });
    await expect(service.canAccessWorkSpace(1, 2)).resolves.toBe(true);
    await expect(service.canAccessWorkSpace(3, 2)).resolves.toBe(true);
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
    workspaceUserRepository.save.mockResolvedValueOnce([{ userId: 1, workspaceId: 2, accessLevel: 3 }]);

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

  it('handles admin checks and keycloak users', async () => {
    usersRepository.findOne
      .mockResolvedValueOnce({ isAdmin: true })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 10, username: 'u', identity: 'old', issuer: 'iss', isAdmin: false
      })
      .mockResolvedValueOnce(null);

    await expect(service.getUserIsAdmin(1)).resolves.toBe(true);
    await expect(service.getUserIsAdmin(2)).resolves.toBe(false);
    await expect(service.createKeycloakUser({
      username: 'u', identity: 'new', issuer: 'iss', isAdmin: true
    } as never)).resolves.toBe(10);
    expect(usersRepository.update).toHaveBeenCalledWith({ id: 10 }, { identity: 'new', isAdmin: true });
    await expect(service.createKeycloakUser({
      username: 'fresh', identity: 'id', issuer: 'iss', isAdmin: false
    } as never)).resolves.toBe(77);
  });
});
