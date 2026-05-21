import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { AuthDataDto } from '../../../../../../api-dto/auth-data-dto';
import { AppService, AuthBootstrapStatus } from '../services/app.service';
import { createRequiredAuthDataGuardResult, waitForRequiredAuthData } from './auth-data-ready';

const defaultAuthData: AuthDataDto = {
  userId: 0,
  userName: '',
  email: '',
  firstName: '',
  lastName: '',
  isAdmin: false,
  workspaces: []
};

describe('waitForRequiredAuthData', () => {
  it('should resolve ready when auth data arrives while backend login is running', async () => {
    const authDataSubject = new BehaviorSubject<AuthDataDto>(defaultAuthData);
    const authBootstrapStatusSubject = new BehaviorSubject<AuthBootstrapStatus>('backend-login-running');
    const appService = {
      authData$: authDataSubject.asObservable(),
      authBootstrapStatus$: authBootstrapStatusSubject.asObservable()
    } as AppService;

    const result = waitForRequiredAuthData(appService);

    authDataSubject.next({
      ...defaultAuthData,
      userId: 1
    });

    await expect(result).resolves.toBe('ready');
  });

  it('should resolve auth-data-failed when auth data loading fails', async () => {
    const authDataSubject = new BehaviorSubject<AuthDataDto>(defaultAuthData);
    const authBootstrapStatusSubject = new BehaviorSubject<AuthBootstrapStatus>('backend-login-running');
    const appService = {
      authData$: authDataSubject.asObservable(),
      authBootstrapStatus$: authBootstrapStatusSubject.asObservable()
    } as AppService;

    const result = waitForRequiredAuthData(appService);

    authBootstrapStatusSubject.next('auth-data-failed');

    await expect(result).resolves.toBe('auth-data-failed');
  });

  it('should resolve session-expired when the Keycloak session expires while waiting', async () => {
    const authDataSubject = new BehaviorSubject<AuthDataDto>(defaultAuthData);
    const authBootstrapStatusSubject = new BehaviorSubject<AuthBootstrapStatus>('backend-login-running');
    const appService = {
      authData$: authDataSubject.asObservable(),
      authBootstrapStatus$: authBootstrapStatusSubject.asObservable()
    } as AppService;

    const result = waitForRequiredAuthData(appService);

    authBootstrapStatusSubject.next('session-expired');

    await expect(result).resolves.toBe('session-expired');
  });
});

describe('createRequiredAuthDataGuardResult', () => {
  let router: jest.Mocked<Router>;

  beforeEach(() => {
    router = {
      createUrlTree: jest.fn().mockReturnValue({ redirect: true })
    } as unknown as jest.Mocked<Router>;
  });

  it('should allow access when auth data is ready', () => {
    expect(createRequiredAuthDataGuardResult(router, '/workspace-admin/1', 'ready')).toBe(true);
    expect(router.createUrlTree).not.toHaveBeenCalled();
  });

  it('should preserve session-expired redirects', () => {
    const result = createRequiredAuthDataGuardResult(router, '/workspace-admin/1', 'session-expired');

    expect(result).toEqual({ redirect: true });
    expect(router.createUrlTree).toHaveBeenCalledWith(['/home'], {
      queryParams: {
        auth: 'session-expired',
        returnUrl: '/workspace-admin/1'
      }
    });
  });

  it('should map auth-data-failed to the auth data failed redirect', () => {
    const result = createRequiredAuthDataGuardResult(router, '/workspace-admin/1', 'auth-data-failed');

    expect(result).toEqual({ redirect: true });
    expect(router.createUrlTree).toHaveBeenCalledWith(['/home'], {
      queryParams: {
        auth: 'auth-data-failed',
        returnUrl: '/workspace-admin/1'
      }
    });
  });
});
