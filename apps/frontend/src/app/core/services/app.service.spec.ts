import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { of } from 'rxjs';
import { KeycloakTokenParsed } from 'keycloak-js';
import { AppService } from './app.service';
import { LogoService } from './logo.service';
import { SERVER_URL } from '../../injection-tokens';
import { CreateUserDto } from '../../../../../../api-dto/user/create-user-dto';
import { AuthDataDto } from '../../../../../../api-dto/auth-data-dto';
import { AppHttpError } from '../interceptors/app-http-error.class';

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

  describe('keycloakLogin', () => {
    it('should login and fetch auth data on success', () => {
      const mockToken = 'new-token';
      const mockUser = { username: 'user', identity: 'id1' } as unknown as CreateUserDto;
      const mockAuthData = { userId: 1, userName: 'user' } as unknown as AuthDataDto;

      service.keycloakLogin(mockUser).subscribe(result => {
        expect(result).toBe(true);
        expect(localStorage.setItem).toHaveBeenCalledWith('id_token', mockToken);
        expect(service.authBootstrapStatus).toBe('ready');
      });

      expect(service.authBootstrapStatus).toBe('backend-login-running');

      // 1. Login POST
      const reqLogin = httpMock.expectOne(`${mockServerUrl}keycloak-login`);
      expect(reqLogin.request.method).toBe('POST');
      reqLogin.flush(mockToken);

      // 2. Auth Data GET
      const reqAuth = httpMock.expectOne(`${mockServerUrl}auth-data?identity=id1`);
      expect(reqAuth.request.method).toBe('GET');
      reqAuth.flush(mockAuthData);
    });

    it('should return false on login failure', () => {
      const mockUser = { username: 'user' } as unknown as CreateUserDto;

      service.keycloakLogin(mockUser).subscribe(result => {
        expect(result).toBe(false);
        expect(service.authBootstrapStatus).toBe('auth-data-failed');
      });

      const reqLogin = httpMock.expectOne(`${mockServerUrl}keycloak-login`);
      reqLogin.flush('Error', { status: 401, statusText: 'Unauthorized' });
    });
  });

  describe('refreshAuthData', () => {
    it('should refresh data if user is logged in', () => {
      service.loggedUser = { sub: 'user1' } as KeycloakTokenParsed;
      service.setAuthBootstrapStatus('ready');
      const mockAuthData = { userId: 1 } as unknown as AuthDataDto;

      service.refreshAuthData();

      const req = httpMock.expectOne(`${mockServerUrl}auth-data?identity=user1`);
      expect(req.request.method).toBe('GET');
      req.flush(mockAuthData);
    });

    it('should not refresh data while backend login is still running', () => {
      service.loggedUser = { sub: 'user1' } as KeycloakTokenParsed;
      service.setAuthBootstrapStatus('backend-login-running');

      service.refreshAuthData();

      httpMock.expectNone(`${mockServerUrl}auth-data?identity=user1`);
    });
  });

  describe('auth state cleanup', () => {
    it('should clear stored auth state', () => {
      service.loggedUser = { sub: 'user1' } as KeycloakTokenParsed;
      service.isLoggedInKeycloak = true;
      service.kcUser = { username: 'user' } as CreateUserDto;
      service.needsReAuthentication = true;
      service.reAuthenticationReturnUrl = '/coding';
      service.updateAuthData({ userId: 1, userName: 'user' } as AuthDataDto);

      service.clearAuthState();

      expect(localStorage.removeItem).toHaveBeenCalledWith('id_token');
      expect(service.loggedUser).toBeUndefined();
      expect(service.kcUser).toBeUndefined();
      expect(service.isLoggedInKeycloak).toBe(false);
      expect(service.authData).toEqual(AppService.defaultAuthData);
      expect(service.needsReAuthentication).toBe(false);
      expect(service.reAuthenticationReturnUrl).toBeUndefined();
      expect(service.authBootstrapStatus).toBe('ready');
    });

    it('should clear auth state and mark reauthentication as required', () => {
      service.requireReAuthentication('/coding');

      expect(localStorage.removeItem).toHaveBeenCalledWith('id_token');
      expect(service.needsReAuthentication).toBe(true);
      expect(service.reAuthenticationReturnUrl).toBe('/coding');
      expect(service.authBootstrapStatus).toBe('session-expired');
    });

    it('should preserve an existing return URL if reauthentication is required without a new URL', () => {
      service.requireReAuthentication('/workspace-admin/1');
      service.requireReAuthentication();

      expect(service.reAuthenticationReturnUrl).toBe('/workspace-admin/1');
    });

    it('should clear the return URL when reauthentication is dismissed', () => {
      service.requireReAuthentication('/workspace-admin/1');

      service.setNeedsReAuthentication(false);

      expect(service.needsReAuthentication).toBe(false);
      expect(service.reAuthenticationReturnUrl).toBeUndefined();
    });

    it('should reject external login redirect targets', () => {
      expect(service.normalizeInternalRoute('https://example.test')).toBeUndefined();
      expect(service.normalizeInternalRoute('//example.test')).toBeUndefined();
    });

    it('should create hash-based login redirect URIs for internal routes', () => {
      expect(service.createLoginRedirectUri('/coding')).toBe('http://localhost/#/coding');
    });

    it('should clear stale authentication error messages after backend login succeeds', () => {
      const authError = { status: 401 } as AppHttpError;
      const otherError = { status: 500 } as AppHttpError;
      service.errorMessages = [authError, otherError];

      service.completeBackendLogin();

      expect(service.errorMessages).toEqual([otherError]);
      expect(service.needsReAuthentication).toBe(false);
      expect(service.authBootstrapStatus).toBe('ready');
    });
  });
});
