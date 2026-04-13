import {
  Test, TestingModule
} from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { AuthService } from '../auth/service/auth.service';
import { UsersService } from '../database/services/users';

describe('AdminGuard (Backend)', () => {
  let guard: AdminGuard;
  let authService: jest.Mocked<AuthService>;
  let usersService: jest.Mocked<UsersService>;

  beforeEach(async () => {
    const mockAuthService = {
      isAdminUser: jest.fn()
    };
    const mockUsersService = {
      findUserByIdentity: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminGuard,
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

    guard = module.get<AdminGuard>(AdminGuard);
    authService = module.get(AuthService);
    usersService = module.get(UsersService);
  });

  const createMockExecutionContext = (userId: string, isAdmin = false): ExecutionContext => ({
    switchToHttp: () => ({
      getRequest: () => ({
        user: { id: userId, isAdmin }
      })
    })
  } as unknown as ExecutionContext);

  describe('Security Validation - Admin Access', () => {
    it('should allow access directly from JWT admin claim', async () => {
      const context = createMockExecutionContext('oidc-admin', true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(usersService.findUserByIdentity).not.toHaveBeenCalled();
      expect(authService.isAdminUser).not.toHaveBeenCalled();
    });

    it('should allow access for admin user', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.isAdminUser.mockResolvedValue(true);
      const context = createMockExecutionContext('oidc-1');

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(usersService.findUserByIdentity).toHaveBeenCalledWith('oidc-1');
      expect(authService.isAdminUser).toHaveBeenCalledWith(1);
    });

    it('should deny access for non-admin user', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 2 } as never);
      authService.isAdminUser.mockResolvedValue(false);
      const context = createMockExecutionContext('oidc-2');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow('Admin privileges required');
      expect(usersService.findUserByIdentity).toHaveBeenCalledWith('oidc-2');
      expect(authService.isAdminUser).toHaveBeenCalledWith(2);
    });

    it('should resolve database user ID from request identity', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 42 } as never);
      authService.isAdminUser.mockResolvedValue(true);
      const context = createMockExecutionContext('4fecd283-bd64-4930-aee8-07e58df323bf');

      await guard.canActivate(context);

      expect(usersService.findUserByIdentity).toHaveBeenCalledWith('4fecd283-bd64-4930-aee8-07e58df323bf');
      expect(authService.isAdminUser).toHaveBeenCalledWith(42);
    });
  });

  describe('Security Validation - Request Structure', () => {
    it('should handle missing user object', async () => {
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({})
        })
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow('User not found');
    });

    it('should handle missing user ID', async () => {
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: {}
          })
        })
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow('User not found');
    });

    it('should handle null user', async () => {
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: null
          })
        })
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow('User not found');
    });

    it('should handle undefined user', async () => {
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: undefined
          })
        })
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow('User not found');
    });

    it('should reject when identity is not mapped to a database user', async () => {
      usersService.findUserByIdentity.mockResolvedValue(null);
      const context = createMockExecutionContext('missing-oidc-user');

      await expect(guard.canActivate(context)).rejects.toThrow('User not found');
      expect(authService.isAdminUser).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero database user ID', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 0 } as never);
      authService.isAdminUser.mockResolvedValue(false);
      const context = createMockExecutionContext('oidc-zero');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(authService.isAdminUser).toHaveBeenCalledWith(0);
    });

    it('should handle negative database user ID', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: -1 } as never);
      authService.isAdminUser.mockResolvedValue(false);
      const context = createMockExecutionContext('oidc-negative');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(authService.isAdminUser).toHaveBeenCalledWith(-1);
    });

    it('should handle very large database user ID', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: Number.MAX_SAFE_INTEGER } as never);
      authService.isAdminUser.mockResolvedValue(true);
      const context = createMockExecutionContext('oidc-large');

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(authService.isAdminUser).toHaveBeenCalledWith(Number.MAX_SAFE_INTEGER);
    });

    it('should handle UUID identity values', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 123 } as never);
      const context = createMockExecutionContext('123e4567-e89b-12d3-a456-426614174000');
      authService.isAdminUser.mockResolvedValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(usersService.findUserByIdentity).toHaveBeenCalledWith('123e4567-e89b-12d3-a456-426614174000');
      expect(authService.isAdminUser).toHaveBeenCalledWith(123);
    });
  });

  describe('Security - Service Errors', () => {
    it('should propagate auth service errors', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.isAdminUser.mockRejectedValue(new Error('Database error'));
      const context = createMockExecutionContext('oidc-1');

      await expect(guard.canActivate(context)).rejects.toThrow('Database error');
    });

    it('should handle auth service async response', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.isAdminUser.mockResolvedValue(false);
      const context = createMockExecutionContext('oidc-1');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle auth service returning null', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.isAdminUser.mockResolvedValue(null as unknown as boolean);
      const context = createMockExecutionContext('oidc-1');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle auth service returning undefined', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.isAdminUser.mockResolvedValue(undefined as unknown as boolean);
      const context = createMockExecutionContext('oidc-1');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('Security - Privilege Escalation Prevention', () => {
    it('should not cache admin status between requests', async () => {
      const context1 = createMockExecutionContext('oidc-1');
      const context2 = createMockExecutionContext('oidc-2');

      usersService.findUserByIdentity.mockResolvedValueOnce({ id: 1 } as never);
      usersService.findUserByIdentity.mockResolvedValueOnce({ id: 2 } as never);
      authService.isAdminUser.mockResolvedValueOnce(true);
      authService.isAdminUser.mockResolvedValueOnce(false);

      await guard.canActivate(context1);
      await expect(guard.canActivate(context2)).rejects.toThrow(UnauthorizedException);

      expect(authService.isAdminUser).toHaveBeenCalledTimes(2);
    });

    it('should always verify admin status from auth service', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.isAdminUser.mockResolvedValue(true);
      const context = createMockExecutionContext('oidc-1');

      await guard.canActivate(context);
      await guard.canActivate(context);
      await guard.canActivate(context);

      expect(authService.isAdminUser).toHaveBeenCalledTimes(3);
    });

    it('should not allow access if isAdminUser returns false even once', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.isAdminUser.mockResolvedValue(false);
      const context = createMockExecutionContext('oidc-1');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('Error Messages', () => {
    it('should provide clear error message for unauthorized access', async () => {
      usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
      authService.isAdminUser.mockResolvedValue(false);
      const context = createMockExecutionContext('oidc-1');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow('Admin privileges required');
    });
  });
});
