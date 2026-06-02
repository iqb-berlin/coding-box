import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { WorkspaceUsersController } from './workspace-users.controller';
import { WorkspaceUsersService } from '../../database/services/workspace/workspace-users.service';
import { AuthService } from '../../auth/service/auth.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { AccessLevelGuard } from './access-level.guard';

describe('WorkspaceUsersController', () => {
  let controller: WorkspaceUsersController;
  let authService: jest.Mocked<Pick<AuthService, 'createToken' | 'createTokenForUserId'>>;

  beforeEach(() => {
    authService = {
      createToken: jest.fn(),
      createTokenForUserId: jest.fn()
    };

    controller = new WorkspaceUsersController(
      {} as WorkspaceUsersService,
      authService as unknown as AuthService
    );
  });

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
        controller.createOwnToken(7, '30', { user: { id: 12 } })
      ).resolves.toBe('"token"');

      expect(authService.createTokenForUserId).toHaveBeenCalledWith(12, 7, 30);
      expect(authService.createToken).not.toHaveBeenCalled();
    });

    it.each(['0', '-1', '1.5', '91', 'abc'])(
      'rejects invalid self-service token duration %s',
      async duration => {
        await expect(
          controller.createOwnToken(7, duration, { user: { id: 12 } })
        ).rejects.toThrow(BadRequestException);

        expect(authService.createTokenForUserId).not.toHaveBeenCalled();
      }
    );
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
        controller.createToken('identity-1', 7, '30', { user: { id: 12 } })
      ).resolves.toBe('"token"');

      expect(authService.createToken).toHaveBeenCalledWith('identity-1', 7, 30, 12);
    });

    it.each(['0', '-1', '1.5', '91', 'abc'])(
      'rejects invalid token duration %s',
      async duration => {
        await expect(
          controller.createToken('identity-1', 7, duration, { user: { id: 12 } })
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
