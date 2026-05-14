import { Router } from '@angular/router';
import {
  AUTH_QUERY_PARAM_ACCESS_DENIED,
  AUTH_QUERY_PARAM_AUTH_DATA_FAILED,
  AUTH_QUERY_PARAM_SESSION_EXPIRED,
  createAccessDeniedUrlTree,
  createAuthDataFailedUrlTree,
  createReAuthenticationUrlTree,
  isReturnableRoute
} from './auth-redirect';

describe('auth redirect helpers', () => {
  let router: jest.Mocked<Router>;

  beforeEach(() => {
    router = {
      createUrlTree: jest.fn().mockReturnValue({ redirect: true })
    } as unknown as jest.Mocked<Router>;
  });

  it('should include the protected route as returnUrl for reauthentication redirects', () => {
    createReAuthenticationUrlTree(router, '/workspace-admin/1');

    expect(router.createUrlTree).toHaveBeenCalledWith(['/home'], {
      queryParams: {
        auth: AUTH_QUERY_PARAM_SESSION_EXPIRED,
        returnUrl: '/workspace-admin/1'
      }
    });
  });

  it('should omit non-returnable home routes', () => {
    createReAuthenticationUrlTree(router, '/home?auth=session-expired');

    expect(router.createUrlTree).toHaveBeenCalledWith(['/home'], {
      queryParams: {
        auth: AUTH_QUERY_PARAM_SESSION_EXPIRED
      }
    });
  });

  it('should create an auth-data failed redirect', () => {
    createAuthDataFailedUrlTree(router, '/coding');

    expect(router.createUrlTree).toHaveBeenCalledWith(['/home'], {
      queryParams: {
        auth: AUTH_QUERY_PARAM_AUTH_DATA_FAILED,
        returnUrl: '/coding'
      }
    });
  });

  it('should create an access-denied redirect', () => {
    createAccessDeniedUrlTree(router, '/sys-admin');

    expect(router.createUrlTree).toHaveBeenCalledWith(['/home'], {
      queryParams: {
        auth: AUTH_QUERY_PARAM_ACCESS_DENIED,
        returnUrl: '/sys-admin'
      }
    });
  });

  it('should only accept internal application routes as returnable', () => {
    expect(isReturnableRoute('/coding')).toBe(true);
    expect(isReturnableRoute('/')).toBe(false);
    expect(isReturnableRoute('/home')).toBe(false);
    expect(isReturnableRoute('//evil.test')).toBe(false);
    expect(isReturnableRoute('https://evil.test')).toBe(false);
  });
});
