import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { UsersController } from './users.controller';
import { AuthService } from '../../auth/service/auth.service';
import { UsersService } from '../../database/services/users';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: ReturnType<typeof createMock<UsersService>>;
  let authService: ReturnType<typeof createMock<AuthService>>;

  beforeEach(async () => {
    usersService = createMock<UsersService>();
    authService = createMock<AuthService>();
    // 1 = nonmember, 2 = coder, 3 = study manager of workspace 3, 4 = admin.
    authService.isAdminUser.mockImplementation(userId => Promise.resolve(userId === 4));
    authService.canAccessWorkSpace.mockImplementation((userId, workspaceId) => Promise.resolve(
      userId === 4 || (workspaceId === 3 && [2, 3].includes(userId))
    ));
    usersService.getUserIsAdmin.mockImplementation(userId => Promise.resolve(userId === 4));
    usersService.getUserAccessLevel.mockImplementation(async (userId, workspaceId) => {
      if (workspaceId !== 3) return null;
      if (userId === 2) return 1;
      return userId === 3 ? 3 : null;
    });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: AuthService,
          useValue: authService
        },
        {
          provide: UsersService,
          useValue: usersService
        }

      ]
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  async function createTestApp(): Promise<INestApplication> {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: AuthService,
          useValue: authService
        },
        {
          provide: UsersService,
          useValue: usersService
        }
      ]
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const request = context.switchToHttp().getRequest();
          request.user = { id: Number(request.headers['x-test-user-id'] || 4) };
          return true;
        }
      })
      .compile();

    const app = module.createNestApplication();
    await app.init();
    await app.listen(0);
    return app;
  }

  describe('workspace access', () => {
    it('parses the workspace id when retrieving user access', async () => {
      usersService.getUsersWithWorkspaceAccess.mockResolvedValue([]);
      let app: INestApplication | undefined;

      try {
        app = await createTestApp();

        const response = await fetch(`${await app.getUrl()}/admin/users/access/3`);

        expect(response.status).toBe(200);
        expect(usersService.getUsersWithWorkspaceAccess).toHaveBeenCalledWith(3);
      } finally {
        await app?.close();
      }
    });

    it('parses the workspace id when updating user access', async () => {
      usersService.updateUsersAccess.mockResolvedValue(true);
      const payload = [{ id: 5, accessLevel: 1, canCode: true }];
      let app: INestApplication | undefined;

      try {
        app = await createTestApp();

        const response = await fetch(`${await app.getUrl()}/admin/users/access/3`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toBe(true);
        expect(usersService.updateUsersAccess).toHaveBeenCalledWith(3, payload);
      } finally {
        await app?.close();
      }
    });
  });

  describe('user workspaces', () => {
    it('parses the user id when retrieving workspaces', async () => {
      usersService.getUserWorkspaces.mockResolvedValue([2, 3]);
      let app: INestApplication | undefined;

      try {
        app = await createTestApp();

        const response = await fetch(`${await app.getUrl()}/admin/users/5/workspaces`);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual([2, 3]);
        expect(usersService.getUserWorkspaces).toHaveBeenCalledWith(5);
      } finally {
        await app?.close();
      }
    });
  });

  describe('updateUser', () => {
    it('parses the user id before delegating', async () => {
      const payload = { id: 5, username: 'updated-user', isAdmin: false };
      usersService.updateUser.mockResolvedValue(payload);
      let app: INestApplication | undefined;

      try {
        app = await createTestApp();

        const response = await fetch(`${await app.getUrl()}/admin/users/5`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual(payload);
        expect(usersService.updateUser).toHaveBeenCalledWith(5, payload);
      } finally {
        await app?.close();
      }
    });
  });

  describe('assignUserWorkspaces', () => {
    it('parses the user id from the route before delegating', async () => {
      usersService.assignUserWorkspaces.mockResolvedValue(true);
      let app: INestApplication | undefined;

      try {
        app = await createTestApp();

        const response = await fetch(`${await app.getUrl()}/admin/users/5/workspaces`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([2, 3])
        });

        expect(response.status).toBe(201);
        await expect(response.json()).resolves.toBe(true);
        expect(usersService.assignUserWorkspaces).toHaveBeenCalledWith(5, [2, 3]);
      } finally {
        await app?.close();
      }
    });
  });

  describe('authorization through real HTTP and permission guards', () => {
    const globalOperations = [
      { method: 'GET', route: '/full', service: 'getAllUsers' },
      { method: 'GET', route: '/2/workspaces', service: 'getUserWorkspaces' },
      {
        method: 'PATCH', route: '/2', body: { id: 2, isAdmin: true }, service: 'updateUser'
      },
      {
        method: 'POST', route: '', body: { username: 'admin', isAdmin: true }, service: 'create'
      },
      { method: 'DELETE', route: '/2', service: 'removeIds' },
      { method: 'DELETE', route: '?id=2', service: 'removeIds' },
      {
        method: 'POST', route: '/2/workspaces', body: [3], service: 'assignUserWorkspaces'
      }
    ] as const;

    it.each([1, 2, 3].flatMap(userId => globalOperations.map(operation => ({
      userId, ...operation
    }))))('denies user $userId global $method $route before mutation', async operation => {
      const app = await createTestApp();
      try {
        const body = 'body' in operation ? operation.body : undefined;
        const response = await fetch(`${await app.getUrl()}/admin/users${operation.route}`, {
          method: operation.method,
          headers: { 'content-type': 'application/json', 'x-test-user-id': String(operation.userId) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });

        expect(response.status).toBe(401);
        expect(await response.json()).toMatchObject({ message: 'Admin privileges required' });
        expect(usersService[operation.service]).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });

    it('does not expose workspace members to an unrelated authenticated user', async () => {
      const app = await createTestApp();
      try {
        const response = await fetch(`${await app.getUrl()}/admin/users/access/3`, {
          headers: { 'x-test-user-id': '1' }
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([]);
        expect(usersService.getUsersWithWorkspaceAccess).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });

    it('keeps workspace member reads needed to resolve coder route permissions', async () => {
      usersService.getUsersWithWorkspaceAccess.mockResolvedValue([
        {
          id: 2, name: 'coder', username: 'coder', accessLevel: 1, canCode: true, isAdmin: false
        }
      ]);
      const app = await createTestApp();
      try {
        const response = await fetch(`${await app.getUrl()}/admin/users/access/3`, {
          headers: { 'x-test-user-id': '2' }
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([
          expect.objectContaining({ id: 2, accessLevel: 1, canCode: true })
        ]);
        expect(usersService.getUsersWithWorkspaceAccess).toHaveBeenCalledWith(3);
      } finally {
        await app.close();
      }
    });

    it.each([
      { userId: 1, workspaceId: 3 },
      { userId: 2, workspaceId: 3 },
      { userId: 3, workspaceId: 4 }
    ])('denies user $userId changing access in workspace $workspaceId', async ({ userId, workspaceId }) => {
      const app = await createTestApp();
      try {
        const response = await fetch(`${await app.getUrl()}/admin/users/access/${workspaceId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', 'x-test-user-id': String(userId) },
          body: JSON.stringify([{ id: userId, accessLevel: 3, canCode: true }])
        });

        expect(response.status).toBe(401);
        expect(usersService.updateUsersAccess).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });

    it.each([3, 4])('allows authorized user $userId to manage workspace access', async userId => {
      const payload = [{ id: 2, accessLevel: 1, canCode: true }];
      usersService.updateUsersAccess.mockResolvedValue(true);
      const app = await createTestApp();
      try {
        const response = await fetch(`${await app.getUrl()}/admin/users/access/3`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', 'x-test-user-id': String(userId) },
          body: JSON.stringify(payload)
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toBe(true);
        expect(usersService.updateUsersAccess).toHaveBeenCalledWith(3, payload);
      } finally {
        await app.close();
      }
    });

    it.each([3, 4])('lets user $userId select users without exposing global admin flags', async userId => {
      usersService.getAllUsers.mockResolvedValue([{ id: 2, username: 'coder', isAdmin: false }]);
      const app = await createTestApp();
      try {
        const response = await fetch(`${await app.getUrl()}/admin/users/directory/3`, {
          headers: { 'x-test-user-id': String(userId) }
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([{ id: 2, username: 'coder' }]);
      } finally {
        await app.close();
      }
    });

    it.each([
      { userId: 1, workspaceId: 3 },
      { userId: 2, workspaceId: 3 },
      { userId: 3, workspaceId: 4 }
    ])('denies user $userId the directory of workspace $workspaceId', async ({ userId, workspaceId }) => {
      const app = await createTestApp();
      try {
        const response = await fetch(`${await app.getUrl()}/admin/users/directory/${workspaceId}`, {
          headers: { 'x-test-user-id': String(userId) }
        });

        expect(response.status).toBe(401);
        expect(usersService.getAllUsers).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });
  });
});
