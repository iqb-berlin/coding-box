import { provideZonelessChangeDetection, signal, WritableSignal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, Subject } from 'rxjs';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Event as RouterEvent, NavigationEnd, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LogoService } from '../../../core/services/logo.service';
import { SERVER_URL } from '../../../injection-tokens';
import { ErrorMessageDisplayComponent } from './error-message-display.component';
import { AppService } from '../../../core/services/app.service';
import { AuthService } from '../../../core/services/auth.service';
import { AppHttpError } from '../../../core/interceptors/app-http-error.class';
import { AuthRefreshUnavailableError } from '../../../core/interceptors/auth-refresh-unavailable.error';

describe('ErrorMessageDisplayComponent', () => {
  let fixture: ComponentFixture<ErrorMessageDisplayComponent>;
  let appService: {
    backendUnavailable: boolean;
    needsReAuthentication: boolean;
    sessionExpiryWarning: boolean;
    errorMessages: AppHttpError[];
    reAuthenticationReturnUrl?: string;
    setBackendUnavailable: jest.Mock;
    setNeedsReAuthentication: jest.Mock;
    setSessionExpiryWarning: jest.Mock;
    requireReAuthentication: jest.Mock;
    loginFailure?: { code: string; requestId: string };
    authProviderFailure?: { code: string; requestId: string };
    authBootstrapStatus?: string;
  };
  let authService: {
    refreshFailure: WritableSignal<AuthRefreshUnavailableError | null>;
    login: jest.Mock; getValidToken: jest.Mock; getSessionGeneration: jest.Mock; getRefreshToken: jest.Mock;
  };
  let router: { url: string; events: Subject<RouterEvent> };

  const navigate = (url: string) => {
    router.url = url;
    router.events.next(new NavigationEnd(1, url, url));
  };

  beforeEach(async () => {
    appService = {
      backendUnavailable: false,
      needsReAuthentication: true,
      sessionExpiryWarning: false,
      errorMessages: [],
      reAuthenticationReturnUrl: '/coding',
      setBackendUnavailable: jest.fn(),
      setNeedsReAuthentication: jest.fn(),
      setSessionExpiryWarning: jest.fn(),
      requireReAuthentication: jest.fn()
    };
    authService = {
      refreshFailure: signal<AuthRefreshUnavailableError | null>(null),
      login: jest.fn(),
      getSessionGeneration: jest.fn().mockReturnValue(0),
      getRefreshToken: jest.fn().mockReturnValue('refresh-token'),
      getValidToken: jest.fn().mockResolvedValue('token')
    };
    router = { url: '/home?auth=session-expired', events: new Subject<RouterEvent>() };

    await TestBed.configureTestingModule({
      imports: [ErrorMessageDisplayComponent, TranslateModule.forRoot()],
      providers: [
        { provide: AppService, useValue: appService },
        { provide: AuthService, useValue: authService },
        { provide: Router, useValue: router }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ErrorMessageDisplayComponent);
  });

  it('should hide the global reauthentication message on the home route', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('error.reauthentication_title');
  });

  it('shows an actionable login configuration failure with a request ID', () => {
    appService.loginFailure = { code: 'configuration-error', requestId: 'login-request' };
    fixture.detectChanges();
    const alert = fixture.nativeElement.querySelector('.auth-login-failed');
    expect(alert.textContent).toContain('error.auth_configuration_error_message');
    expect(alert.textContent).toContain('login-request');
    alert.querySelector('button').click();
    expect(authService.login).toHaveBeenCalled();
  });

  it('offers backend verification after a protected request fails because of the provider', () => {
    appService.needsReAuthentication = false;
    appService.authProviderFailure = { code: 'configuration-error', requestId: 'provider-request' };
    const restored = jest.fn();
    fixture.componentInstance.authenticationRestored.subscribe(restored);
    fixture.detectChanges();
    const banner = fixture.nativeElement.querySelector('.auth-refresh-unavailable');
    expect(banner.textContent).toContain('error.auth_configuration_error_message');
    expect(banner.textContent).toContain('provider-request');
    banner.querySelector('button').click();
    return fixture.whenStable().then(() => {
      expect(restored).toHaveBeenCalledTimes(1);
      expect(appService.requireReAuthentication).not.toHaveBeenCalled();
    });
  });

  it('prevents repeated retries while backend authentication is being verified', () => {
    appService.needsReAuthentication = false;
    appService.authProviderFailure = { code: 'provider-unavailable', requestId: 'provider-request' };
    appService.authBootstrapStatus = 'backend-login-running';
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('.auth-refresh-unavailable button');
    expect(button.disabled).toBe(true);
    button.click();
    expect(authService.getValidToken).not.toHaveBeenCalled();
  });

  it('should show the global reauthentication message outside the home route', () => {
    navigate('/coding');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('error.reauthentication_title');
  });

  it('should elevate priority errors while the global reauthentication message is visible', () => {
    navigate('/coding');
    fixture.detectChanges();

    const priorityErrors = fixture.nativeElement.querySelector('.priority-errors') as HTMLElement;
    expect(priorityErrors.classList.contains('re-authentication-active')).toBe(true);
  });

  it('should not offer dismissing the global reauthentication message', () => {
    navigate('/coding');
    fixture.detectChanges();

    const reauthenticationMessage = fixture.nativeElement.querySelector('.re-authentication') as HTMLElement;
    expect(reauthenticationMessage.querySelector('.close-button')).toBeNull();
  });

  it('should start login with the remembered return URL', () => {
    fixture.componentInstance.handleLogin();

    expect(authService.login).toHaveBeenCalledWith('/coding');
  });

  it('should show an idle session warning outside the home route', () => {
    navigate('/coding');
    appService.needsReAuthentication = false;
    appService.sessionExpiryWarning = true;

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('error.session_expiry_warning_title');
  });

  it('should extend the session from the idle warning', async () => {
    await fixture.componentInstance.handleExtendSession();

    expect(authService.getValidToken).toHaveBeenCalledWith(-1);
    expect(appService.setSessionExpiryWarning).toHaveBeenCalledWith(false);
    expect(appService.requireReAuthentication).not.toHaveBeenCalled();
  });

  it('should require reauthentication when extending the session fails', async () => {
    navigate('/coding');
    authService.getValidToken.mockRejectedValue(new Error('refresh failed'));

    await fixture.componentInstance.handleExtendSession();

    expect(appService.requireReAuthentication).toHaveBeenCalledWith('/coding');
  });

  it('keeps an unavailable renewal visible and offers retry without expiring the session', async () => {
    appService.needsReAuthentication = false;
    authService.refreshFailure.set(new AuthRefreshUnavailableError('provider-unavailable', 503, 'request-123'));
    authService.getValidToken.mockRejectedValue(new AuthRefreshUnavailableError());
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.auth-refresh-unavailable').textContent).toContain('request-123');
    await fixture.componentInstance.handleExtendSession();
    expect(appService.requireReAuthentication).not.toHaveBeenCalled();
    const restored = jest.fn();
    fixture.componentInstance.authenticationRestored.subscribe(restored);
    authService.getValidToken.mockImplementation(async () => {
      authService.refreshFailure.set(null);
      return 'fresh-token';
    });
    (fixture.nativeElement.querySelector('.auth-refresh-unavailable button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(restored).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('.auth-refresh-unavailable')).toBeNull();
    expect(appService.requireReAuthentication).not.toHaveBeenCalled();
  });

  it('hides an obsolete refresh outage after reauthentication has become necessary', () => {
    appService.needsReAuthentication = true;
    authService.refreshFailure.set(new AuthRefreshUnavailableError());
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.auth-refresh-unavailable')).toBeNull();
  });

  it.each(['discarded', 'failed'])('preserves a newer session when the old extension is %s', async outcome => {
    let finishRefresh!: (token: string | undefined) => void;
    let rejectRefresh!: (error: Error) => void;
    authService.getValidToken.mockReturnValue(new Promise((resolve, reject) => {
      finishRefresh = resolve;
      rejectRefresh = reject;
    }));
    const extending = fixture.componentInstance.handleExtendSession();
    authService.getRefreshToken.mockReturnValue('new-refresh-token');
    if (outcome === 'discarded') {
      finishRefresh(undefined);
    } else {
      rejectRefresh(new Error('obsolete refresh failed'));
    }
    await extending;

    expect(appService.requireReAuthentication).not.toHaveBeenCalled();
    expect(appService.setSessionExpiryWarning).not.toHaveBeenCalled();
  });

  it('should hide request details until the user expands them', () => {
    appService.errorMessages = [{
      id: 1,
      status: 504,
      message: 'Der Server antwortet gerade nicht.',
      method: '',
      urlWithParams: '',
      requestCount: 2,
      isBackendConnectivityError: true,
      affectedRequests: [
        { method: 'GET', urlWithParams: '/api/admin/users/access/5', requestId: 'request-a' },
        {
          method: 'POST',
          urlWithParams: '/api/admin/workspace/5/coding/statistics/job?version=v1',
          requestId: 'request-b'
        }
      ]
    } as AppHttpError];

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('error.requests_affected');
    expect(fixture.nativeElement.textContent).not.toContain('/api/admin/users/access/5');

    fixture.componentInstance.toggleErrorDetails(1);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('/api/admin/users/access/5');
    expect(fixture.nativeElement.textContent).toContain('/api/admin/workspace/5/coding/statistics/job?version=v1');
    expect(fixture.nativeElement.textContent).toContain('request-a');
    expect(fixture.nativeElement.textContent).toContain('request-b');
  });

  it('should render ordinary HTTP errors in the transient error layer', () => {
    appService.errorMessages = [{
      id: 3,
      status: 504,
      message: 'Der Server antwortet gerade nicht.',
      method: 'GET',
      urlWithParams: '/api/admin/workspace/5/coding/incomplete-variables',
      requestCount: 1,
      isBackendConnectivityError: true
    } as AppHttpError];

    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.transient-errors .other-error')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.priority-errors .other-error')).toBeNull();
  });

  it('should keep technical server messages hidden until details are expanded', () => {
    appService.errorMessages = [{
      id: 2,
      status: 500,
      message: 'Auf dem Server ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.',
      userMessage: 'Auf dem Server ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.',
      technicalMessage: 'Internal server error',
      requestId: 'request-123',
      occurredAt: '2026-05-18T10:42:00.000Z',
      method: 'GET',
      urlWithParams: '/api/admin/workspace/5/journal?page=1&limit=20',
      requestCount: 1,
      isBackendConnectivityError: false,
      affectedRequests: [
        { method: 'GET', urlWithParams: '/api/admin/workspace/5/journal?page=1&limit=20' }
      ]
    } as AppHttpError];

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Auf dem Server ist ein Fehler aufgetreten');
    expect(fixture.nativeElement.textContent).not.toContain('Internal server error');
    expect(fixture.nativeElement.textContent).not.toContain('/api/admin/workspace/5/journal');

    fixture.componentInstance.toggleErrorDetails(2);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Internal server error');
    expect(fixture.nativeElement.textContent).toContain('request-123');
    expect(fixture.nativeElement.textContent).toContain('/api/admin/workspace/5/journal?page=1&limit=20');
  });
});

describe('ErrorMessageDisplayComponent zoneless session warning', () => {
  let fixture: ComponentFixture<ErrorMessageDisplayComponent>;
  let appService: AppService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ErrorMessageDisplayComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: '/api/' },
        { provide: LogoService, useValue: { getLogoSettings: () => of(null) } },
        {
          provide: AuthService,
          useValue: {
            refreshFailure: signal(null),
            getValidToken: jest.fn().mockResolvedValue('token'),
            getSessionGeneration: jest.fn().mockReturnValue(0),
            getRefreshToken: jest.fn().mockReturnValue('refresh-token')
          }
        },
        { provide: Router, useValue: { url: '/coding', events: new Subject<RouterEvent>() } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(ErrorMessageDisplayComponent);
    appService = TestBed.inject(AppService);
    await fixture.whenStable();
  });

  it('renders an asynchronous warning and clears it after extending the session', async () => {
    expect(fixture.nativeElement.querySelector('.session-expiry-warning')).toBeNull();
    await Promise.resolve().then(() => appService.setSessionExpiryWarning(true));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.session-expiry-warning')).not.toBeNull();

    await fixture.componentInstance.handleExtendSession();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.session-expiry-warning')).toBeNull();
  });

  it('replaces the warning with reauthentication when the session expires', async () => {
    appService.setSessionExpiryWarning(true);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.session-expiry-warning')).not.toBeNull();

    appService.requireReAuthentication('/coding');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.session-expiry-warning')).toBeNull();
    expect(fixture.nativeElement.querySelector('.re-authentication')).not.toBeNull();
  });
});
