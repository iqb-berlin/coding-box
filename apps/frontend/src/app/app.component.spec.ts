import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { signal } from '@angular/core';
import { LocationStrategy } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { Observable, Subject, of } from 'rxjs';
import { AppComponent } from './app.component';
import { AppService } from './core/services/app.service';
import { AuthService } from './core/services/auth.service';
import { AuthRefreshUnavailableError } from './core/interceptors/auth-refresh-unavailable.error';
import { AuthSessionActivityService } from './core/services/auth-session-activity.service';
import { SystemNotificationService } from './core/services/system-notification.service';
import { AuthDataDto } from '../../../../api-dto/auth-data-dto';

describe('AppComponent', () => {
  let authService: {
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
    setAuthBootstrapStatus: jest.Mock;
    completeBackendLogin: jest.Mock;
    authBootstrapStatus: string;
    normalizeInternalRoute: jest.Mock;
    isLoggedIn: boolean;
    loggedUser?: unknown;
  };
  let router: {
    events: Subject<NavigationEnd>;
    url: string;
    navigateByUrl: jest.Mock;
  };
  let authSessionActivity: {
    start: jest.Mock;
    stop: jest.Mock;
    restart: jest.Mock;
  };

  beforeEach(async () => {
    authService = {
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
      setAuthBootstrapStatus: jest.fn(),
      completeBackendLogin: jest.fn(),
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
      navigateByUrl: jest.fn().mockResolvedValue(true)
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
    expect(router.navigateByUrl).toHaveBeenCalledWith('/workspace-admin/1/test-results');
    expect(window.location.href).toBe('http://localhost/#/workspace-admin/1/test-results');
    expect(window.location.href).not.toContain('auth_code=');
    expect(window.location.href).not.toContain('#/#');
  });

  it('stops auth session activity on destroy', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.componentInstance.ngOnInit();

    fixture.destroy();

    expect(authSessionActivity.stop).toHaveBeenCalled();
    expect(TestBed.inject(SystemNotificationService).stopPolling).toHaveBeenCalled();
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

  it('retries an interrupted auth-data bootstrap after successful renewal', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.componentInstance.ngOnInit();
    appService.authBootstrapStatus = 'auth-data-failed';
    const component = fixture.componentInstance as unknown as { handleAuthenticationRestored(): Promise<void> };
    await component.handleAuthenticationRestored();
    expect(appService.loadAuthenticatedUser).toHaveBeenCalledTimes(2);
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
});
