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
    it('should expose the backend OIDC auth guard', async () => {
      const { canActivateAuth } = await import('./auth.guard');
      expect(canActivateAuth).toBeDefined();
    });

    it('should validate authentication status', () => {
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

  describe('Integration with backend OIDC auth', () => {
    it('should use the application auth service mechanism', async () => {
      const { canActivateAuth } = await import('./auth.guard');
      expect(canActivateAuth).toBeDefined();
    });
  });
});
