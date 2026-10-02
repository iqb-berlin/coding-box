import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import { AppService } from './app.service';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let appService: jest.Mocked<Pick<AppService, 'serverUrl' | 'reAuthenticationReturnUrl' | 'createLoginRedirectUri' | 'markExplicitLogoutInProgress' | 'clearAuthState'>>;
  let locationMock: Pick<Location, 'href' | 'origin'>;
  let storageMock: {
    getItem: jest.Mock;
    setItem: jest.Mock;
    removeItem: jest.Mock;
  };
  let sessionStorageMock: {
    getItem: jest.Mock;
    setItem: jest.Mock;
    removeItem: jest.Mock;
  };
  let originalCryptoDescriptor: PropertyDescriptor | undefined;

  const createToken = (expiresInSeconds: number): string => {
    const payload = {
      sub: 'oidc-user-id',
      preferred_username: 'tester',
      exp: Math.floor(Date.now() / 1000) + expiresInSeconds
    };
    return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
  };

  beforeEach(() => {
    locationMock = { href: 'http://localhost/', origin: 'http://localhost' };

    storageMock = {
      getItem: jest.fn().mockReturnValue(null),
      setItem: jest.fn(),
      removeItem: jest.fn()
    };
    Object.defineProperty(window, 'localStorage', {
      value: storageMock,
      writable: true
    });

    sessionStorageMock = {
      getItem: jest.fn().mockReturnValue(null),
      setItem: jest.fn(),
      removeItem: jest.fn()
    };
    Object.defineProperty(window, 'sessionStorage', {
      value: sessionStorageMock,
      configurable: true
    });

    originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues: jest.fn((bytes: Uint8Array) => bytes.fill(1)),
        subtle: {
          digest: jest.fn().mockResolvedValue(new Uint8Array(32).fill(2).buffer)
        }
      }
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
        { provide: AppService, useValue: appService },
        { provide: DOCUMENT, useValue: { location: locationMock } }
      ]
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    if (originalCryptoDescriptor) {
      Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
    }
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should redirect with a browser-bound challenge and sanitized return URL', async () => {
    await service.login('/workspace-admin/1');

    expect(appService.createLoginRedirectUri).toHaveBeenCalledWith('/workspace-admin/1');
    const loginUrl = new URL(locationMock.href);
    expect(loginUrl.origin).toBe('http://localhost:3333');
    expect(loginUrl.pathname).toBe('/api/auth/login');
    expect(loginUrl.searchParams.get('redirect_uri')).toBe('http://localhost/#/coding');
    expect(loginUrl.searchParams.get('browser_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sessionStorageMock.setItem).toHaveBeenCalledWith(
      'oidc_login_verifier',
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)
    );
    expect(loginUrl.searchParams.get('browser_challenge')).not.toBe(
      sessionStorageMock.setItem.mock.calls[0][1]
    );
  });

  it('should fall back to the stored reauthentication return URL during login', async () => {
    await service.login();

    expect(appService.createLoginRedirectUri).toHaveBeenCalledWith('/coding');
  });

  it('should clear local auth state before logout', () => {
    service.logout();

    expect(appService.markExplicitLogoutInProgress).toHaveBeenCalled();
    expect(appService.clearAuthState).toHaveBeenCalledWith({ clearReAuthentication: true });
  });

  it('should exchange one-time login codes through the backend', () => {
    sessionStorageMock.getItem.mockReturnValue('V'.repeat(43));
    service.exchangeLoginCode('exchange-code').subscribe(response => {
      expect(response.access_token).toBe('access-token');
    });

    const req = httpMock.expectOne('http://localhost:3333/api/auth/exchange');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      code: 'exchange-code',
      browser_verifier: 'V'.repeat(43)
    });
    req.flush({
      access_token: 'access-token',
      token_type: 'Bearer',
      expires_in: 3600
    });
    expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('oidc_login_verifier');
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
