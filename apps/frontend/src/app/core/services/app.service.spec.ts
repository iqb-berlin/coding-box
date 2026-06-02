import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { AppService } from './app.service';
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

describe('AppService', () => {
  let service: AppService;
  let httpMock: HttpTestingController;
  let logoServiceMock: jest.Mocked<LogoService>;

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
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('createOwnToken', () => {
    it('should request a self-service workspace token', () => {
      service.createOwnToken(7, 1).subscribe(token => {
        expect(token).toBe('signed-token');
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/7/token/1`);
      expect(req.request.method).toBe('GET');
      req.flush('signed-token');
    });
  });

  describe('createTokenForIdentity', () => {
    it('should request a workspace admin token for an encoded target identity', () => {
      service.createTokenForIdentity(7, 'issuer/user@example.test', 30).subscribe(token => {
        expect(token).toBe('admin-token');
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/7/issuer%2Fuser%40example.test/token/30`);
      expect(req.request.method).toBe('GET');
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
      const mockAuthData = { userId: 1 } as unknown as AuthDataDto;

      service.refreshAuthData();

      const req = httpMock.expectOne(`${mockServerUrl}auth-data?identity=user1`);
      expect(req.request.method).toBe('GET');
      expect(req.request.context.get(SUPPRESS_GLOBAL_HTTP_ERROR)).toBe(true);
      req.flush(mockAuthData);
    });
  });

  describe('auth state cleanup', () => {
    it('should clear stored auth state', () => {
      service.loggedUser = { sub: 'user1' } as DecodedToken;
      service.isLoggedIn = true;
      service.user = { username: 'user', isAdmin: false } as CreateUserDto;
      service.needsReAuthentication = true;
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
      expect(service.reAuthenticationReturnUrl).toBeUndefined();
      expect(service.authBootstrapStatus).toBe('ready');
    });

    it('should clear auth state and mark reauthentication as required', () => {
      service.requireReAuthentication('/coding');

      expect(localStorage.removeItem).toHaveBeenCalledWith('auth_token');
      expect(service.needsReAuthentication).toBe(true);
      expect(service.reAuthenticationReturnUrl).toBe('/coding');
      expect(service.authBootstrapStatus).toBe('session-expired');
    });

    it('should preserve an existing return URL if reauthentication is required without a new URL', () => {
      service.requireReAuthentication('/workspace-admin/1');
      service.requireReAuthentication();

      expect(service.reAuthenticationReturnUrl).toBe('/workspace-admin/1');
    });

    it('should clear reauthentication and return URL when explicitly requested', () => {
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
