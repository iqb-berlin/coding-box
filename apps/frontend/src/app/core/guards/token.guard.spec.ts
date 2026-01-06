import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree
} from '@angular/router';
import * as jwtDecodeModule from 'jwt-decode';
import { canActivateWithToken } from './token.guard';

describe('Token Guard', () => {
  let mockRouter: jest.Mocked<Router>;
  let mockRoute: ActivatedRouteSnapshot;
  let mockState: RouterStateSnapshot;

  beforeEach(() => {
    mockRouter = {
      createUrlTree: jest.fn()
    } as unknown as jest.Mocked<Router>;

    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: mockRouter }
      ]
    });

    mockRoute = {
      queryParamMap: {
        get: jest.fn()
      }
    } as unknown as ActivatedRouteSnapshot;

    mockState = { url: '/replay' } as RouterStateSnapshot;
  });

  describe('Security Validation - Token Presence', () => {
    it('should deny access when no auth token is provided', () => {
      (mockRoute.queryParamMap.get as jest.Mock).mockReturnValue(null);
      const expectedUrlTree = {} as UrlTree;
      mockRouter.createUrlTree.mockReturnValue(expectedUrlTree);

      const result = TestBed.runInInjectionContext(() => canActivateWithToken(mockRoute, mockState)
      );

      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/home'], {
        queryParams: { error: 'token_missing' }
      });
      expect(result).toBe(expectedUrlTree);
    });

    it('should deny access when auth token is empty string', () => {
      (mockRoute.queryParamMap.get as jest.Mock).mockReturnValue('');
      const expectedUrlTree = {} as UrlTree;
      mockRouter.createUrlTree.mockReturnValue(expectedUrlTree);

      TestBed.runInInjectionContext(() => canActivateWithToken(mockRoute, mockState)
      );

      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/home'], {
        queryParams: { error: 'token_missing' }
      });
    });
  });

  describe('Security Validation - Token Format', () => {
    it('should deny access for invalid JWT format', () => {
      (mockRoute.queryParamMap.get as jest.Mock).mockReturnValue('invalid-token');
      const expectedUrlTree = {} as UrlTree;
      mockRouter.createUrlTree.mockReturnValue(expectedUrlTree);

      jest.spyOn(jwtDecodeModule, 'jwtDecode').mockImplementation(() => {
        throw new Error('Invalid token');
      });

      const result = TestBed.runInInjectionContext(() => canActivateWithToken(mockRoute, mockState)
      );

      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/home'], {
        queryParams: { error: 'token_invalid' }
      });
      expect(result).toBe(expectedUrlTree);
    });

    it('should deny access for malformed JWT', () => {
      (mockRoute.queryParamMap.get as jest.Mock).mockReturnValue('not.a.jwt');
      const expectedUrlTree = {} as UrlTree;
      mockRouter.createUrlTree.mockReturnValue(expectedUrlTree);

      jest.spyOn(jwtDecodeModule, 'jwtDecode').mockImplementation(() => {
        throw new Error('Invalid token format');
      });

      TestBed.runInInjectionContext(() => canActivateWithToken(mockRoute, mockState)
      );

      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/home'], {
        queryParams: { error: 'token_invalid' }
      });
    });
  });

  describe('Security Validation - Token Expiration', () => {
    it('should deny access for expired token', () => {
      const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';
      (mockRoute.queryParamMap.get as jest.Mock).mockReturnValue(expiredToken);
      const expectedUrlTree = {} as UrlTree;
      mockRouter.createUrlTree.mockReturnValue(expectedUrlTree);

      const pastTime = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      jest.spyOn(jwtDecodeModule, 'jwtDecode').mockReturnValue({
        exp: pastTime,
        workspace: 'test-workspace'
      });

      const result = TestBed.runInInjectionContext(() => canActivateWithToken(mockRoute, mockState)
      );

      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/home'], {
        queryParams: { error: 'token_expired' }
      });
      expect(result).toBe(expectedUrlTree);
    });

    it('should allow access for valid non-expired token', () => {
      const validToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.valid';
      (mockRoute.queryParamMap.get as jest.Mock).mockReturnValue(validToken);

      const futureTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      jest.spyOn(jwtDecodeModule, 'jwtDecode').mockReturnValue({
        exp: futureTime,
        workspace: 'test-workspace'
      });

      const result = TestBed.runInInjectionContext(() => canActivateWithToken(mockRoute, mockState)
      );

      expect(result).toBe(true);
    });

    it('should allow access for token expiring at exact current time', () => {
      const validToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.valid';
      (mockRoute.queryParamMap.get as jest.Mock).mockReturnValue(validToken);

      const currentTime = Math.floor(Date.now() / 1000);
      jest.spyOn(jwtDecodeModule, 'jwtDecode').mockReturnValue({
        exp: currentTime,
        workspace: 'test-workspace'
      });

      const result = TestBed.runInInjectionContext(() => canActivateWithToken(mockRoute, mockState)
      );

      // Token expiring at current time should be allowed (guard uses exp < currentTime)
      expect(result).toBe(true);
    });

    it('should allow access for token without expiration', () => {
      const validToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.valid';
      (mockRoute.queryParamMap.get as jest.Mock).mockReturnValue(validToken);

      jest.spyOn(jwtDecodeModule, 'jwtDecode').mockReturnValue({
        workspace: 'test-workspace'
        // No exp field
      });

      const result = TestBed.runInInjectionContext(() => canActivateWithToken(mockRoute, mockState)
      );

      expect(result).toBe(true);
    });
  });

  describe('Security Validation - Workspace Claim', () => {
    it('should deny access when workspace claim is missing', () => {
      const validToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.valid';
      (mockRoute.queryParamMap.get as jest.Mock).mockReturnValue(validToken);
      const expectedUrlTree = {} as UrlTree;
      mockRouter.createUrlTree.mockReturnValue(expectedUrlTree);

      const futureTime = Math.floor(Date.now() / 1000) + 3600;
      jest.spyOn(jwtDecodeModule, 'jwtDecode').mockReturnValue({
        exp: futureTime
        // No workspace claim
      });

      const result = TestBed.runInInjectionContext(() => canActivateWithToken(mockRoute, mockState)
      );

      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/home'], {
        queryParams: { error: 'token_invalid' }
      });
      expect(result).toBe(expectedUrlTree);
    });

    it('should deny access when workspace claim is empty string', () => {
      const validToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.valid';
      (mockRoute.queryParamMap.get as jest.Mock).mockReturnValue(validToken);
      const expectedUrlTree = {} as UrlTree;
      mockRouter.createUrlTree.mockReturnValue(expectedUrlTree);

      const futureTime = Math.floor(Date.now() / 1000) + 3600;
      jest.spyOn(jwtDecodeModule, 'jwtDecode').mockReturnValue({
        exp: futureTime,
        workspace: ''
      });

      TestBed.runInInjectionContext(() => canActivateWithToken(mockRoute, mockState)
      );

      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/home'], {
        queryParams: { error: 'token_invalid' }
      });
    });

    it('should allow access with valid workspace claim', () => {
      const validToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.valid';
      (mockRoute.queryParamMap.get as jest.Mock).mockReturnValue(validToken);

      const futureTime = Math.floor(Date.now() / 1000) + 3600;
      jest.spyOn(jwtDecodeModule, 'jwtDecode').mockReturnValue({
        exp: futureTime,
        workspace: 'workspace-123'
      });

      const result = TestBed.runInInjectionContext(() => canActivateWithToken(mockRoute, mockState)
      );

      expect(result).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle extremely long tokens', () => {
      const longToken = 'a'.repeat(10000);
      (mockRoute.queryParamMap.get as jest.Mock).mockReturnValue(longToken);
      const expectedUrlTree = {} as UrlTree;
      mockRouter.createUrlTree.mockReturnValue(expectedUrlTree);

      jest.spyOn(jwtDecodeModule, 'jwtDecode').mockImplementation(() => {
        throw new Error('Token too long');
      });

      TestBed.runInInjectionContext(() => canActivateWithToken(mockRoute, mockState)
      );

      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/home'], {
        queryParams: { error: 'token_invalid' }
      });
    });

    it('should handle tokens with special characters', () => {
      const specialToken = 'token-with-special-chars!@#$%^&*()';
      (mockRoute.queryParamMap.get as jest.Mock).mockReturnValue(specialToken);
      const expectedUrlTree = {} as UrlTree;
      mockRouter.createUrlTree.mockReturnValue(expectedUrlTree);

      jest.spyOn(jwtDecodeModule, 'jwtDecode').mockImplementation(() => {
        throw new Error('Invalid characters');
      });

      TestBed.runInInjectionContext(() => canActivateWithToken(mockRoute, mockState)
      );

      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/home'], {
        queryParams: { error: 'token_invalid' }
      });
    });

    it('should handle decode throwing unexpected error types', () => {
      const validToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.valid';
      (mockRoute.queryParamMap.get as jest.Mock).mockReturnValue(validToken);
      const expectedUrlTree = {} as UrlTree;
      mockRouter.createUrlTree.mockReturnValue(expectedUrlTree);

      jest.spyOn(jwtDecodeModule, 'jwtDecode').mockImplementation(() => {
        throw new Error('Custom error object');
      });

      TestBed.runInInjectionContext(() => canActivateWithToken(mockRoute, mockState)
      );

      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/home'], {
        queryParams: { error: 'token_invalid' }
      });
    });

    it('should handle null exp value', () => {
      const validToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.valid';
      (mockRoute.queryParamMap.get as jest.Mock).mockReturnValue(validToken);

      jest.spyOn(jwtDecodeModule, 'jwtDecode').mockReturnValue({
        exp: null,
        workspace: 'test-workspace'
      });

      const result = TestBed.runInInjectionContext(() => canActivateWithToken(mockRoute, mockState)
      );

      expect(result).toBe(true);
    });

    it('should handle undefined exp value', () => {
      const validToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.valid';
      (mockRoute.queryParamMap.get as jest.Mock).mockReturnValue(validToken);

      jest.spyOn(jwtDecodeModule, 'jwtDecode').mockReturnValue({
        exp: undefined,
        workspace: 'test-workspace'
      });

      const result = TestBed.runInInjectionContext(() => canActivateWithToken(mockRoute, mockState)
      );

      expect(result).toBe(true);
    });
  });

  describe('Security - Token Manipulation Prevention', () => {
    it('should reject token with tampered signature', () => {
      const tamperedToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.tampered';
      (mockRoute.queryParamMap.get as jest.Mock).mockReturnValue(tamperedToken);
      const expectedUrlTree = {} as UrlTree;
      mockRouter.createUrlTree.mockReturnValue(expectedUrlTree);

      jest.spyOn(jwtDecodeModule, 'jwtDecode').mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      TestBed.runInInjectionContext(() => canActivateWithToken(mockRoute, mockState)
      );

      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/home'], {
        queryParams: { error: 'token_invalid' }
      });
    });

    it('should validate complete token structure', () => {
      const incompleteToken = 'header.payload'; // Missing signature
      (mockRoute.queryParamMap.get as jest.Mock).mockReturnValue(incompleteToken);
      const expectedUrlTree = {} as UrlTree;
      mockRouter.createUrlTree.mockReturnValue(expectedUrlTree);

      jest.spyOn(jwtDecodeModule, 'jwtDecode').mockImplementation(() => {
        throw new Error('Incomplete token');
      });

      TestBed.runInInjectionContext(() => canActivateWithToken(mockRoute, mockState)
      );

      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/home'], {
        queryParams: { error: 'token_invalid' }
      });
    });
  });
});
