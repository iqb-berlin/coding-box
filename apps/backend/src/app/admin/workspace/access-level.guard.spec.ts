import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import { UsersService } from '../../database/services/users';

describe('AccessLevelGuard (Backend)', () => {
  let guard: AccessLevelGuard;
  let reflector: jest.Mocked<Reflector>;
  let usersService: jest.Mocked<UsersService>;

  beforeEach(async () => {
    const mockReflector = {
      get: jest.fn()
    };

    const mockUsersService = {
      getUserIsAdmin: jest.fn(),
      getUserAccessLevel: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccessLevelGuard,
        {
          provide: Reflector,
          useValue: mockReflector
        },
        {
          provide: UsersService,
          useValue: mockUsersService
        }
      ]
    }).compile();

    guard = module.get<AccessLevelGuard>(AccessLevelGuard);
    reflector = module.get(Reflector);
    usersService = module.get(UsersService);
  });

  const createMockExecutionContext = (
    userId: number,
    workspaceId: string,
    requiredLevel?: number
  ): ExecutionContext => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: userId },
          params: { workspace_id: workspaceId }
        })
      }),
      getHandler: () => ({})
    } as unknown as ExecutionContext;

    if (requiredLevel !== undefined) {
      reflector.get.mockReturnValue(requiredLevel);
    }

    return context;
  };

  describe('Security Validation - No Access Level Required', () => {
    it('should allow access when no access level is specified', async () => {
      reflector.get.mockReturnValue(undefined);
      const context = createMockExecutionContext(1, '123');

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(usersService.getUserIsAdmin).not.toHaveBeenCalled();
      expect(usersService.getUserAccessLevel).not.toHaveBeenCalled();
    });

    it('should allow access when access level is null', async () => {
      reflector.get.mockReturnValue(null);
      const context = createMockExecutionContext(1, '123');

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });
  });

  describe('Security Validation - System Admin Bypass', () => {
    it('should allow system admin to access any workspace', async () => {
      reflector.get.mockReturnValue(4);
      usersService.getUserIsAdmin.mockResolvedValue(true);
      const context = createMockExecutionContext(1, '123', 4);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(usersService.getUserIsAdmin).toHaveBeenCalledWith(1);
      expect(usersService.getUserAccessLevel).not.toHaveBeenCalled();
    });

    it('should bypass access level check for admin users', async () => {
      reflector.get.mockReturnValue(3);
      usersService.getUserIsAdmin.mockResolvedValue(true);
      const context = createMockExecutionContext(1, '123', 3);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });
  });

  describe('Security Validation - Access Level Checks', () => {
    beforeEach(() => {
      usersService.getUserIsAdmin.mockResolvedValue(false);
    });

    it('should allow access when user has exact required access level', async () => {
      reflector.get.mockReturnValue(3);
      usersService.getUserAccessLevel.mockResolvedValue(3);
      const context = createMockExecutionContext(42, '123', 3);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(usersService.getUserAccessLevel).toHaveBeenCalledWith(42, 123);
    });

    it('should allow access when user has higher access level than required', async () => {
      reflector.get.mockReturnValue(2);
      usersService.getUserAccessLevel.mockResolvedValue(4);
      const context = createMockExecutionContext(42, '123', 2);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should deny access when user has lower access level than required', async () => {
      reflector.get.mockReturnValue(3);
      usersService.getUserAccessLevel.mockResolvedValue(1);
      const context = createMockExecutionContext(42, '123', 3);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Access level 3 required. Current user has level 1'
      );
    });

    it('should validate access level 0 (Guest)', async () => {
      reflector.get.mockReturnValue(0);
      usersService.getUserAccessLevel.mockResolvedValue(0);
      const context = createMockExecutionContext(42, '123', 0);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should validate access level 1 (Coder)', async () => {
      reflector.get.mockReturnValue(1);
      usersService.getUserAccessLevel.mockResolvedValue(1);
      const context = createMockExecutionContext(42, '123', 1);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should validate access level 2 (Coding Manager)', async () => {
      reflector.get.mockReturnValue(2);
      usersService.getUserAccessLevel.mockResolvedValue(2);
      const context = createMockExecutionContext(42, '123', 2);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should validate access level 3 (Study Manager)', async () => {
      reflector.get.mockReturnValue(3);
      usersService.getUserAccessLevel.mockResolvedValue(3);
      const context = createMockExecutionContext(42, '123', 3);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should validate access level 4 (Admin)', async () => {
      reflector.get.mockReturnValue(4);
      usersService.getUserAccessLevel.mockResolvedValue(4);
      const context = createMockExecutionContext(42, '123', 4);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });
  });

  describe('Security Validation - User Not in Workspace', () => {
    beforeEach(() => {
      usersService.getUserIsAdmin.mockResolvedValue(false);
    });

    it('should deny access when user is not in workspace', async () => {
      reflector.get.mockReturnValue(1);
      usersService.getUserAccessLevel.mockResolvedValue(null);
      const context = createMockExecutionContext(42, '123', 1);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'User does not have access to workspace 123'
      );
    });

    it('should provide workspace ID in error message', async () => {
      reflector.get.mockReturnValue(2);
      usersService.getUserAccessLevel.mockResolvedValue(null);
      const context = createMockExecutionContext(42, '456', 2);

      try {
        await guard.canActivate(context);
        fail('Should have thrown UnauthorizedException');
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        expect(error.message).toContain('workspace 456');
      }
    });
  });

  describe('Security Validation - Request Structure', () => {
    it('should deny access when user ID is missing', async () => {
      reflector.get.mockReturnValue(1);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            params: { workspace_id: '123' }
          })
        }),
        getHandler: () => ({})
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow('User ID not found in request');
    });

    it('should deny access when user object is missing', async () => {
      reflector.get.mockReturnValue(1);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            params: { workspace_id: '123' }
          })
        }),
        getHandler: () => ({})
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should deny access when workspace ID is missing', async () => {
      reflector.get.mockReturnValue(1);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: 42 },
            params: {}
          })
        }),
        getHandler: () => ({})
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow('Workspace ID not found in request');
    });

    it('should deny access when workspace ID is NaN', async () => {
      reflector.get.mockReturnValue(1);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: 42 },
            params: { workspace_id: 'invalid' }
          })
        }),
        getHandler: () => ({})
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow('Workspace ID not found in request');
    });

    it('should deny access when workspace ID is null', async () => {
      reflector.get.mockReturnValue(1);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: 42 },
            params: { workspace_id: null }
          })
        }),
        getHandler: () => ({})
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should deny access when workspace ID is undefined', async () => {
      reflector.get.mockReturnValue(1);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: 42 },
            params: { workspace_id: undefined }
          })
        }),
        getHandler: () => ({})
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('Edge Cases - Workspace ID Parsing', () => {
    beforeEach(() => {
      usersService.getUserIsAdmin.mockResolvedValue(false);
      usersService.getUserAccessLevel.mockResolvedValue(3);
    });

    it('should parse numeric string workspace ID', async () => {
      reflector.get.mockReturnValue(2);
      const context = createMockExecutionContext(42, '123', 2);

      await guard.canActivate(context);

      expect(usersService.getUserAccessLevel).toHaveBeenCalledWith(42, 123);
    });

    it('should handle zero workspace ID', async () => {
      reflector.get.mockReturnValue(2);
      const context = createMockExecutionContext(42, '0', 2);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle negative workspace ID', async () => {
      reflector.get.mockReturnValue(2);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: 42 },
            params: { workspace_id: '-1' }
          })
        }),
        getHandler: () => ({})
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle very large workspace ID', async () => {
      reflector.get.mockReturnValue(2);
      const context = createMockExecutionContext(42, '999999999', 2);

      await guard.canActivate(context);

      expect(usersService.getUserAccessLevel).toHaveBeenCalledWith(42, 999999999);
    });

    it('should handle workspace ID with leading zeros', async () => {
      reflector.get.mockReturnValue(2);
      const context = createMockExecutionContext(42, '00123', 2);

      await guard.canActivate(context);

      expect(usersService.getUserAccessLevel).toHaveBeenCalledWith(42, 123);
    });
  });

  describe('Edge Cases - Access Levels', () => {
    beforeEach(() => {
      usersService.getUserIsAdmin.mockResolvedValue(false);
    });

    it('should handle negative user access level', async () => {
      reflector.get.mockReturnValue(1);
      usersService.getUserAccessLevel.mockResolvedValue(-1);
      const context = createMockExecutionContext(42, '123', 1);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle very high user access level', async () => {
      reflector.get.mockReturnValue(4);
      usersService.getUserAccessLevel.mockResolvedValue(9999);
      const context = createMockExecutionContext(42, '123', 4);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should handle zero access level requirement', async () => {
      reflector.get.mockReturnValue(0);
      usersService.getUserAccessLevel.mockResolvedValue(0);
      const context = createMockExecutionContext(42, '123', 0);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should deny when user has level 0 but level 1 required', async () => {
      reflector.get.mockReturnValue(1);
      usersService.getUserAccessLevel.mockResolvedValue(0);
      const context = createMockExecutionContext(42, '123', 1);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('Security - Service Errors', () => {
    it('should propagate getUserIsAdmin errors', async () => {
      reflector.get.mockReturnValue(1);
      usersService.getUserIsAdmin.mockRejectedValue(new Error('Database error'));
      const context = createMockExecutionContext(42, '123', 1);

      await expect(guard.canActivate(context)).rejects.toThrow('Database error');
    });

    it('should propagate getUserAccessLevel errors', async () => {
      reflector.get.mockReturnValue(1);
      usersService.getUserIsAdmin.mockResolvedValue(false);
      usersService.getUserAccessLevel.mockRejectedValue(new Error('Database error'));
      const context = createMockExecutionContext(42, '123', 1);

      await expect(guard.canActivate(context)).rejects.toThrow('Database error');
    });

    it('should handle getUserIsAdmin returning null', async () => {
      reflector.get.mockReturnValue(1);
      usersService.getUserIsAdmin.mockResolvedValue(null as unknown as boolean);
      usersService.getUserAccessLevel.mockResolvedValue(3);
      const context = createMockExecutionContext(42, '123', 1);

      // Should treat null as false and continue to check access level
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should handle getUserIsAdmin returning undefined', async () => {
      reflector.get.mockReturnValue(1);
      usersService.getUserIsAdmin.mockResolvedValue(undefined as unknown as boolean);
      usersService.getUserAccessLevel.mockResolvedValue(3);
      const context = createMockExecutionContext(42, '123', 1);

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });
  });

  describe('Security - Privilege Escalation Prevention', () => {
    beforeEach(() => {
      usersService.getUserIsAdmin.mockResolvedValue(false);
    });

    it('should not allow level 1 user to access level 2 resources', async () => {
      reflector.get.mockReturnValue(2);
      usersService.getUserAccessLevel.mockResolvedValue(1);
      const context = createMockExecutionContext(42, '123', 2);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should not allow level 2 user to access level 3 resources', async () => {
      reflector.get.mockReturnValue(3);
      usersService.getUserAccessLevel.mockResolvedValue(2);
      const context = createMockExecutionContext(42, '123', 3);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should not allow level 3 user to access level 4 resources', async () => {
      reflector.get.mockReturnValue(4);
      usersService.getUserAccessLevel.mockResolvedValue(3);
      const context = createMockExecutionContext(42, '123', 4);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should not cache access level between requests', async () => {
      reflector.get.mockReturnValue(2);
      const context1 = createMockExecutionContext(42, '123', 2);
      const context2 = createMockExecutionContext(42, '123', 2);

      usersService.getUserAccessLevel.mockResolvedValueOnce(3);
      usersService.getUserAccessLevel.mockResolvedValueOnce(1);

      await guard.canActivate(context1);
      await expect(guard.canActivate(context2)).rejects.toThrow(UnauthorizedException);

      expect(usersService.getUserAccessLevel).toHaveBeenCalledTimes(2);
    });

    it('should verify access level for each workspace separately', async () => {
      reflector.get.mockReturnValue(2);
      usersService.getUserAccessLevel.mockResolvedValue(3);

      await guard.canActivate(createMockExecutionContext(42, '123', 2));
      await guard.canActivate(createMockExecutionContext(42, '456', 2));

      expect(usersService.getUserAccessLevel).toHaveBeenCalledTimes(2);
      expect(usersService.getUserAccessLevel).toHaveBeenNthCalledWith(1, 42, 123);
      expect(usersService.getUserAccessLevel).toHaveBeenNthCalledWith(2, 42, 456);
    });

    it('should always verify admin status from database', async () => {
      reflector.get.mockReturnValue(4);
      usersService.getUserIsAdmin.mockResolvedValue(true);
      const context = createMockExecutionContext(42, '123', 4);

      await guard.canActivate(context);
      await guard.canActivate(context);
      await guard.canActivate(context);

      expect(usersService.getUserIsAdmin).toHaveBeenCalledTimes(3);
    });
  });

  describe('RequireAccessLevel Decorator', () => {
    it('should create metadata with correct access level', () => {
      const decorator = RequireAccessLevel(3);
      expect(decorator).toBeDefined();
    });

    it('should work with level 0', () => {
      const decorator = RequireAccessLevel(0);
      expect(decorator).toBeDefined();
    });

    it('should work with level 4', () => {
      const decorator = RequireAccessLevel(4);
      expect(decorator).toBeDefined();
    });
  });

  describe('Error Messages', () => {
    beforeEach(() => {
      usersService.getUserIsAdmin.mockResolvedValue(false);
    });

    it('should provide clear error message for insufficient access level', async () => {
      reflector.get.mockReturnValue(3);
      usersService.getUserAccessLevel.mockResolvedValue(1);
      const context = createMockExecutionContext(42, '123', 3);

      try {
        await guard.canActivate(context);
        fail('Should have thrown UnauthorizedException');
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        expect(error.message).toBe('Access level 3 required. Current user has level 1');
      }
    });

    it('should provide clear error message for missing workspace access', async () => {
      reflector.get.mockReturnValue(2);
      usersService.getUserAccessLevel.mockResolvedValue(null);
      const context = createMockExecutionContext(42, '789', 2);

      try {
        await guard.canActivate(context);
        fail('Should have thrown UnauthorizedException');
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        expect(error.message).toBe('User does not have access to workspace 789');
      }
    });

    it('should provide clear error message for missing user ID', async () => {
      reflector.get.mockReturnValue(1);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            params: { workspace_id: '123' }
          })
        }),
        getHandler: () => ({})
      } as unknown as ExecutionContext;

      try {
        await guard.canActivate(context);
        fail('Should have thrown UnauthorizedException');
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        expect(error.message).toBe('User ID not found in request');
      }
    });

    it('should provide clear error message for missing workspace ID', async () => {
      reflector.get.mockReturnValue(1);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: 42 },
            params: {}
          })
        }),
        getHandler: () => ({})
      } as unknown as ExecutionContext;

      try {
        await guard.canActivate(context);
        fail('Should have thrown UnauthorizedException');
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        expect(error.message).toBe('Workspace ID not found in request');
      }
    });
  });
});
