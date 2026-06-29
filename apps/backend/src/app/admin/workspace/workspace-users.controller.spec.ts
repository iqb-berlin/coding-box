import {
  BadRequestException,
  ExecutionContext,
  INestApplication,
  InternalServerErrorException
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceUsersController } from './workspace-users.controller';
import { WorkspaceUsersService } from '../../database/services/workspace/workspace-users.service';
import { AuthService } from '../../auth/service/auth.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { AccessLevelGuard } from './access-level.guard';

type WorkspaceUsersServiceMock = jest.Mocked<Pick<WorkspaceUsersService, 'findUsers' | 'findCoders' | 'setWorkspaceUsers'>>;

describe('WorkspaceUsersController', () => {
  let controller: WorkspaceUsersController;
  let workspaceUsersService: WorkspaceUsersServiceMock;
  let authService: jest.Mocked<Pick<AuthService, 'createToken' | 'createTokenForUserId'>>;

  beforeEach(() => {
    workspaceUsersService = {
      findUsers: jest.fn(),
      findCoders: jest.fn(),
      setWorkspaceUsers: jest.fn()
    };
    authService = {
      createToken: jest.fn(),
      createTokenForUserId: jest.fn()
    };

    controller = new WorkspaceUsersController(
      workspaceUsersService as unknown as WorkspaceUsersService,
      authService as unknown as AuthService
    );
  });

  async function createTestApp(): Promise<INestApplication> {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspaceUsersController],
      providers: [
        {
          provide: WorkspaceUsersService,
          useValue: workspaceUsersService
        },
        {
          provide: AuthService,
          useValue: authService
        }
      ]
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().user = { id: 12 };
          return true;
        }
      })
      .overrideGuard(WorkspaceGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AccessLevelGuard)
      .useValue({ canActivate: () => true })
      .compile();

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

    it('creates a token for the authenticated user with validated duration', async () => {
      authService.createTokenForUserId.mockResolvedValue('"token"');

      await expect(
        controller.createOwnToken(7, '1', ['replay:read', 'replay-statistics:write'], { user: { id: 12 } })
      ).resolves.toBe('"token"');

      expect(authService.createTokenForUserId).toHaveBeenCalledWith(
        12,
        7,
        1,
        ['replay:read', 'replay-statistics:write']
      );
      expect(authService.createToken).not.toHaveBeenCalled();
    });

    it('rejects self-service tokens without explicit scopes', async () => {
      await expect(
        controller.createOwnToken(7, '1', undefined, { user: { id: 12 } })
      ).rejects.toThrow(BadRequestException);

      expect(authService.createTokenForUserId).not.toHaveBeenCalled();
    });

    it.each(['0', '-1', '1.5', '2', 'abc'])(
      'rejects invalid self-service token duration %s',
      async duration => {
        await expect(
          controller.createOwnToken(7, duration, ['replay:read'], { user: { id: 12 } })
        ).rejects.toThrow(BadRequestException);

        expect(authService.createTokenForUserId).not.toHaveBeenCalled();
      }
    );

    it('creates a self-service token over HTTP with repeated scope query params', async () => {
      authService.createTokenForUserId.mockResolvedValue('"token"');
      let app: INestApplication | undefined;

      try {
        app = await createTestApp();

        const response = await fetch(
          `${await app.getUrl()}/admin/workspace/7/token/1?scopes=replay:read&scopes=replay-statistics:write`
        );

        expect(response.status).toBe(200);
        await expect(response.text()).resolves.toBe('"token"');
        expect(authService.createTokenForUserId).toHaveBeenCalledWith(
          12,
          7,
          1,
          ['replay:read', 'replay-statistics:write']
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

    it.each(['0', '-1', '1.5', '2', 'abc'])(
      'rejects invalid token duration %s',
      async duration => {
        await expect(
          controller.createToken('identity-1', 7, duration, ['replay:read'], { user: { id: 12 } })
        ).rejects.toThrow(BadRequestException);

        expect(authService.createToken).not.toHaveBeenCalled();
      }
    );
  });

  describe('findUsers', () => {
    it('throws when workspace users cannot be retrieved', async () => {
      workspaceUsersService.findUsers.mockRejectedValue(new Error('database unavailable'));

      await expect(controller.findUsers(3, 1, 500)).rejects.toThrow(InternalServerErrorException);
    });

    it('parses the workspace id from the route before retrieving users', async () => {
      workspaceUsersService.findUsers.mockResolvedValue([[], 0]);
      let app: INestApplication | undefined;

      try {
        app = await createTestApp();

        const response = await fetch(`${await app.getUrl()}/admin/workspace/3/users?page=1&limit=500`);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          data: [],
          total: 0,
          page: 1,
          limit: 500
        });
        expect(workspaceUsersService.findUsers).toHaveBeenCalledWith(3, { page: 1, limit: 500 });
      } finally {
        await app?.close();
      }
    });

    it('returns an HTTP error when workspace users cannot be retrieved', async () => {
      workspaceUsersService.findUsers.mockRejectedValue(new Error('database unavailable'));
      let app: INestApplication | undefined;

      try {
        app = await createTestApp();

        const response = await fetch(`${await app.getUrl()}/admin/workspace/3/users?page=1&limit=500`);

        expect(response.status).toBe(500);
      } finally {
        await app?.close();
      }
    });
  });

  describe('findCoders', () => {
    it('parses the workspace id from the route before retrieving coders', async () => {
      workspaceUsersService.findCoders.mockResolvedValue([[], 0]);
      let app: INestApplication | undefined;

      try {
        app = await createTestApp();

        const response = await fetch(`${await app.getUrl()}/admin/workspace/3/coders`);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          data: [],
          total: 0
        });
        expect(workspaceUsersService.findCoders).toHaveBeenCalledWith(3);
      } finally {
        await app?.close();
      }
    });
  });

  describe('findCodersByCodingJob', () => {
    it('rejects a non-numeric coding job id', async () => {
      workspaceUsersService.findCoders.mockResolvedValue([[], 0]);
      let app: INestApplication | undefined;

      try {
        app = await createTestApp();

        const response = await fetch(`${await app.getUrl()}/admin/workspace/3/coding-jobs/not-a-number/coders`);

        expect(response.status).toBe(400);
        expect(workspaceUsersService.findCoders).not.toHaveBeenCalled();
      } finally {
        await app?.close();
      }
    });
  });

  describe('setWorkspaceUsers', () => {
    it('delegates workspace user assignment', async () => {
      workspaceUsersService.setWorkspaceUsers.mockResolvedValue(true);

      await expect(controller.setWorkspaceUsers([7, 8], 3)).resolves.toBe(true);

      expect(workspaceUsersService.setWorkspaceUsers).toHaveBeenCalledWith(3, [7, 8]);
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
        expect(workspaceUsersService.setWorkspaceUsers).toHaveBeenCalledWith(3, [7, 8]);
      } finally {
        await app?.close();
      }
    });
  });
});
