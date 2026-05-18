import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  HttpContext,
  provideHttpClient,
  withInterceptors
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { authInterceptor } from './auth.interceptor';
import { SUPPRESS_GLOBAL_HTTP_ERROR } from './http-error-context';
import { AppService } from '../services/app.service';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let appService: jest.Mocked<AppService>;
  let snackBar: { open: jest.Mock };

  beforeEach(() => {
    appService = {
      isBackendLoginRunning: jest.fn().mockReturnValue(false),
      requireReAuthentication: jest.fn(),
      addErrorMessage: jest.fn(),
      reAuthenticationReturnUrl: undefined
    } as unknown as jest.Mocked<AppService>;

    snackBar = {
      open: jest.fn()
    };

    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn().mockReturnValue('backend-token')
      },
      writable: true
    });

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AppService, useValue: appService },
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

  it('should suppress auth-data 401 errors while backend login is running', () => {
    appService.isBackendLoginRunning.mockReturnValue(true);

    http.get('/api/auth-data?identity=user-1').subscribe({
      error: () => {
      }
    });

    const req = httpMock.expectOne('/api/auth-data?identity=user-1');
    req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(appService.requireReAuthentication).not.toHaveBeenCalled();
    expect(appService.addErrorMessage).not.toHaveBeenCalled();
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('should handle other 401 errors as expired sessions without a duplicate global error', () => {
    appService.isBackendLoginRunning.mockReturnValue(false);

    http.get('/api/workspaces').subscribe({
      error: () => {
      }
    });

    const req = httpMock.expectOne('/api/workspaces');
    req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(appService.requireReAuthentication).toHaveBeenCalledWith('/home');
    expect(appService.addErrorMessage).not.toHaveBeenCalled();
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('should suppress global error messages when requested by request context', () => {
    const context = new HttpContext().set(SUPPRESS_GLOBAL_HTTP_ERROR, true);

    http.get('/api/admin/workspace/5/coding/freshness', { context }).subscribe({
      error: () => {
      }
    });

    const req = httpMock.expectOne('/api/admin/workspace/5/coding/freshness');
    req.flush('Gateway Timeout', { status: 504, statusText: 'Gateway Timeout' });

    expect(appService.requireReAuthentication).not.toHaveBeenCalled();
    expect(appService.addErrorMessage).not.toHaveBeenCalled();
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('should still handle suppressed 401 errors as expired sessions', () => {
    const context = new HttpContext().set(SUPPRESS_GLOBAL_HTTP_ERROR, true);

    http.get('/api/admin/workspace/5/coding/freshness', { context }).subscribe({
      error: () => {
      }
    });

    const req = httpMock.expectOne('/api/admin/workspace/5/coding/freshness');
    req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(appService.requireReAuthentication).toHaveBeenCalledWith('/home');
    expect(appService.addErrorMessage).not.toHaveBeenCalled();
    expect(snackBar.open).not.toHaveBeenCalled();
  });
});
