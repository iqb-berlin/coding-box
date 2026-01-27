import {
  Test, TestingModule
} from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { AuthService } from '../auth/service/auth.service';

describe('AdminGuard (Backend)', () => {
  let guard: AdminGuard;
  let authService: jest.Mocked<AuthService>;

  beforeEach(async () => {
    const mockAuthService = {
      isAdminUser: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminGuard,
        {
          provide: AuthService,
          useValue: mockAuthService
        }
      ]
    }).compile();

    guard = module.get<AdminGuard>(AdminGuard);
    authService = module.get(AuthService);
  });

  const createMockExecutionContext = (userId: number): ExecutionContext => ({
    switchToHttp: () => ({
      getRequest: () => ({
        user: { id: userId }
      })
    })
  } as unknown as ExecutionContext);

  describe('Security Validation - Admin Access', () => {
    it('should allow access for admin user', async () => {
      authService.isAdminUser.mockResolvedValue(true);
      const context = createMockExecutionContext(1);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(authService.isAdminUser).toHaveBeenCalledWith(1);
    });

    it('should deny access for non-admin user', async () => {
      authService.isAdminUser.mockResolvedValue(false);
      const context = createMockExecutionContext(2);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow('Admin privileges required');
      expect(authService.isAdminUser).toHaveBeenCalledWith(2);
    });

    it('should validate user ID from request', async () => {
      authService.isAdminUser.mockResolvedValue(true);
      const context = createMockExecutionContext(42);

      await guard.canActivate(context);

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

      await expect(guard.canActivate(context)).rejects.toThrow();
    });

    it('should handle missing user ID', async () => {
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: {}
          })
        })
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow();
    });

    it('should handle null user', async () => {
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: null
          })
        })
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow();
    });

    it('should handle undefined user', async () => {
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: undefined
          })
        })
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero user ID', async () => {
      authService.isAdminUser.mockResolvedValue(false);
      const context = createMockExecutionContext(0);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(authService.isAdminUser).toHaveBeenCalledWith(0);
    });

    it('should handle negative user ID', async () => {
      authService.isAdminUser.mockResolvedValue(false);
      const context = createMockExecutionContext(-1);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(authService.isAdminUser).toHaveBeenCalledWith(-1);
    });

    it('should handle very large user ID', async () => {
      authService.isAdminUser.mockResolvedValue(true);
      const context = createMockExecutionContext(Number.MAX_SAFE_INTEGER);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(authService.isAdminUser).toHaveBeenCalledWith(Number.MAX_SAFE_INTEGER);
    });

    it('should handle string user ID', async () => {
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: '123' as unknown as number }
          })
        })
      } as unknown as ExecutionContext;

      authService.isAdminUser.mockResolvedValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(authService.isAdminUser).toHaveBeenCalledWith('123');
    });
  });

  describe('Security - Service Errors', () => {
    it('should propagate auth service errors', async () => {
      authService.isAdminUser.mockRejectedValue(new Error('Database error'));
      const context = createMockExecutionContext(1);

      await expect(guard.canActivate(context)).rejects.toThrow('Database error');
    });

    it('should handle auth service async response', async () => {
      authService.isAdminUser.mockResolvedValue(false);
      const context = createMockExecutionContext(1);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle auth service returning null', async () => {
      authService.isAdminUser.mockResolvedValue(null as unknown as boolean);
      const context = createMockExecutionContext(1);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle auth service returning undefined', async () => {
      authService.isAdminUser.mockResolvedValue(undefined as unknown as boolean);
      const context = createMockExecutionContext(1);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('Security - Privilege Escalation Prevention', () => {
    it('should not cache admin status between requests', async () => {
      const context1 = createMockExecutionContext(1);
      const context2 = createMockExecutionContext(2);

      authService.isAdminUser.mockResolvedValueOnce(true);
      authService.isAdminUser.mockResolvedValueOnce(false);

      await guard.canActivate(context1);
      await expect(guard.canActivate(context2)).rejects.toThrow(UnauthorizedException);

      expect(authService.isAdminUser).toHaveBeenCalledTimes(2);
    });

    it('should always verify admin status from auth service', async () => {
      authService.isAdminUser.mockResolvedValue(true);
      const context = createMockExecutionContext(1);

      await guard.canActivate(context);
      await guard.canActivate(context);
      await guard.canActivate(context);

      expect(authService.isAdminUser).toHaveBeenCalledTimes(3);
    });

    it('should not allow access if isAdminUser returns false even once', async () => {
      authService.isAdminUser.mockResolvedValue(false);
      const context = createMockExecutionContext(1);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('Error Messages', () => {
    it('should provide clear error message for unauthorized access', async () => {
      authService.isAdminUser.mockResolvedValue(false);
      const context = createMockExecutionContext(1);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow('Admin privileges required');
    });
  });
});
