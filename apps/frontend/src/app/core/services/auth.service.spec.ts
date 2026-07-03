import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import { AppService } from './app.service';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let appService: jest.Mocked<Pick<AppService, 'serverUrl' | 'reAuthenticationReturnUrl' | 'createLoginRedirectUri' | 'markExplicitLogoutInProgress' | 'clearAuthState'>>;
  let originalLocation: Location;
  let storageMock: {
    getItem: jest.Mock;
    setItem: jest.Mock;
    removeItem: jest.Mock;
  };

  const createToken = (expiresInSeconds: number): string => {
    const payload = {
      sub: 'oidc-user-id',
      preferred_username: 'tester',
      exp: Math.floor(Date.now() / 1000) + expiresInSeconds
    };
    return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
  };

  beforeEach(() => {
    originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: {
        ...originalLocation,
        href: 'http://localhost/'
      },
      writable: true
    });

    storageMock = {
      getItem: jest.fn().mockReturnValue(null),
      setItem: jest.fn(),
      removeItem: jest.fn()
    };
    Object.defineProperty(window, 'localStorage', {
      value: storageMock,
      writable: true
    });

    appService = {
      serverUrl: 'http://localhost:3333/api/',
      reAuthenticationReturnUrl: '/coding',
      createLoginRedirectUri: jest.fn().mockReturnValue('http://localhost/#/coding'),
      markExplicitLogoutInProgress: jest.fn(),
      clearAuthState: jest.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        AuthService,
        { provide: AppService, useValue: appService }
      ]
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true
    });
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should redirect to the backend login endpoint with a sanitized return URL', () => {
    service.login('/workspace-admin/1');

    expect(appService.createLoginRedirectUri).toHaveBeenCalledWith('/workspace-admin/1');
    expect(window.location.href).toBe(
      'http://localhost:3333/api/auth/login?redirect_uri=http%3A%2F%2Flocalhost%2F%23%2Fcoding'
    );
  });

  it('should fall back to the stored reauthentication return URL during login', () => {
    service.login();

    expect(appService.createLoginRedirectUri).toHaveBeenCalledWith('/coding');
  });

  it('should clear local auth state before logout', () => {
    service.logout();

    expect(appService.markExplicitLogoutInProgress).toHaveBeenCalled();
    expect(appService.clearAuthState).toHaveBeenCalledWith({ clearReAuthentication: true });
  });

  it('should exchange one-time login codes through the backend', () => {
    service.exchangeLoginCode('exchange-code').subscribe(response => {
      expect(response.access_token).toBe('access-token');
    });

    const req = httpMock.expectOne('http://localhost:3333/api/auth/exchange');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ code: 'exchange-code' });
    req.flush({
      access_token: 'access-token',
      token_type: 'Bearer',
      expires_in: 3600
    });
  });

  it('should refresh expired access tokens with the stored refresh token', async () => {
    const expiredToken = createToken(-30);
    const freshToken = createToken(300);
    storageMock.getItem.mockImplementation((key: string) => ({
      auth_token: expiredToken,
      refresh_token: 'refresh-token'
    })[key] ?? null);

    const tokenPromise = service.getValidToken();

    const req = httpMock.expectOne('http://localhost:3333/api/auth/refresh');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ refresh_token: 'refresh-token' });
    req.flush({
      access_token: freshToken,
      token_type: 'Bearer',
      expires_in: 300,
      id_token: 'fresh-id-token',
      refresh_token: 'rotated-refresh-token'
    });

    await expect(tokenPromise).resolves.toBe(freshToken);
    expect(storageMock.setItem).toHaveBeenCalledWith('auth_token', freshToken);
    expect(storageMock.setItem).toHaveBeenCalledWith('id_token', 'fresh-id-token');
    expect(storageMock.setItem).toHaveBeenCalledWith('refresh_token', 'rotated-refresh-token');
  });

  it('should clear stored tokens when refresh fails', async () => {
    storageMock.getItem.mockImplementation((key: string) => ({
      auth_token: createToken(-30),
      refresh_token: 'refresh-token'
    })[key] ?? null);

    const tokenPromise = service.getValidToken();

    const req = httpMock.expectOne('http://localhost:3333/api/auth/refresh');
    req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    await expect(tokenPromise).resolves.toBeUndefined();
    expect(storageMock.removeItem).toHaveBeenCalledWith('auth_token');
    expect(storageMock.removeItem).toHaveBeenCalledWith('id_token');
    expect(storageMock.removeItem).toHaveBeenCalledWith('refresh_token');
  });
});
