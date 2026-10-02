import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { AppService, AuthDataRefreshOutcome } from './app.service';
import { LogoService } from './logo.service';
import { SERVER_URL } from '../../injection-tokens';
import { AuthDataDto } from '../../../../../../api-dto/auth-data-dto';
import {
  AppHttpError,
  BACKEND_CONNECTIVITY_ERROR_MESSAGE
} from '../interceptors/app-http-error.class';
import { SUPPRESS_GLOBAL_HTTP_ERROR } from '../interceptors/http-error-context';
import { DecodedToken } from './auth.models';
import { CreateUserDto } from '../../../../../../api-dto/user/create-user-dto';
import { SessionRecoveryService } from './session-recovery.service';

describe('AppService', () => {
  let service: AppService;
  let httpMock: HttpTestingController;
  let logoServiceMock: jest.Mocked<LogoService>;
  let sessionRecoveryService: SessionRecoveryService;

  const mockServerUrl = 'http://localhost/api/';

  beforeEach(() => {
    logoServiceMock = {
      getLogoSettings: jest.fn().mockReturnValue(of(null))
    } as unknown as jest.Mocked<LogoService>;

    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn().mockReturnValue('mock-token'),
        setItem: jest.fn(),
        removeItem: jest.fn()
      },
      writable: true
    });

    TestBed.configureTestingModule({
      providers: [
        AppService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: LogoService, useValue: logoServiceMock },
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(AppService);
    httpMock = TestBed.inject(HttpTestingController);
    sessionRecoveryService = TestBed.inject(SessionRecoveryService);
  });

  afterEach(() => {
    httpMock.verify();
    sessionStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('selectedWorkspaceId', () => {
    it('should emit selected workspace changes', () => {
      const workspaceIds: number[] = [];
      const subscription = service.selectedWorkspaceId$.subscribe(workspaceId => {
        workspaceIds.push(workspaceId);
      });

      service.selectedWorkspaceId = 1;
      service.selectedWorkspaceId = 1;
      service.selectedWorkspaceId = 2;
      service.selectedWorkspaceId = null;

      expect(workspaceIds).toEqual([1, 2, 0]);
      expect(service.selectedWorkspaceId).toBe(0);
      subscription.unsubscribe();
    });
  });

  describe('createOwnToken', () => {
    it('should request a self-service workspace token', () => {
      service.createOwnToken(7, 1, ['replay:read', 'replay-statistics:write']).subscribe(token => {
        expect(token).toBe('signed-token');
      });

      const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/7/token/1`);
      expect(req.request.method).toBe('GET');
      expect(req.request.params.getAll('scopes')).toEqual(['replay:read', 'replay-statistics:write']);
      req.flush('signed-token');
    });
  });

  describe('createTokenForIdentity', () => {
    it('should request a workspace admin token for an encoded target identity', () => {
      service.createTokenForIdentity(
        7,
        'issuer/user@example.test',
        1,
        ['coding-job:operate']
      ).subscribe(token => {
        expect(token).toBe('admin-token');
      });

      const req = httpMock.expectOne(request => (
        request.url === `${mockServerUrl}admin/workspace/7/issuer%2Fuser%40example.test/token/1`
      ));
      expect(req.request.method).toBe('GET');
      expect(req.request.params.getAll('scopes')).toEqual(['coding-job:operate']);
      req.flush('admin-token');
    });
  });

  describe('auth data loading', () => {
    it('should retry auth data after transient backend errors', fakeAsync(() => {
      const mockAuthData = { userId: 1, userName: 'user' } as unknown as AuthDataDto;
      let result: boolean | undefined;
      service.loggedUser = { sub: 'user1' } as DecodedToken;

      service.retryAuthDataLoad().subscribe(loadResult => {
        result = loadResult;
      });

      const firstAuthRequest = httpMock.expectOne(`${mockServerUrl}auth-data?identity=user1`);
      expect(firstAuthRequest.request.context.get(SUPPRESS_GLOBAL_HTTP_ERROR)).toBe(true);
      firstAuthRequest.flush('Service unavailable', { status: 503, statusText: 'Service Unavailable' });

      tick(500);

      const secondAuthRequest = httpMock.expectOne(`${mockServerUrl}auth-data?identity=user1`);
      expect(secondAuthRequest.request.context.get(SUPPRESS_GLOBAL_HTTP_ERROR)).toBe(true);
      secondAuthRequest.flush(mockAuthData);

      expect(result).toBe(true);
      expect(service.authBootstrapStatus).toBe('ready');
    }));

    it('should not retry auth data after authorization errors', fakeAsync(() => {
      let result: boolean | undefined;
      service.loggedUser = { sub: 'user1' } as DecodedToken;

      service.retryAuthDataLoad().subscribe(loadResult => {
        result = loadResult;
      });

      const reqAuth = httpMock.expectOne(`${mockServerUrl}auth-data?identity=user1`);
      reqAuth.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

      tick(2000);

      httpMock.expectNone(`${mockServerUrl}auth-data?identity=user1`);
      expect(result).toBe(false);
      expect(service.authBootstrapStatus).toBe('auth-data-failed');
    }));

    it('should refresh data if user is logged in', () => {
      service.loggedUser = { sub: 'user1' } as DecodedToken;
      service.setAuthBootstrapStatus('ready');
      const mockAuthData = { userId: 1 } as unknown as AuthDataDto;
      let refreshResult: AuthDataRefreshOutcome | undefined;

      service.refreshAuthData().subscribe(result => {
        refreshResult = result;
      });

      const req = httpMock.expectOne(`${mockServerUrl}auth-data?identity=user1`);
      expect(req.request.method).toBe('GET');
      expect(req.request.context.get(SUPPRESS_GLOBAL_HTTP_ERROR)).toBe(true);
      req.flush(mockAuthData);

      expect(refreshResult).toBe('updated');
      expect(service.authData).toEqual(mockAuthData);
    });

    it('should preserve ready auth state when a background refresh fails', () => {
      service.loggedUser = { sub: 'user1' } as DecodedToken;
      service.setAuthBootstrapStatus('ready');

      let refreshResult: AuthDataRefreshOutcome | undefined;
      service.refreshAuthData().subscribe(result => {
        refreshResult = result;
      });

      const req = httpMock.expectOne(`${mockServerUrl}auth-data?identity=user1`);
      expect(req.request.context.get(SUPPRESS_GLOBAL_HTTP_ERROR)).toBe(true);
      req.flush('Not found', { status: 404, statusText: 'Not Found' });

      expect(refreshResult).toBe('failed');
      expect(service.authBootstrapStatus).toBe('ready');
    });

    it('should not refresh data while backend login is still running', () => {
      service.loggedUser = { sub: 'user1' } as DecodedToken;
      service.setAuthBootstrapStatus('backend-login-running');

      let refreshResult: AuthDataRefreshOutcome | undefined;
      service.refreshAuthData().subscribe(result => {
        refreshResult = result;
      });

      httpMock.expectNone(`${mockServerUrl}auth-data?identity=user1`);
      expect(refreshResult).toBe('invalidated');
    });

    it('should refresh with the current OIDC identity', () => {
      service.loggedUser = { sub: 'user1' } as DecodedToken;
      service.setAuthBootstrapStatus('ready');

      service.refreshAuthData().subscribe(result => {
        expect(result).toBe('updated');
      });

      const req = httpMock.expectOne(`${mockServerUrl}auth-data?identity=user1`);
      req.flush({ userId: 1 } as AuthDataDto);
    });

    it('should not overwrite newer auth data and should report effective refresh success', () => {
      service.loggedUser = { sub: 'user1' } as DecodedToken;
      service.setAuthBootstrapStatus('ready');
      let firstResult: AuthDataRefreshOutcome | undefined;
      let secondResult: AuthDataRefreshOutcome | undefined;

      service.refreshAuthData().subscribe(result => {
        firstResult = result;
      });
      service.refreshAuthData().subscribe(result => {
        secondResult = result;
      });

      const requests = httpMock.match(`${mockServerUrl}auth-data?identity=user1`);
      expect(requests).toHaveLength(2);
      requests[1].flush({ userId: 1, userName: 'Current' } as AuthDataDto);
      requests[0].flush({ userId: 1, userName: 'Stale' } as AuthDataDto);

      expect(secondResult).toBe('updated');
      expect(firstResult).toBe('superseded');
      expect(service.authData.userName).toBe('Current');
    });

    it('should apply an older successful refresh if a newer refresh fails', () => {
      service.loggedUser = { sub: 'user1' } as DecodedToken;
      service.setAuthBootstrapStatus('ready');
      let firstResult: AuthDataRefreshOutcome | undefined;
      let secondResult: AuthDataRefreshOutcome | undefined;

      service.refreshAuthData().subscribe(result => {
        firstResult = result;
      });
      service.refreshAuthData().subscribe(result => {
        secondResult = result;
      });

      const requests = httpMock.match(`${mockServerUrl}auth-data?identity=user1`);
      expect(requests).toHaveLength(2);
      requests[1].flush('Not found', { status: 404, statusText: 'Not Found' });
      requests[0].flush({ userId: 1, userName: 'Current' } as AuthDataDto);

      expect(secondResult).toBe('failed');
      expect(firstResult).toBe('updated');
      expect(service.authData.userName).toBe('Current');
    });

    it('should finish the newest refresh after its subscriber unsubscribes', () => {
      service.loggedUser = { sub: 'user1' } as DecodedToken;
      service.setAuthBootstrapStatus('ready');
      let firstResult: AuthDataRefreshOutcome | undefined;

      service.refreshAuthData().subscribe(result => {
        firstResult = result;
      });
      const secondSubscription = service.refreshAuthData().subscribe();

      const requests = httpMock.match(`${mockServerUrl}auth-data?identity=user1`);
      expect(requests).toHaveLength(2);
      secondSubscription.unsubscribe();
      expect(requests[1].cancelled).toBe(false);
      requests[0].flush({ userId: 1, userName: 'Stale' } as AuthDataDto);
      requests[1].flush({ userId: 1, userName: 'Current' } as AuthDataDto);

      expect(firstResult).toBe('updated');
      expect(service.authData.userName).toBe('Current');
    });

    it('should not restore auth data from a refresh after auth state was cleared', () => {
      service.loggedUser = { sub: 'user1' } as DecodedToken;
      service.loggedUser = { sub: 'user1' } as DecodedToken;
      service.setAuthBootstrapStatus('ready');
      let refreshResult: AuthDataRefreshOutcome | undefined;

      service.refreshAuthData().subscribe(result => {
        refreshResult = result;
      });
      const request = httpMock.expectOne(`${mockServerUrl}auth-data?identity=user1`);

      service.clearAuthState();
      request.flush({ userId: 1, userName: 'Former user' } as AuthDataDto);

      expect(refreshResult).toBe('invalidated');
      expect(service.authData).toEqual(AppService.defaultAuthData);
    });

    it('should not overwrite a newly authenticated user with an earlier refresh response', () => {
      service.loggedUser = { sub: 'user1' } as DecodedToken;
      service.loggedUser = { sub: 'user1' } as DecodedToken;
      service.setAuthBootstrapStatus('ready');
      let refreshResult: AuthDataRefreshOutcome | undefined;
      let loginResult: boolean | undefined;

      service.refreshAuthData().subscribe(result => {
        refreshResult = result;
      });
      const oldRefreshRequest = httpMock.expectOne(`${mockServerUrl}auth-data?identity=user1`);

      service.loggedUser = { sub: 'user2' } as DecodedToken;
      service.loadAuthenticatedUser('user2').subscribe(result => {
        loginResult = result;
      });
      const newLoginRequest = httpMock.expectOne(`${mockServerUrl}auth-data?identity=user2`);
      newLoginRequest.flush({ userId: 2, userName: 'Current user' } as AuthDataDto);
      oldRefreshRequest.flush({ userId: 1, userName: 'Former user' } as AuthDataDto);

      expect(loginResult).toBe(true);
      expect(refreshResult).toBe('invalidated');
      expect(service.authData.userName).toBe('Current user');
    });
  });

  describe('auth state cleanup', () => {
    it('should clear stored auth state', () => {
      service.loggedUser = { sub: 'user1' } as DecodedToken;
      service.isLoggedIn = true;
      service.user = { username: 'user', isAdmin: false } as CreateUserDto;
      service.needsReAuthentication = true;
      service.sessionExpiryWarning = true;
      service.reAuthenticationReturnUrl = '/coding';
      service.updateAuthData({ userId: 1, userName: 'user' } as AuthDataDto);

      service.clearAuthState();

      expect(localStorage.removeItem).toHaveBeenCalledWith('auth_token');
      expect(localStorage.removeItem).toHaveBeenCalledWith('id_token');
      expect(localStorage.removeItem).toHaveBeenCalledWith('refresh_token');
      expect(service.loggedUser).toBeUndefined();
      expect(service.user).toBeUndefined();
      expect(service.isLoggedIn).toBe(false);
      expect(service.authData).toEqual(AppService.defaultAuthData);
      expect(service.needsReAuthentication).toBe(false);
      expect(service.sessionExpiryWarning).toBe(false);
      expect(service.reAuthenticationReturnUrl).toBeUndefined();
      expect(service.authBootstrapStatus).toBe('ready');
    });

    it('should clear recovery drafts when auth state is cleared explicitly', () => {
      sessionRecoveryService.saveDraft('active-form', { field: 'value' });

      service.clearAuthState();

      expect(sessionRecoveryService.peekDraft('active-form')).toBeNull();
    });

    it('should clear auth state and mark reauthentication as required', () => {
      service.requireReAuthentication('/coding');

      expect(localStorage.removeItem).toHaveBeenCalledWith('auth_token');
      expect(service.needsReAuthentication).toBe(true);
      expect(service.sessionExpiryWarning).toBe(false);
      expect(service.reAuthenticationReturnUrl).toBe('/coding');
      expect(service.authBootstrapStatus).toBe('session-expired');
    });

    it('should preserve an existing return URL if reauthentication is required without a new URL', () => {
      service.requireReAuthentication('/workspace-admin/1');
      service.requireReAuthentication();

      expect(service.reAuthenticationReturnUrl).toBe('/workspace-admin/1');
    });

    it('should capture registered recovery drafts before requiring reauthentication', () => {
      service.loggedUser = { sub: 'user1' } as DecodedToken;
      const unregister = sessionRecoveryService.registerProvider({
        key: 'active-form',
        capture: () => ({ field: 'value' })
      });

      service.requireReAuthentication('/coding');

      expect(sessionRecoveryService.peekDraft('active-form')).toEqual({ field: 'value' });
      expect(sessionRecoveryService.consumeDraft('active-form')).toEqual({ field: 'value' });
      unregister();
    });

    it('should keep recovery drafts saved during reauthentication scoped to the current user', () => {
      service.loggedUser = { sub: 'user1' } as DecodedToken;

      service.requireReAuthentication('/coding');
      sessionRecoveryService.saveDraft('late-active-form', { field: 'late-value' });

      expect(sessionRecoveryService.peekDraft('late-active-form')).toEqual({ field: 'late-value' });
      sessionRecoveryService.setOwnerId(undefined);
      expect(sessionRecoveryService.peekDraft('late-active-form')).toBeNull();
      sessionRecoveryService.setOwnerId('user1');
      expect(sessionRecoveryService.consumeDraft('late-active-form')).toEqual({ field: 'late-value' });
    });

    it('should keep recovery drafts scoped when reauthentication is requested repeatedly', () => {
      service.loggedUser = { sub: 'user1' } as DecodedToken;
      let fieldValue = 'first-value';
      const unregister = sessionRecoveryService.registerProvider({
        key: 'active-form',
        capture: () => ({ field: fieldValue })
      });

      service.requireReAuthentication('/coding');
      fieldValue = 'second-value';
      service.requireReAuthentication('/workspace-admin/1');

      expect(sessionRecoveryService.peekDraft('active-form')).toEqual({ field: 'second-value' });
      sessionRecoveryService.setOwnerId(undefined);
      expect(sessionRecoveryService.peekDraft('active-form')).toBeNull();
      sessionRecoveryService.setOwnerId('user1');
      expect(sessionRecoveryService.consumeDraft('active-form')).toEqual({ field: 'second-value' });
      unregister();
    });

    it('should clear the return URL when reauthentication is dismissed', () => {
      service.requireReAuthentication('/workspace-admin/1');
      service.clearAuthState({ clearReAuthentication: true, clearReturnUrl: true });

      expect(service.needsReAuthentication).toBe(false);
      expect(service.reAuthenticationReturnUrl).toBeUndefined();
    });
  });

  describe('createLoginRedirectUri', () => {
    it('should preserve internal return URLs in a hash route', () => {
      expect(service.createLoginRedirectUri('/coding')).toBe('http://localhost/#/coding');
    });

    it('should return the current app origin for non-returnable routes', () => {
      expect(service.createLoginRedirectUri('/home')).toBe('http://localhost/');
    });
  });

  describe('addErrorMessage', () => {
    it('should group backend connectivity errors under a user-friendly message', () => {
      service.addErrorMessage(new AppHttpError(new HttpErrorResponse({ status: 0, error: 'Network Error' })));
      service.addErrorMessage(new AppHttpError(new HttpErrorResponse({ status: 503, error: 'Service unavailable' })));

      expect(service.errorMessages).toHaveLength(1);
      expect(service.errorMessages[0].message).toBe(BACKEND_CONNECTIVITY_ERROR_MESSAGE);
      expect(service.errorMessages[0].requestCount).toBe(2);
    });
  });
});
