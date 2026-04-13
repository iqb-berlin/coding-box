import {
  Test, TestingModule
} from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WorkspaceGuard } from './workspace.guard';
import { AuthService } from '../../auth/service/auth.service';
import { UsersService } from '../../database/services/users';

describe('WorkspaceGuard (Backend)', () => {
  let guard: WorkspaceGuard;
  let authService: jest.Mocked<AuthService>;
  let usersService: jest.Mocked<UsersService>;

  beforeEach(async () => {
    const mockAuthService = {
      canAccessWorkSpace: jest.fn()
    };
    const mockUsersService = {
      findUserByIdentity: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceGuard,
        Reflector,
        {
          provide: AuthService,
          useValue: mockAuthService
        },
        {
          provide: UsersService,
          useValue: mockUsersService
        }
      ]
    }).compile();

    guard = module.get<WorkspaceGuard>(WorkspaceGuard);
    authService = module.get(AuthService);
    usersService = module.get(UsersService);
  });

  const createMockExecutionContext = (userId: string, workspaceId: string): ExecutionContext => ({
    switchToHttp: () => ({
      getRequest: () => ({
        user: {
          id: userId,
          ...(tokenWorkspaceId === undefined ? {} : { workspace: tokenWorkspaceId }),
          ...userOverrides
        },
        params: { workspace_id: workspaceId }
      })
    }),
    getHandler: () => handler,
    getClass: () => class TestController {}
  } as unknown as ExecutionContext);

  describe('Security Validation - Workspace Access', () => {
    it('should allow access when user can access workspace', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.canAccessWorkSpace.mockResolvedValue(true);
      const context = createMockExecutionContext('oidc-1', '123');

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(authService.canAccessWorkSpace).toHaveBeenCalledWith(1, 123);
    });

    it('should deny access when user cannot access workspace', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.canAccessWorkSpace.mockResolvedValue(false);
      const context = createMockExecutionContext('oidc-1', '123');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(authService.canAccessWorkSpace).toHaveBeenCalledWith(1, 123);
    });

    it('should validate both user ID and workspace ID', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 42 } as never);
      authService.canAccessWorkSpace.mockResolvedValue(true);
      const context = createMockExecutionContext('oidc-42', '789');

      await guard.canActivate(context);

      expect(authService.canAccessWorkSpace).toHaveBeenCalledWith(42, 789);
    });
  });

  describe('Security Validation - Workspace Isolation', () => {
    it('should prevent access to different workspace', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.canAccessWorkSpace.mockResolvedValue(false);
      const context = createMockExecutionContext('oidc-1', '999');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should verify workspace access for each request', async () => {
      const context1 = createMockExecutionContext('oidc-1', '123');
      const context2 = createMockExecutionContext('oidc-1', '456');

      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.canAccessWorkSpace.mockResolvedValueOnce(true);
      authService.canAccessWorkSpace.mockResolvedValueOnce(false);

      await guard.canActivate(context1);
      await expect(guard.canActivate(context2)).rejects.toThrow(UnauthorizedException);

      expect(authService.canAccessWorkSpace).toHaveBeenCalledTimes(2);
      expect(authService.canAccessWorkSpace).toHaveBeenNthCalledWith(1, 1, 123);
      expect(authService.canAccessWorkSpace).toHaveBeenNthCalledWith(2, 1, 456);
    });

    it('should not allow cross-user workspace access', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 2 } as never);
      authService.canAccessWorkSpace.mockResolvedValue(false);
      const context = createMockExecutionContext('oidc-2', '123');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(authService.canAccessWorkSpace).toHaveBeenCalledWith(2, 123);
    });
  });

  describe('Security Validation - Request Structure', () => {
    it('should handle missing user object', async () => {
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            params: { workspace_id: '123' }
          })
        })
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow();
    });

    it('should handle missing params object', async () => {
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: 'oidc-1' }
          })
        })
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow();
    });

    it('should handle missing workspace_id in params', async () => {
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: 'oidc-1' },
            params: {}
          })
        })
      } as unknown as ExecutionContext;

      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.canAccessWorkSpace.mockResolvedValue(false);

      await expect(guard.canActivate(context)).rejects.toThrow();
    });

    it('should handle null user', async () => {
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: null,
            params: { workspace_id: '123' }
          })
        })
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow();
    });

    it('should handle undefined user', async () => {
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: undefined,
            params: { workspace_id: '123' }
          })
        })
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow();
    });
  });

  describe('Edge Cases - Workspace ID Formats', () => {
    it('should handle numeric workspace ID', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.canAccessWorkSpace.mockResolvedValue(true);
      const context = createMockExecutionContext('oidc-1', '123');

      await guard.canActivate(context);

      expect(authService.canAccessWorkSpace).toHaveBeenCalledWith(1, 123);
    });

    it('should handle string workspace ID', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.canAccessWorkSpace.mockResolvedValue(true);
      const context = createMockExecutionContext('oidc-1', 'workspace-abc');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);

      expect(authService.canAccessWorkSpace).not.toHaveBeenCalled();
    });

    it('should handle zero workspace ID', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.canAccessWorkSpace.mockResolvedValue(false);
      const context = createMockExecutionContext('oidc-1', '0');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(authService.canAccessWorkSpace).not.toHaveBeenCalled();
    });

    it('should handle negative workspace ID', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.canAccessWorkSpace.mockResolvedValue(false);
      const context = createMockExecutionContext('oidc-1', '-1');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(authService.canAccessWorkSpace).not.toHaveBeenCalled();
    });

    it('should handle very large workspace ID', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.canAccessWorkSpace.mockResolvedValue(true);
      const context = createMockExecutionContext('oidc-1', '999999999999');

      await guard.canActivate(context);

      expect(authService.canAccessWorkSpace).toHaveBeenCalledWith(1, 999999999999);
    });

    it('should handle workspace ID with special characters', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.canAccessWorkSpace.mockResolvedValue(false);
      const context = createMockExecutionContext('oidc-1', 'ws-123-abc');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(authService.canAccessWorkSpace).not.toHaveBeenCalled();
    });

    it.each(['1e2', '0x10', '1.5', '123abc', '00123'])(
      'should reject ambiguous workspace ID format %s',
      async workspaceId => {
        const context = createMockExecutionContext(1, workspaceId);

        await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
        expect(authService.canAccessWorkSpace).not.toHaveBeenCalled();
      }
    );

    it('should accept a matching workspace claim', async () => {
      authService.canAccessWorkSpace.mockResolvedValue(true);
      const context = createMockExecutionContext(1, '123', 123);

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(authService.canAccessWorkSpace).toHaveBeenCalledWith(1, 123);
    });

    it('should reject a mismatching workspace claim before service lookup', async () => {
      const context = createMockExecutionContext(1, '123', 456);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(authService.canAccessWorkSpace).not.toHaveBeenCalled();
    });

    it('should reject ambiguous token workspace claims before service lookup', async () => {
      const context = createMockExecutionContext(1, '123', '1e2');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(authService.canAccessWorkSpace).not.toHaveBeenCalled();
    });
  });

  describe('Security Validation - Workspace API Token Scopes', () => {
    const createScopedHandler = () => {
      const handler = jest.fn();
      AllowWorkspaceTokenScopes(WORKSPACE_TOKEN_SCOPE_REPLAY_READ)(handler);
      return handler;
    };

    const createCodingScopedHandler = () => {
      const handler = jest.fn();
      AllowWorkspaceTokenScopes(WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE)(handler);
      return handler;
    };

    it('should reject workspace API tokens for endpoints without allowed scopes', async () => {
      const context = createMockExecutionContext(
        1,
        '123',
        123,
        {
          tokenType: WORKSPACE_API_TOKEN_TYPE,
          scopes: [WORKSPACE_TOKEN_SCOPE_REPLAY_READ]
        }
      );

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(authService.canAccessWorkSpace).not.toHaveBeenCalled();
    });

    it('should allow workspace API tokens when the endpoint allows the token scope', async () => {
      authService.canAccessWorkSpace.mockResolvedValue(true);
      const context = createMockExecutionContext(
        1,
        '123',
        123,
        {
          tokenType: WORKSPACE_API_TOKEN_TYPE,
          scopes: [WORKSPACE_TOKEN_SCOPE_REPLAY_READ]
        },
        createScopedHandler()
      );

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(authService.canAccessWorkSpace).toHaveBeenCalledWith(1, 123);
    });

    it('should reject workspace API tokens with a missing required scope', async () => {
      const context = createMockExecutionContext(
        1,
        '123',
        123,
        {
          tokenType: WORKSPACE_API_TOKEN_TYPE,
          scopes: [WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE]
        },
        createScopedHandler()
      );

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(authService.canAccessWorkSpace).not.toHaveBeenCalled();
    });

    it('should reject replay-only workspace API tokens for coding job endpoints', async () => {
      const context = createMockExecutionContext(
        1,
        '123',
        123,
        {
          tokenType: WORKSPACE_API_TOKEN_TYPE,
          scopes: [WORKSPACE_TOKEN_SCOPE_REPLAY_READ]
        },
        createCodingScopedHandler()
      );

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(authService.canAccessWorkSpace).not.toHaveBeenCalled();
    });

    it('should reject correctly scoped workspace API tokens for a different workspace', async () => {
      const context = createMockExecutionContext(
        1,
        '123',
        456,
        {
          tokenType: WORKSPACE_API_TOKEN_TYPE,
          scopes: [WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE]
        },
        createCodingScopedHandler()
      );

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(authService.canAccessWorkSpace).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases - User ID Formats', () => {
    it('should handle zero user ID', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 0 } as never);
      authService.canAccessWorkSpace.mockResolvedValue(false);
      const context = createMockExecutionContext('oidc-zero', '123');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(authService.canAccessWorkSpace).toHaveBeenCalledWith(0, 123);
    });

    it('should handle negative user ID', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: -1 } as never);
      authService.canAccessWorkSpace.mockResolvedValue(false);
      const context = createMockExecutionContext('oidc-negative', '123');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(authService.canAccessWorkSpace).toHaveBeenCalledWith(-1, 123);
    });

    it('should handle very large user ID', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: Number.MAX_SAFE_INTEGER } as never);
      authService.canAccessWorkSpace.mockResolvedValue(true);
      const context = createMockExecutionContext('oidc-large', '123');

      await guard.canActivate(context);

      expect(authService.canAccessWorkSpace).toHaveBeenCalledWith(Number.MAX_SAFE_INTEGER, 123);
    });
  });

  describe('Security - Service Errors', () => {
    it('should propagate auth service errors', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.canAccessWorkSpace.mockRejectedValue(new Error('Database error'));
      const context = createMockExecutionContext('oidc-1', '123');

      await expect(guard.canActivate(context)).rejects.toThrow('Database error');
    });

    it('should handle auth service async response', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.canAccessWorkSpace.mockResolvedValue(false);
      const context = createMockExecutionContext('oidc-1', '123');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle auth service returning null', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.canAccessWorkSpace.mockResolvedValue(null as unknown as boolean);
      const context = createMockExecutionContext('oidc-1', '123');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle auth service returning undefined', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.canAccessWorkSpace.mockResolvedValue(undefined as unknown as boolean);
      const context = createMockExecutionContext('oidc-1', '123');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('Security - Privilege Escalation Prevention', () => {
    it('should not cache workspace access between requests', async () => {
      const context1 = createMockExecutionContext('oidc-1', '123');
      const context2 = createMockExecutionContext('oidc-1', '123');

      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.canAccessWorkSpace.mockResolvedValueOnce(true);
      authService.canAccessWorkSpace.mockResolvedValueOnce(false);

      await guard.canActivate(context1);
      await expect(guard.canActivate(context2)).rejects.toThrow(UnauthorizedException);

      expect(authService.canAccessWorkSpace).toHaveBeenCalledTimes(2);
    });

    it('should always verify workspace access from auth service', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.canAccessWorkSpace.mockResolvedValue(true);
      const context = createMockExecutionContext('oidc-1', '123');

      await guard.canActivate(context);
      await guard.canActivate(context);
      await guard.canActivate(context);

      expect(authService.canAccessWorkSpace).toHaveBeenCalledTimes(3);
    });

    it('should verify access for each unique workspace', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.canAccessWorkSpace.mockResolvedValue(true);

      await guard.canActivate(createMockExecutionContext('oidc-1', '123'));
      await guard.canActivate(createMockExecutionContext('oidc-1', '456'));
      await guard.canActivate(createMockExecutionContext('oidc-1', '789'));

      expect(authService.canAccessWorkSpace).toHaveBeenCalledTimes(3);
      expect(authService.canAccessWorkSpace).toHaveBeenNthCalledWith(1, 1, 123);
      expect(authService.canAccessWorkSpace).toHaveBeenNthCalledWith(2, 1, 456);
      expect(authService.canAccessWorkSpace).toHaveBeenNthCalledWith(3, 1, 789);
    });
  });

  describe('Error Messages', () => {
    it('should throw UnauthorizedException for unauthorized access', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.canAccessWorkSpace.mockResolvedValue(false);
      const context = createMockExecutionContext('oidc-1', '123');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });
});
