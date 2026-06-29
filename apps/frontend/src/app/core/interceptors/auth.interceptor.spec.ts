import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  HttpContext,
  HttpHeaders,
  provideHttpClient,
  withInterceptors
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { authInterceptor } from './auth.interceptor';
import { SUPPRESS_GLOBAL_HTTP_ERROR } from './http-error-context';
import { AppService } from '../services/app.service';
import { AuthService } from '../services/auth.service';
import { SERVER_URL } from '../../injection-tokens';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let appService: jest.Mocked<AppService>;
  let authService: jest.Mocked<AuthService>;
  let snackBar: { open: jest.Mock };

  beforeEach(() => {
    appService = {
      isBackendLoginRunning: jest.fn().mockReturnValue(false),
      requireReAuthentication: jest.fn(),
      addErrorMessage: jest.fn(),
      needsReAuthentication: false,
      reAuthenticationReturnUrl: undefined
    } as unknown as jest.Mocked<AppService>;
    authService = {
      getValidToken: jest.fn().mockResolvedValue('keycloak-token')
    } as unknown as jest.Mocked<AuthService>;

    snackBar = {
      open: jest.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AppService, useValue: appService },
        { provide: AuthService, useValue: authService },
        { provide: SERVER_URL, useValue: 'api/' },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: Router, useValue: { url: '/home' } }
      ]
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should attach a fresh Keycloak access token to requests without explicit authorization', async () => {
    http.get('/api/workspaces').subscribe();

    await Promise.resolve();

    const req = httpMock.expectOne('/api/workspaces');
    expect(req.request.headers.get('Authorization')).toBe('Bearer keycloak-token');
    req.flush({});
  });

  it('should preserve existing request headers when adding authorization', async () => {
    http.post('/api/export/job', {}, {
      headers: new HttpHeaders({ Accept: 'application/json' })
    }).subscribe();

    await Promise.resolve();

    const req = httpMock.expectOne('/api/export/job');
    expect(req.request.headers.get('Accept')).toBe('application/json');
    expect(req.request.headers.get('Authorization')).toBe('Bearer keycloak-token');
    req.flush({});
  });

  it('should not attach authorization to non-backend requests', () => {
    http.get('/assets/i18n/de.json').subscribe();

    const req = httpMock.expectOne('/assets/i18n/de.json');
    expect(authService.getValidToken).not.toHaveBeenCalled();
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('should preserve explicit authorization headers for scoped API tokens', () => {
    http.get('/api/scoped', {
      headers: new HttpHeaders({ Authorization: 'Bearer scoped-token' })
    }).subscribe();

    const req = httpMock.expectOne('/api/scoped');
    expect(authService.getValidToken).not.toHaveBeenCalled();
    expect(req.request.headers.get('Authorization')).toBe('Bearer scoped-token');
    req.flush({});
  });

  it('should not attach a Keycloak token while reauthentication is required', () => {
    appService.needsReAuthentication = true;

    http.get('/api/workspaces').subscribe();

    const req = httpMock.expectOne('/api/workspaces');
    expect(authService.getValidToken).not.toHaveBeenCalled();
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('should suppress auth-data 401 errors while backend login is running', async () => {
    appService.isBackendLoginRunning.mockReturnValue(true);

    http.get('/api/auth-data?identity=user-1').subscribe({
      error: () => {
      }
    });

    await Promise.resolve();

    const req = httpMock.expectOne('/api/auth-data?identity=user-1');
    req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(appService.requireReAuthentication).not.toHaveBeenCalled();
    expect(appService.addErrorMessage).not.toHaveBeenCalled();
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('should handle other 401 errors as expired sessions without a duplicate global error', async () => {
    appService.isBackendLoginRunning.mockReturnValue(false);

    http.get('/api/workspaces').subscribe({
      error: () => {
      }
    });

    await Promise.resolve();

    const req = httpMock.expectOne('/api/workspaces');
    req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(appService.requireReAuthentication).toHaveBeenCalledWith('/home');
    expect(appService.addErrorMessage).not.toHaveBeenCalled();
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('should suppress global error messages when requested by request context', async () => {
    const context = new HttpContext().set(SUPPRESS_GLOBAL_HTTP_ERROR, true);

    http.get('/api/admin/workspace/5/coding/freshness', { context }).subscribe({
      error: () => {
      }
    });

    await Promise.resolve();

    const req = httpMock.expectOne('/api/admin/workspace/5/coding/freshness');
    req.flush('Gateway Timeout', { status: 504, statusText: 'Gateway Timeout' });

    expect(appService.requireReAuthentication).not.toHaveBeenCalled();
    expect(appService.addErrorMessage).not.toHaveBeenCalled();
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('should still handle suppressed 401 errors as expired sessions', async () => {
    const context = new HttpContext().set(SUPPRESS_GLOBAL_HTTP_ERROR, true);

    http.get('/api/admin/workspace/5/coding/freshness', { context }).subscribe({
      error: () => {
      }
    });

    await Promise.resolve();

    const req = httpMock.expectOne('/api/admin/workspace/5/coding/freshness');
    req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(appService.requireReAuthentication).toHaveBeenCalledWith('/home');
    expect(appService.addErrorMessage).not.toHaveBeenCalled();
    expect(snackBar.open).not.toHaveBeenCalled();
  });
});
