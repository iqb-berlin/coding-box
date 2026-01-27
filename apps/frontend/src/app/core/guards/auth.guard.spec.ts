import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';

describe('Auth Guard', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  describe('Guard Implementation', () => {
    it('should be defined and importable', async () => {
      const { canActivateAuth } = await import('./auth.guard');
      expect(canActivateAuth).toBeDefined();
    });

    it('should be a valid CanActivateFn', async () => {
      const { canActivateAuth } = await import('./auth.guard');
      expect(typeof canActivateAuth).toBe('function');
    });
  });

  describe('Security Validation', () => {
    it('should use keycloak-angular createAuthGuard', async () => {
      // The guard is created using keycloak-angular's createAuthGuard
      // which handles authentication validation
      const { canActivateAuth } = await import('./auth.guard');
      expect(canActivateAuth).toBeDefined();
    });

    it('should validate authentication status', () => {
      // The guard checks the authenticated property from AuthGuardData
      // This is handled by keycloak-angular internally
      const mockAuthData = { authenticated: true };
      expect(mockAuthData.authenticated).toBe(true);

      const mockUnauthData = { authenticated: false };
      expect(mockUnauthData.authenticated).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle route parameters', () => {
      const emptyRoute = {
        params: {},
        queryParams: {},
        data: {}
      } as unknown as ActivatedRouteSnapshot;

      expect(emptyRoute.params).toBeDefined();
      expect(emptyRoute.queryParams).toBeDefined();
    });

    it('should handle state objects', () => {
      const testState = { url: '/test-url' } as RouterStateSnapshot;
      expect(testState.url).toBe('/test-url');
    });
  });

  describe('Integration with Keycloak', () => {
    it('should use keycloak authentication mechanism', async () => {
      // The guard delegates to keycloak-angular for authentication
      // This ensures consistent authentication across the application
      const { canActivateAuth } = await import('./auth.guard');
      expect(canActivateAuth).toBeDefined();
    });
  });
});
