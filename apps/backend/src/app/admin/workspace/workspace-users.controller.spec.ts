import { BadRequestException, ExecutionContext, INestApplication } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
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
  let authService: jest.Mocked<Pick<AuthService, 'createToken' | 'createTokenForUserId' | 'getWorkspaceTokenPolicy'>>;

  beforeEach(() => {
    workspaceUsersService = {
      findUsers: jest.fn(),
      findCoders: jest.fn(),
      setWorkspaceUsers: jest.fn()
    };
    authService = {
      createToken: jest.fn(),
      createTokenForUserId: jest.fn(),
      getWorkspaceTokenPolicy: jest.fn().mockReturnValue({
        scopes: {
          'replay:read': { maxDurationDays: 90 },
          'replay-statistics:write': { maxDurationDays: 1 },
          'coding-job:operate': { maxDurationDays: 1 }
        }
      })
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
  });
});
