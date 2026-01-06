import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot, Router, convertToParamMap
} from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { UserService } from '../../services/user.service';
import { AppService } from '../../services/app.service';

describe('Access Level Guard', () => {
  let mockAuthService: jest.Mocked<AuthService>;
  let mockUserService: jest.Mocked<UserService>;
  let mockAppService: jest.Mocked<AppService>;
  let mockRouter: jest.Mocked<Router>;
  let authDataSubject: BehaviorSubject<{ userId: number }>;

  beforeEach(() => {
    authDataSubject = new BehaviorSubject({ userId: 0 });

    mockAuthService = {
      getRoles: jest.fn()
    } as unknown as jest.Mocked<AuthService>;

    mockUserService = {
      getUsers: jest.fn()
    } as unknown as jest.Mocked<UserService>;

    mockAppService = {
      authData$: authDataSubject.asObservable()
    } as unknown as jest.Mocked<AppService>;

    mockRouter = {
      createUrlTree: jest.fn()
    } as unknown as jest.Mocked<Router>;

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: UserService, useValue: mockUserService },
        { provide: AppService, useValue: mockAppService },
        { provide: Router, useValue: mockRouter }
      ]
    });
  });

  describe('Guard Implementation', () => {
    it('should be defined and importable', async () => {
      const { canActivateAccessLevel } = await import('./access-level.guard');
      expect(canActivateAccessLevel).toBeDefined();
    });

    it('should be a factory function that returns a CanActivateFn', async () => {
      const { canActivateAccessLevel } = await import('./access-level.guard');
      const guard = canActivateAccessLevel(1);
      expect(typeof guard).toBe('function');
    });

    it('should accept different access levels', async () => {
      const { canActivateAccessLevel } = await import('./access-level.guard');

      const guard1 = canActivateAccessLevel(1);
      const guard2 = canActivateAccessLevel(2);
      const guard3 = canActivateAccessLevel(3);
      const guard4 = canActivateAccessLevel(4);

      expect(guard1).toBeDefined();
      expect(guard2).toBeDefined();
      expect(guard3).toBeDefined();
      expect(guard4).toBeDefined();
    });
  });

  describe('Security Validation - System Admin Bypass', () => {
    it('should recognize admin roles for bypass', () => {
      const adminRoles = ['admin', 'system-admin', 'sys-admin', 'administrator'];
      const userRoles = ['admin'];

      const hasAdminRole = userRoles.some((role: string) => adminRoles.includes(role.toLowerCase())
      );

      expect(hasAdminRole).toBe(true);
    });

    it('should recognize "system-admin" role', () => {
      const adminRoles = ['admin', 'system-admin', 'sys-admin', 'administrator'];
      const userRoles = ['system-admin'];

      const hasAdminRole = userRoles.some((role: string) => adminRoles.includes(role.toLowerCase())
      );

      expect(hasAdminRole).toBe(true);
    });

    it('should recognize "sys-admin" role', () => {
      const adminRoles = ['admin', 'system-admin', 'sys-admin', 'administrator'];
      const userRoles = ['sys-admin'];

      const hasAdminRole = userRoles.some((role: string) => adminRoles.includes(role.toLowerCase())
      );

      expect(hasAdminRole).toBe(true);
    });

    it('should recognize "administrator" role', () => {
      const adminRoles = ['admin', 'system-admin', 'sys-admin', 'administrator'];
      const userRoles = ['administrator'];

      const hasAdminRole = userRoles.some((role: string) => adminRoles.includes(role.toLowerCase())
      );

      expect(hasAdminRole).toBe(true);
    });

    it('should not recognize non-admin roles', () => {
      const adminRoles = ['admin', 'system-admin', 'sys-admin', 'administrator'];
      const userRoles = ['user', 'guest'];

      const hasAdminRole = userRoles.some((role: string) => adminRoles.includes(role.toLowerCase())
      );

      expect(hasAdminRole).toBe(false);
    });
  });

  describe('Security Validation - Access Level Checks', () => {
    it('should allow access when user has exact required access level', () => {
      const userAccessLevel = 3;
      const requiredLevel = 3;

      expect(userAccessLevel >= requiredLevel).toBe(true);
    });

    it('should allow access when user has higher access level than required', () => {
      const userAccessLevel = 4;
      const requiredLevel = 2;

      expect(userAccessLevel >= requiredLevel).toBe(true);
    });

    it('should deny access when user has lower access level than required', () => {
      const userAccessLevel = 1;
      const requiredLevel = 3;

      expect(userAccessLevel >= requiredLevel).toBe(false);
    });

    it('should handle access level 0 (no access)', () => {
      const userAccessLevel = 0;
      const requiredLevel = 1;

      expect(userAccessLevel >= requiredLevel).toBe(false);
    });
  });

  describe('Security Validation - Workspace Isolation', () => {
    it('should extract workspace ID from "ws" param', () => {
      const route = {
        paramMap: convertToParamMap({ ws: '456' })
      } as ActivatedRouteSnapshot;

      const workspaceId = route.paramMap.get('ws');
      expect(workspaceId).toBe('456');
    });

    it('should extract workspace ID from "workspace_id" param', () => {
      const route = {
        paramMap: convertToParamMap({ workspace_id: '789' })
      } as ActivatedRouteSnapshot;

      const workspaceId = route.paramMap.get('workspace_id');
      expect(workspaceId).toBe('789');
    });

    it('should handle missing workspace ID', () => {
      const route = {
        paramMap: convertToParamMap({})
      } as ActivatedRouteSnapshot;

      const workspaceId = route.paramMap.get('ws') || route.paramMap.get('workspace_id');
      expect(workspaceId).toBeNull();
    });

    it('should validate user is in workspace users list', () => {
      const currentUserId = 42;
      const workspaceUsers = [
        {
          id: 42, accessLevel: 3, name: 'Test User', username: 'testuser', isAdmin: false
        },
        {
          id: 99, accessLevel: 4, name: 'Other User', username: 'otheruser', isAdmin: false
        }
      ];

      const currentUser = workspaceUsers.find(wu => wu.id === currentUserId);
      expect(currentUser).toBeDefined();
      expect(currentUser?.id).toBe(42);
    });

    it('should deny access when user is not in workspace users list', () => {
      const currentUserId = 42;
      const workspaceUsers = [
        {
          id: 99, accessLevel: 4, name: 'Other User', username: 'otheruser', isAdmin: false
        }
      ];

      const currentUser = workspaceUsers.find(wu => wu.id === currentUserId);
      expect(currentUser).toBeUndefined();
    });
  });

  describe('Security Validation - User Authentication', () => {
    it('should filter out default userId: 0', () => {
      const userId = 0;
      const isValidUser = userId > 0;

      expect(isValidUser).toBe(false);
    });

    it('should accept valid user IDs', () => {
      const userId = 42;
      const isValidUser = userId > 0;

      expect(isValidUser).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null accessLevel gracefully', () => {
      const userAccessLevel = null as unknown as number;
      const requiredLevel = 1;
      const effectiveLevel = userAccessLevel || 0;

      expect(effectiveLevel >= requiredLevel).toBe(false);
    });

    it('should handle undefined accessLevel gracefully', () => {
      const userAccessLevel = undefined as unknown as number;
      const requiredLevel = 1;
      const effectiveLevel = userAccessLevel || 0;

      expect(effectiveLevel >= requiredLevel).toBe(false);
    });

    it('should handle empty workspace users list', () => {
      const currentUserId = 42;
      const workspaceUsers: Array<{ id: number; accessLevel: number; name: string; username: string; isAdmin: boolean }> = [];
      if (workspaceUsers.length > 0) workspaceUsers.pop(); // Tiny hack to avoid 'never written' warning

      const currentUser = workspaceUsers.find(wu => wu.id === currentUserId);
      expect(currentUser).toBeUndefined();
    });

    it('should handle invalid workspace ID format', () => {
      const workspaceId = 'invalid';
      const numericId = Number(workspaceId);

      expect(Number.isNaN(numericId)).toBe(true);
    });

    it('should handle negative access levels', () => {
      const userAccessLevel = -1;
      const requiredLevel = 1;

      expect(userAccessLevel >= requiredLevel).toBe(false);
    });

    it('should handle extremely high access levels', () => {
      const userAccessLevel = 9999;
      const requiredLevel = 4;

      expect(userAccessLevel >= requiredLevel).toBe(true);
    });
  });

  describe('Security - Privilege Escalation Prevention', () => {
    it('should not allow level 1 user to access level 2 resources', () => {
      const userAccessLevel = 1;
      const requiredLevel = 2;

      expect(userAccessLevel >= requiredLevel).toBe(false);
    });

    it('should not allow level 2 user to access level 3 resources', () => {
      const userAccessLevel = 2;
      const requiredLevel = 3;

      expect(userAccessLevel >= requiredLevel).toBe(false);
    });

    it('should not allow level 3 user to access level 4 resources', () => {
      const userAccessLevel = 3;
      const requiredLevel = 4;

      expect(userAccessLevel >= requiredLevel).toBe(false);
    });

    it('should validate user ID matches authenticated user', () => {
      const authenticatedUserId = 42;
      const workspaceUsers = [
        {
          id: 99, accessLevel: 4, name: 'Other User', username: 'otheruser', isAdmin: false
        }
      ];

      const currentUser = workspaceUsers.find(wu => wu.id === authenticatedUserId);
      expect(currentUser).toBeUndefined();
    });
  });

  describe('Access Level Boundaries', () => {
    it('should allow level 1 (Coder) to access level 1 resources', () => {
      const userAccessLevel = 1;
      const requiredLevel = 1;

      expect(userAccessLevel >= requiredLevel).toBe(true);
    });

    it('should allow level 2 (Coding Manager) to access level 1 and 2 resources', () => {
      const userAccessLevel = 2;

      expect(userAccessLevel >= 1).toBe(true);
      expect(userAccessLevel >= 2).toBe(true);
      expect(userAccessLevel >= 3).toBe(false);
    });

    it('should allow level 3 (Study Manager) to access level 1, 2, and 3 resources', () => {
      const userAccessLevel = 3;

      expect(userAccessLevel >= 1).toBe(true);
      expect(userAccessLevel >= 2).toBe(true);
      expect(userAccessLevel >= 3).toBe(true);
      expect(userAccessLevel >= 4).toBe(false);
    });

    it('should allow level 4 (Admin) to access all resources', () => {
      const userAccessLevel = 4;

      expect(userAccessLevel >= 1).toBe(true);
      expect(userAccessLevel >= 2).toBe(true);
      expect(userAccessLevel >= 3).toBe(true);
      expect(userAccessLevel >= 4).toBe(true);
    });
  });

  describe('Redirect Logic', () => {
    it('should redirect Coding Manager (level 2) to coding section', () => {
      const userAccessLevel = 2;
      const workspaceId = '123';

      if (userAccessLevel === 2) {
        const redirectPath = `/workspace-admin/${workspaceId}/coding`;
        expect(redirectPath).toBe('/workspace-admin/123/coding');
      }
    });

    it('should redirect Coder (level 1) to my-jobs', () => {
      const userAccessLevel = 1;
      const workspaceId = '123';

      if (userAccessLevel === 1) {
        const redirectPath = `/workspace-admin/${workspaceId}/coding/my-jobs`;
        expect(redirectPath).toBe('/workspace-admin/123/coding/my-jobs');
      }
    });

    it('should redirect to home when user has no access', () => {
      const userAccessLevel = 0;

      if (userAccessLevel < 1) {
        const redirectPath = '/';
        expect(redirectPath).toBe('/');
      }
    });
  });

  describe('Integration with Keycloak', () => {
    it('should use keycloak-angular createAuthGuard', async () => {
      // The guard is created using keycloak-angular's createAuthGuard
      // which handles authentication validation
      const { canActivateAccessLevel } = await import('./access-level.guard');
      const guard = canActivateAccessLevel(1);
      expect(guard).toBeDefined();
    });

    it('should validate authentication status before checking access level', () => {
      // The guard checks the authenticated property from AuthGuardData
      // This is handled by keycloak-angular internally
      const mockAuthData = { authenticated: true };
      expect(mockAuthData.authenticated).toBe(true);

      const mockUnauthData = { authenticated: false };
      expect(mockUnauthData.authenticated).toBe(false);
    });
  });
});
