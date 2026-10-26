import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { signal } from '@angular/core';
import { LocationStrategy } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import {
  Observable, Subject, of, throwError
} from 'rxjs';
import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { AppComponent } from './app.component';
import { AppService } from './core/services/app.service';
import { AuthService } from './core/services/auth.service';
import { AuthSessionState } from './core/services/auth-session-state.service';
import { AuthRefreshUnavailableError } from './core/interceptors/auth-refresh-unavailable.error';
import { AuthSessionActivityService } from './core/services/auth-session-activity.service';
import { SystemNotificationService } from './core/services/system-notification.service';
import { AuthDataDto } from '../../../../api-dto/auth-data-dto';

describe('AppComponent', () => {
  let authService: {
    authenticationRecovered$: Subject<void>;
    exchangeLoginCode: jest.Mock;
    setToken: jest.Mock;
    setIdToken: jest.Mock;
    setRefreshToken: jest.Mock;
    getValidToken: jest.Mock;
    isLoggedIn: jest.Mock;
    getLoggedUser: jest.Mock;
    getRoles: jest.Mock;
  };
  let appService: {
    appLogo: { bodyBackground: string; data: string; alt: string };
    dataLoading: boolean;
    authData$: Observable<AuthDataDto>;
    processMessagePost: jest.Mock;
    loadAuthenticatedUser: jest.Mock;
    retryAuthDataLoad: jest.Mock;
    setAuthBootstrapStatus: jest.Mock;
    completeBackendLogin: jest.Mock;
    markLoginFailed: jest.Mock;
    authBootstrapStatus: string;
    authProviderFailure?: { code: string; requestId: string };
    normalizeInternalRoute: jest.Mock;
    isLoggedIn: boolean;
    loggedUser?: unknown;
  };
  let router: {
    events: Subject<NavigationEnd>;
    url: string;
    navigateByUrl: jest.Mock;
    initialNavigation: jest.Mock;
  };
  let authSessionActivity: {
    start: jest.Mock;
    stop: jest.Mock;
    restart: jest.Mock;
  };

  beforeEach(async () => {
    authService = {
      authenticationRecovered$: new Subject<void>(),
      exchangeLoginCode: jest.fn().mockReturnValue(of({
        access_token: 'access-token',
        token_type: 'Bearer',
        expires_in: 300,
        id_token: 'id-token',
        refresh_token: 'refresh-token'
      })),
      setToken: jest.fn(),
      setIdToken: jest.fn(),
      setRefreshToken: jest.fn(),
      getValidToken: jest.fn().mockResolvedValue('access-token'),
      isLoggedIn: jest.fn().mockReturnValue(true),
      getLoggedUser: jest.fn().mockReturnValue({ sub: 'oidc-user-id', preferred_username: 'tester' }),
      getRoles: jest.fn().mockReturnValue([])
    };
    appService = {
      appLogo: { bodyBackground: '', data: '', alt: '' },
      dataLoading: false,
      authData$: of(AppService.defaultAuthData),
      processMessagePost: jest.fn(),
      loadAuthenticatedUser: jest.fn().mockReturnValue(of(true)),
      retryAuthDataLoad: jest.fn().mockReturnValue(of(true)),
      setAuthBootstrapStatus: jest.fn(),
      completeBackendLogin: jest.fn(),
      markLoginFailed: jest.fn(),
      authBootstrapStatus: 'ready',
      normalizeInternalRoute: jest.fn((returnUrl?: string) => (
        returnUrl &&
        returnUrl.startsWith('/') &&
        !returnUrl.startsWith('//') &&
        returnUrl !== '/' &&
        !returnUrl.startsWith('/home') ?
          returnUrl :
          undefined
      )),
      isLoggedIn: false
    };
    router = {
      events: new Subject<NavigationEnd>(),
      url: '/home?auth=session-expired&returnUrl=%2Fworkspace-admin%2F1%2Ftest-results',
      navigateByUrl: jest.fn().mockResolvedValue(true),
      initialNavigation: jest.fn()
    };
    authSessionActivity = {
      start: jest.fn(),
      stop: jest.fn(),
      restart: jest.fn()
    };

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: AppService, useValue: appService },
        { provide: MatSnackBar, useValue: { dismiss: jest.fn(), open: jest.fn() } },
        { provide: AuthService, useValue: authService },
        { provide: AuthSessionActivityService, useValue: authSessionActivity },
        { provide: SystemNotificationService, useValue: { startPolling: jest.fn(), stopPolling: jest.fn() } },
        { provide: Router, useValue: router },
        { provide: LocationStrategy, useValue: { path: jest.fn().mockReturnValue('/') } }
      ]
    })
      .overrideComponent(AppComponent, {
        set: { template: '' }
      })
      .compileComponents();
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('reads the shared session and reflects clearing it without maintaining a second login flag', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.componentInstance.ngOnInit();
    const session = TestBed.inject(AuthSessionState);
    expect(fixture.componentInstance.isLoggedIn).toBe(session.isLoggedIn);
    expect(fixture.componentInstance.isLoggedIn()).toBe(true);
    session.clear();
    expect(fixture.componentInstance.isLoggedIn()).toBe(false);
    expect(Reflect.get(fixture.componentInstance.isLoggedIn, 'set')).toBeUndefined();
  });

  it('exchanges auth_code callbacks and restores the protected return URL without duplicating the hash', async () => {
    window.history.replaceState(
      null,
      '',
      '/?auth_code=exchange-code#/home?auth=session-expired&returnUrl=%2Fworkspace-admin%2F1%2Ftest-results'
    );

    const fixture = TestBed.createComponent(AppComponent);
    await fixture.componentInstance.ngOnInit();

    expect(authService.exchangeLoginCode).toHaveBeenCalledWith('exchange-code');
    expect(authService.setToken).toHaveBeenCalledWith('access-token');
    expect(authService.setIdToken).toHaveBeenCalledWith('id-token');
    expect(authService.setRefreshToken).toHaveBeenCalledWith('refresh-token');
    expect(appService.loadAuthenticatedUser).toHaveBeenCalledWith('oidc-user-id');
    await fixture.whenStable();
    expect(authSessionActivity.start).toHaveBeenCalled();
    expect(TestBed.inject(SystemNotificationService).startPolling).toHaveBeenCalled();
    expect(router.initialNavigation).toHaveBeenCalled();
    expect(window.location.href).toBe('http://localhost/#/workspace-admin/1/test-results');
    expect(window.location.href).not.toContain('auth_code=');
    expect(window.location.href).not.toContain('#/#');
  });

  it('starts the direct replay route only after a delayed callback and auth-data bootstrap', async () => {
    window.history.replaceState(null, '', '/?auth_code=delayed#/replay/person/UNIT?workspaceId=1&codingJobId=100&mode=coding');
    const exchange = new Subject<unknown>();
    const authData = new Subject<boolean>();
    authService.exchangeLoginCode.mockReturnValue(exchange);
    appService.loadAuthenticatedUser.mockReturnValue(authData);
    const component = TestBed.runInInjectionContext(() => new AppComponent());
    const startup = component.ngOnInit();

    expect(router.initialNavigation).not.toHaveBeenCalled();
    exchange.next({ access_token: 'new-token', refresh_token: 'new-refresh' });
    await new Promise<void>(resolve => { setTimeout(resolve, 0); });
    expect(appService.loadAuthenticatedUser).toHaveBeenCalledWith('oidc-user-id');
    expect(router.initialNavigation).not.toHaveBeenCalled();
    authData.next(true);
    await startup;

    expect(router.initialNavigation).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('');
    expect(window.location.hash).toContain('/replay/person/UNIT?workspaceId=1&codingJobId=100&mode=coding');
  });

  it('stops auth session activity on destroy', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.componentInstance.ngOnInit();

    fixture.destroy();

    expect(authSessionActivity.stop).toHaveBeenCalled();
    expect(TestBed.inject(SystemNotificationService).stopPolling).toHaveBeenCalled();
  });

  it('shows a classified callback error and removes diagnostics from the URL without starting another login', async () => {
    window.history.replaceState(null, '', '/?error=authentication_failed&auth_error=configuration-error&request_id=login-request#/home');
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.componentInstance.ngOnInit();
    expect(appService.markLoginFailed).toHaveBeenCalledWith('configuration-error', 'login-request');
    expect(authService.exchangeLoginCode).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
  });

  it('keeps failed login-code exchanges recoverable without an automatic redirect loop', async () => {
    window.history.replaceState(null, '', '/?auth_code=private-code#/home');
    authService.exchangeLoginCode.mockReturnValue(throwError(() => new HttpErrorResponse({
      status: 503, error: { code: 'provider-unavailable' }, headers: new HttpHeaders({ 'X-Request-Id': 'exchange-request' })
    })));
    const fixture = TestBed.createComponent(AppComponent);
    await expect(fixture.componentInstance.ngOnInit()).resolves.toBeUndefined();
    expect(appService.markLoginFailed).toHaveBeenCalledWith('provider-unavailable', 'exchange-request');
    expect(authService.setToken).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
  });

  it.each([0, 503])('classifies an unavailable exchange without a backend error code (HTTP %s)', async status => {
    window.history.replaceState(null, '', '/?auth_code=private-code#/home');
    authService.exchangeLoginCode.mockReturnValue(throwError(() => new HttpErrorResponse({ status })));
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.componentInstance.ngOnInit();
    expect(appService.markLoginFailed).toHaveBeenCalledWith('provider-unavailable', null);
    expect(authService.setToken).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
  });

  it('keeps bootstrap recoverable after an unavailable refresh and loads auth data after retry', async () => {
    authService.getValidToken.mockRejectedValue(new AuthRefreshUnavailableError());
    const fixture = TestBed.createComponent(AppComponent);
    await expect(fixture.componentInstance.ngOnInit()).resolves.toBeUndefined();
    expect(appService.setAuthBootstrapStatus).toHaveBeenCalledWith('refresh-unavailable');
    expect(appService.setAuthBootstrapStatus).not.toHaveBeenCalledWith('ready');
    expect(appService.loadAuthenticatedUser).not.toHaveBeenCalled();
    const component = fixture.componentInstance as unknown as { handleAuthenticationRestored(): Promise<void> };
    await component.handleAuthenticationRestored();
    expect(appService.loadAuthenticatedUser).toHaveBeenCalledWith('oidc-user-id');
  });
  it('notifies draft recovery after renewal in an already bootstrapped session', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.componentInstance.ngOnInit();
    const component = fixture.componentInstance as unknown as { handleAuthenticationRestored(): Promise<void> };
    await component.handleAuthenticationRestored();
    expect(appService.completeBackendLogin).toHaveBeenCalledTimes(1);
    expect(appService.loadAuthenticatedUser).toHaveBeenCalledTimes(1);
  });

  it('restores coding drafts when a background request recovers authentication', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.componentInstance.ngOnInit();
    authService.authenticationRecovered$.next();
    expect(appService.completeBackendLogin).toHaveBeenCalledTimes(1);
    expect(appService.loadAuthenticatedUser).toHaveBeenCalledTimes(1);
  });

  it('leaves the initial backend bootstrap in charge while it is running', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.componentInstance.ngOnInit();
    appService.authBootstrapStatus = 'backend-login-running';
    authService.authenticationRecovered$.next();
    expect(appService.completeBackendLogin).not.toHaveBeenCalled();
    expect(appService.loadAuthenticatedUser).toHaveBeenCalledTimes(1);
  });

  it('verifies backend authentication before restoring drafts after a JWKS outage', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.componentInstance.ngOnInit();
    appService.authProviderFailure = { code: 'provider-unavailable', requestId: 'provider-request' };
    const component = fixture.componentInstance as unknown as { handleAuthenticationRestored(): Promise<void> };
    await component.handleAuthenticationRestored();
    expect(appService.retryAuthDataLoad).toHaveBeenCalledTimes(1);
    expect(appService.loadAuthenticatedUser).toHaveBeenCalledTimes(1);
    expect(appService.completeBackendLogin).not.toHaveBeenCalled();
  });

  it('retries an interrupted auth-data bootstrap after successful renewal', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.componentInstance.ngOnInit();
    appService.authBootstrapStatus = 'auth-data-failed';
    const component = fixture.componentInstance as unknown as { handleAuthenticationRestored(): Promise<void> };
    await component.handleAuthenticationRestored();
    expect(appService.retryAuthDataLoad).toHaveBeenCalledTimes(1);
    expect(appService.loadAuthenticatedUser).toHaveBeenCalledTimes(1);
  });

  it('updates workspace state after asynchronous auth data arrives without zones', async () => {
    const authData = new Subject<AuthDataDto>();
    appService.authData$ = authData;
    router.url = '/workspace-admin/7/test-results';
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();

    authData.next({ ...AppService.defaultAuthData, workspaces: [{ id: 7, name: 'New workspace' }] } as AuthDataDto);
    await fixture.whenStable();

    expect(fixture.componentInstance.authData().workspaces[0].name).toBe('New workspace');
    expect(fixture.componentInstance.currentWorkspaceName()).toBe('New workspace');
  });

  it('restarts session activity after reauthentication is required and restored', async () => {
    const needsReAuthentication = signal(false);
    Object.defineProperty(appService, 'needsReAuthentication', { get: () => needsReAuthentication() });
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    authSessionActivity.start.mockClear();

    needsReAuthentication.set(true);
    await fixture.whenStable();
    expect(authSessionActivity.restart).toHaveBeenCalledTimes(1);
    expect(authSessionActivity.start).not.toHaveBeenCalled();

    needsReAuthentication.set(false);
    await fixture.whenStable();
    expect(authSessionActivity.start).toHaveBeenCalledTimes(1);
  });

  it('reports failed backend login and resets global error suppression', async () => {
    appService.loadAuthenticatedUser.mockReturnValue(of(false));
    const fixture = TestBed.createComponent(AppComponent);

    await expect(fixture.componentInstance.loadAuthData('oidc-user-id')).resolves.toBe(false);

    expect(TestBed.inject(MatSnackBar).open).toHaveBeenCalled();
    expect((appService as unknown as AppService).errorMessagesDisabled).toBe(false);
  });

  it('clears its auth-data failure hint on recovery without dismissing another action hint', async () => {
    const status = signal('auth-data-failed');
    Object.defineProperty(appService, 'authBootstrapStatus', { get: () => status() });
    appService.loadAuthenticatedUser.mockReturnValue(of(false));
    const snackBar = TestBed.inject(MatSnackBar) as unknown as { open: jest.Mock; dismiss: jest.Mock };
    const failureHint = { dismiss: jest.fn() };
    const actionHint = { dismiss: jest.fn() };
    snackBar.open.mockReturnValue(failureHint);
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    expect(snackBar.open).toHaveBeenCalled();
    expect(failureHint.dismiss).not.toHaveBeenCalled();

    snackBar.open.mockReturnValueOnce(actionHint);
    snackBar.open('Another action');
    status.set('backend-login-running');
    await fixture.whenStable();
    expect(failureHint.dismiss).not.toHaveBeenCalled();

    status.set('ready');
    await fixture.whenStable();
    expect(failureHint.dismiss).toHaveBeenCalledTimes(1);
    expect(actionHint.dismiss).not.toHaveBeenCalled();
    expect(snackBar.dismiss).not.toHaveBeenCalled();
  });
});
