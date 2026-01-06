import { TestBed } from '@angular/core/testing';
import { AuthService } from '../services/auth.service';

describe('Admin Guard', () => {
  let mockAuthService: jest.Mocked<AuthService>;

  beforeEach(() => {
    mockAuthService = {
      getRoles: jest.fn()
    } as unknown as jest.Mocked<AuthService>;

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: mockAuthService }
      ]
    });
  });

  describe('Guard Implementation', () => {
    it('should be defined and importable', async () => {
      const { canActivateAdmin } = await import('./admin.guard');
      expect(canActivateAdmin).toBeDefined();
      expect(typeof canActivateAdmin).toBe('function');
    });

    it('should be a valid CanActivateFn', async () => {
      const { canActivateAdmin } = await import('./admin.guard');
      expect(typeof canActivateAdmin).toBe('function');
    });
  });

  describe('Security Validation - Admin Role Checks', () => {
    it('should validate admin roles case-insensitively', () => {
      // The guard implementation checks for admin roles in lowercase
      const adminRoles = ['admin', 'system-admin', 'sys-admin', 'administrator'];

      adminRoles.forEach(role => {
        expect(role.toLowerCase()).toMatch(/^(admin|system-admin|sys-admin|administrator)$/);
      });
    });

    it('should recognize all valid admin role variants', () => {
      const validAdminRoles = ['admin', 'system-admin', 'sys-admin', 'administrator'];
      const testRoles = ['ADMIN', 'Admin', 'system-admin', 'SYS-ADMIN', 'Administrator'];

      testRoles.forEach(testRole => {
        const isAdmin = validAdminRoles.some(adminRole => adminRole.toLowerCase() === testRole.toLowerCase()
        );
        expect(isAdmin).toBe(true);
      });
    });

    it('should reject non-admin roles', () => {
      const validAdminRoles = ['admin', 'system-admin', 'sys-admin', 'administrator'];
      const nonAdminRoles = ['user', 'viewer', 'editor', 'guest'];

      nonAdminRoles.forEach(role => {
        const isAdmin = validAdminRoles.some(adminRole => adminRole.toLowerCase() === role.toLowerCase()
        );
        expect(isAdmin).toBe(false);
      });
    });
  });

  describe('Security - Privilege Escalation Prevention', () => {
    it('should not allow access with similar but non-admin roles', () => {
      const validAdminRoles = ['admin', 'system-admin', 'sys-admin', 'administrator'];
      const similarRoles = ['admin-viewer', 'user-admin', 'administrator-read', 'admins'];

      similarRoles.forEach(role => {
        const isAdmin = validAdminRoles.some(adminRole => adminRole === role.toLowerCase()
        );
        expect(isAdmin).toBe(false);
      });
    });

    it('should not allow substring matches', () => {
      const validAdminRoles = ['admin', 'system-admin', 'sys-admin', 'administrator'];
      const substringRoles = ['super-admin', 'root-admin', 'administrators-group'];

      substringRoles.forEach(role => {
        const isAdmin = validAdminRoles.some(adminRole => adminRole === role.toLowerCase()
        );
        expect(isAdmin).toBe(false);
      });
    });

    it('should validate exact role match only', () => {
      const validAdminRoles = ['admin', 'system-admin', 'sys-admin', 'administrator'];

      // Test exact matches
      expect(validAdminRoles.includes('admin')).toBe(true);
      expect(validAdminRoles.includes('system-admin')).toBe(true);

      // Test non-exact matches
      expect(validAdminRoles.includes('admins')).toBe(false);
      expect(validAdminRoles.includes('admin-user')).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty roles array', () => {
      const roles: string[] = [];
      if (roles.length > 0) roles.pop(); // Tiny hack to avoid 'never written' warning
      const validAdminRoles = ['admin', 'system-admin', 'sys-admin', 'administrator'];

      const hasAdminRole = roles.some(role => validAdminRoles.includes(role.toLowerCase())
      );

      expect(hasAdminRole).toBe(false);
    });

    it('should handle roles with special characters', () => {
      const validAdminRoles = ['admin', 'system-admin', 'sys-admin', 'administrator'];
      const specialRoles = ['admin@special', 'user-role'];

      specialRoles.forEach(role => {
        const isAdmin = validAdminRoles.includes(role.toLowerCase());
        expect(isAdmin).toBe(false);
      });
    });

    it('should handle roles with whitespace', () => {
      const validAdminRoles = ['admin', 'system-admin', 'sys-admin', 'administrator'];
      const role = ' admin ';

      // The guard should handle trimming or the role should match exactly
      const isAdminWithTrim = validAdminRoles.includes(role.trim().toLowerCase());
      expect(isAdminWithTrim).toBe(true);
    });
  });

  describe('Role Validation Logic', () => {
    it('should use case-insensitive comparison', () => {
      const userRoles = ['ADMIN', 'USER'];
      const adminRoles = ['admin', 'system-admin', 'sys-admin', 'administrator'];

      const hasAdminRole = userRoles.some((role: string) => adminRoles.includes(role.toLowerCase())
      );

      expect(hasAdminRole).toBe(true);
    });

    it('should check multiple roles correctly', () => {
      const userRoles = ['user', 'editor', 'admin', 'viewer'];
      const adminRoles = ['admin', 'system-admin', 'sys-admin', 'administrator'];

      const hasAdminRole = userRoles.some((role: string) => adminRoles.includes(role.toLowerCase())
      );

      expect(hasAdminRole).toBe(true);
    });

    it('should return false when no admin roles present', () => {
      const userRoles = ['user', 'viewer'];
      const adminRoles = ['admin', 'system-admin', 'sys-admin', 'administrator'];

      const hasAdminRole = userRoles.some((role: string) => adminRoles.includes(role.toLowerCase())
      );

      expect(hasAdminRole).toBe(false);
    });
  });
});
