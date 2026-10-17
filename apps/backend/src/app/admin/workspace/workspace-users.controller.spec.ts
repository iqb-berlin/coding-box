import { BadRequestException, ExecutionContext, INestApplication } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceUsersController } from './workspace-users.controller';
import { WorkspaceUsersService } from '../../database/services/workspace/workspace-users.service';
import { AuthService } from '../../auth/service/auth.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { AccessLevelGuard } from './access-level.guard';
import { UsersService } from '../../database/services/users';

type WorkspaceUsersServiceMock = jest.Mocked<Pick<WorkspaceUsersService, 'findUsers' | 'findCoders' | 'setWorkspaceUsers'>>;

describe('WorkspaceUsersController', () => {
  let controller: WorkspaceUsersController;
  let workspaceUsersService: WorkspaceUsersServiceMock;
  let authService: jest.Mocked<Pick<AuthService,
  'createToken' | 'createTokenForUserId' | 'getWorkspaceTokenPolicy' | 'canAccessWorkSpace'>>;
  let usersService: jest.Mocked<Pick<UsersService, 'getUserIsAdmin' | 'getUserAccessLevel'>>;

  beforeEach(() => {
    workspaceUsersService = {
      findUsers: jest.fn(),
      findCoders: jest.fn(),
      setWorkspaceUsers: jest.fn()
    };
    authService = {
      createToken: jest.fn(),
      createTokenForUserId: jest.fn(),
      canAccessWorkSpace: jest.fn().mockImplementation((userId: number, workspaceId: number) => Promise.resolve(
        userId === 4 || (workspaceId === 3 && [1, 2, 3].includes(userId))
      )),
      getWorkspaceTokenPolicy: jest.fn().mockReturnValue({
        scopes: {
          'replay:read': { maxDurationDays: 90 },
          'replay-statistics:write': { maxDurationDays: 1 },
          'coding-job:operate': { maxDurationDays: 1 }
        }
      })
    };
    usersService = {
      getUserIsAdmin: jest.fn().mockImplementation((userId: number) => Promise.resolve(userId === 4)),
      getUserAccessLevel: jest.fn().mockImplementation((userId: number, workspaceId: number) => Promise.resolve(
        workspaceId === 3 && [1, 2, 3].includes(userId) ? userId : null
      ))
    };

    controller = new WorkspaceUsersController(
      workspaceUsersService as unknown as WorkspaceUsersService,
      authService as unknown as AuthService
    );
  });

  async function createTestApp(enforcePermissions = false): Promise<INestApplication> {
    const builder = Test.createTestingModule({
      controllers: [WorkspaceUsersController],
      providers: [
        {
          provide: WorkspaceUsersService,
          useValue: workspaceUsersService
        },
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
          request.user = { id: Number(request.headers['x-test-user-id'] || 12) };
          return true;
        }
      });
    if (!enforcePermissions) {
      builder.overrideGuard(WorkspaceGuard).useValue({ canActivate: () => true });
      builder.overrideGuard(AccessLevelGuard).useValue({ canActivate: () => true });
    }
    const module: TestingModule = await builder.compile();

    const app = module.createNestApplication();
    await app.init();
    await app.listen(0);
    return app;
  }

  describe('createOwnToken', () => {
    it('requires workspace access without workspace admin access level metadata', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        WorkspaceUsersController.prototype.createOwnToken
      );

      expect(guards).toEqual([JwtAuthGuard, WorkspaceGuard]);
      expect(Reflect.getMetadata('accessLevel', WorkspaceUsersController.prototype.createOwnToken)).toBeUndefined();
    });

    it('returns the workspace token policy', () => {
      expect(controller.getWorkspaceTokenPolicy()).toEqual({
        scopes: {
          'replay:read': { maxDurationDays: 90 },
          'replay-statistics:write': { maxDurationDays: 1 },
          'coding-job:operate': { maxDurationDays: 1 }
        }
      });
      expect(authService.getWorkspaceTokenPolicy).toHaveBeenCalled();
    });

    it('creates a token for the authenticated user with validated duration', async () => {
      authService.createTokenForUserId.mockResolvedValue('"token"');

      await expect(
        controller.createOwnToken(7, '90', ['replay:read'], { user: { id: 12 } })
      ).resolves.toBe('"token"');

      expect(authService.createTokenForUserId).toHaveBeenCalledWith(
        12,
        7,
        90,
        ['replay:read']
      );
      expect(authService.createToken).not.toHaveBeenCalled();
    });

    it('rejects self-service tokens without explicit scopes', async () => {
      await expect(
        controller.createOwnToken(7, '1', undefined, { user: { id: 12 } })
      ).rejects.toThrow(BadRequestException);

      expect(authService.createTokenForUserId).not.toHaveBeenCalled();
    });

    it.each(['0', '-1', '1.5', 'abc'])(
      'rejects invalid self-service token duration %s',
      async duration => {
        await expect(
          controller.createOwnToken(7, duration, ['replay:read'], { user: { id: 12 } })
        ).rejects.toThrow(BadRequestException);

        expect(authService.createTokenForUserId).not.toHaveBeenCalled();
      }
    );

    it('creates a long-lived read-only self-service token over HTTP', async () => {
      authService.createTokenForUserId.mockResolvedValue('"token"');
      let app: INestApplication | undefined;

      try {
        app = await createTestApp();

        const response = await fetch(
          `${await app.getUrl()}/admin/workspace/7/token/90?scopes=replay:read`
        );

        expect(response.status).toBe(200);
        await expect(response.text()).resolves.toBe('"token"');
        expect(authService.createTokenForUserId).toHaveBeenCalledWith(
          12,
          7,
          90,
          ['replay:read']
        );
      } finally {
        await app?.close();
      }
    });

    it('rejects a self-service token HTTP request without scopes', async () => {
      let app: INestApplication | undefined;

      try {
        app = await createTestApp();

        const response = await fetch(`${await app.getUrl()}/admin/workspace/7/token/1`);

        expect(response.status).toBe(400);
        expect(authService.createTokenForUserId).not.toHaveBeenCalled();
      } finally {
        await app?.close();
      }
    });
  });

  describe('createToken', () => {
    it('requires workspace admin access level metadata', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        WorkspaceUsersController.prototype.createToken
      );

      expect(guards).toEqual([JwtAuthGuard, WorkspaceGuard, AccessLevelGuard]);
      expect(Reflect.getMetadata('accessLevel', WorkspaceUsersController.prototype.createToken)).toBe(3);
    });

    it('creates a token with validated duration and requester user id', async () => {
      authService.createToken.mockResolvedValue('"token"');

      await expect(
        controller.createToken('identity-1', 7, '1', ['coding-job:operate'], { user: { id: 12 } })
      ).resolves.toBe('"token"');

      expect(authService.createToken).toHaveBeenCalledWith(
        'identity-1',
        7,
        1,
        ['coding-job:operate'],
        12
      );
    });

    it('rejects admin-created tokens with unsupported scopes', async () => {
      await expect(
        controller.createToken('identity-1', 7, '1', ['replay:read', 'admin:all'], { user: { id: 12 } })
      ).rejects.toThrow(BadRequestException);

      expect(authService.createToken).not.toHaveBeenCalled();
    });

    it.each(['0', '-1', '1.5', 'abc'])(
      'rejects invalid token duration %s',
      async duration => {
        await expect(
          controller.createToken('identity-1', 7, duration, ['replay:read'], { user: { id: 12 } })
        ).rejects.toThrow(BadRequestException);

        expect(authService.createToken).not.toHaveBeenCalled();
      }
    );
  });

  describe('setWorkspaceUsers', () => {
    it('requires workspace admin access level metadata and uses workspace_id route param', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        WorkspaceUsersController.prototype.setWorkspaceUsers
      );

      expect(guards).toEqual([JwtAuthGuard, WorkspaceGuard, AccessLevelGuard]);
      expect(Reflect.getMetadata('accessLevel', WorkspaceUsersController.prototype.setWorkspaceUsers)).toBe(3);
      expect(Reflect.getMetadata(PATH_METADATA, WorkspaceUsersController.prototype.setWorkspaceUsers)).toBe(':workspace_id/users');
    });

    it.each([
      { userId: 1, workspaceId: 3 },
      { userId: 2, workspaceId: 3 },
      { userId: 3, workspaceId: 4 },
      { userId: 5, workspaceId: 3 }
    ])('denies user $userId changing membership in workspace $workspaceId', async ({ userId, workspaceId }) => {
      const app = await createTestApp(true);
      try {
        const response = await fetch(`${await app.getUrl()}/admin/workspace/${workspaceId}/users`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-test-user-id': String(userId) },
          body: JSON.stringify([userId, 7])
        });

        expect(response.status).toBe(401);
        expect(workspaceUsersService.setWorkspaceUsers).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });

    it.each([3, 4])('preserves user $userId authorized membership management', async userId => {
      workspaceUsersService.setWorkspaceUsers.mockResolvedValue(true);
      const app = await createTestApp(true);
      try {
        const response = await fetch(`${await app.getUrl()}/admin/workspace/3/users`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-test-user-id': String(userId) },
          body: JSON.stringify([7, 8])
        });

        expect(response.status).toBe(201);
        expect(await response.json()).toBe(true);
        expect(workspaceUsersService.setWorkspaceUsers).toHaveBeenCalledWith(3, [7, 8], userId);
      } finally {
        await app.close();
      }
    });

    it('delegates workspace user assignment', async () => {
      workspaceUsersService.setWorkspaceUsers.mockResolvedValue(true);

      await expect(controller.setWorkspaceUsers([7, 8], 3, { user: { id: 12 } })).resolves.toBe(true);

      expect(workspaceUsersService.setWorkspaceUsers).toHaveBeenCalledWith(3, [7, 8], 12);
    });

    it('parses the workspace id from the route before delegating', async () => {
      workspaceUsersService.setWorkspaceUsers.mockResolvedValue(true);
      let app: INestApplication | undefined;

      try {
        app = await createTestApp();

        const response = await fetch(`${await app.getUrl()}/admin/workspace/3/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([7, 8])
        });

        expect(response.status).toBe(201);
        await expect(response.json()).resolves.toBe(true);
        expect(workspaceUsersService.setWorkspaceUsers).toHaveBeenCalledWith(3, [7, 8], 12);
      } finally {
        await app?.close();
      }
    });
  });
});
