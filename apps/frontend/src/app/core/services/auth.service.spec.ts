import { TestBed } from '@angular/core/testing';
import { computed } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from './auth.service';
import { AppService } from './app.service';
import { authInterceptor } from '../interceptors/auth.interceptor';
import { SERVER_URL } from '../../injection-tokens';

jest.unmock('jwt-decode');

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let appService: jest.Mocked<Pick<AppService, 'serverUrl' | 'reAuthenticationReturnUrl' | 'createLoginRedirectUri' | 'markExplicitLogoutInProgress' | 'clearAuthState' | 'requireReAuthentication' | 'addErrorMessage'>>;
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

  function storeSession(): Map<string, string> {
    const tokens = new Map([
      ['auth_token', createToken(-30)],
      ['refresh_token', 'old-refresh-token'],
      ['id_token', 'old-id-token']
    ]);
    storageMock.getItem.mockImplementation(key => tokens.get(key) ?? null);
    storageMock.setItem.mockImplementation((key, value) => tokens.set(key, value));
    storageMock.removeItem.mockImplementation(key => tokens.delete(key));
    appService.clearAuthState.mockImplementation(() => tokens.clear());
    appService.requireReAuthentication.mockImplementation(() => tokens.clear());
    return tokens;
  }

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
      clearAuthState: jest.fn(),
      requireReAuthentication: jest.fn(),
      addErrorMessage: jest.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        AuthService,
        { provide: Router, useValue: { url: '/coding' } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: SERVER_URL, useValue: appService.serverUrl },
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

  it('updates derived authentication state when an OIDC callback stores a token', () => {
    let storedToken: string | null = null;
    storageMock.getItem.mockImplementation(key => (key === 'auth_token' ? storedToken : null));
    storageMock.setItem.mockImplementation((key, value) => {
      if (key === 'auth_token') storedToken = value;
    });
    const isLoggedIn = computed(() => service.isLoggedIn());
    expect(isLoggedIn()).toBe(false);

    service.setToken(createToken(300));

    expect(isLoggedIn()).toBe(true);
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
    expect(appService.requireReAuthentication).toHaveBeenCalledWith('/coding');
  });

  it.each(['logout', 'clearAuthState'])(
    'does not restore tokens when a refresh completes after %s', async action => {
      const tokens = storeSession();
      const pendingToken = service.getValidToken();
      const refresh = httpMock.expectOne('http://localhost:3333/api/auth/refresh');

      if (action === 'logout') {
        service.logout();
      } else {
        appService.clearAuthState();
      }
      expect(tokens.size).toBe(0);
      refresh.flush({
        access_token: createToken(300), id_token: 'late-id-token', refresh_token: 'late-refresh-token'
      });

      await expect(pendingToken).resolves.toBeUndefined();
      expect(tokens.size).toBe(0);
      expect(service.isLoggedIn()).toBe(false);
      if (action === 'logout') httpMock.expectOne('http://localhost:3333/api/auth/logout').flush({});
    }
  );

  it.each(['success', 'failure'])(
    'preserves a new login when an older refresh finishes with %s', async outcome => {
      const tokens = storeSession();
      const pendingToken = service.getValidToken();
      const refresh = httpMock.expectOne('http://localhost:3333/api/auth/refresh');
      const newToken = createToken(600);
      service.setToken(newToken);
      service.setRefreshToken('new-refresh-token');
      service.setIdToken('new-id-token');

      if (outcome === 'success') {
        refresh.flush({ access_token: createToken(300), refresh_token: 'late-refresh-token' });
      } else {
        refresh.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });
      }

      await expect(pendingToken).resolves.toBeUndefined();
      expect(tokens.get('auth_token')).toBe(newToken);
      expect(tokens.get('refresh_token')).toBe('new-refresh-token');
      expect(tokens.get('id_token')).toBe('new-id-token');
      expect(service.isLoggedIn()).toBe(true);
      expect(appService.requireReAuthentication).not.toHaveBeenCalled();
      expect(appService.addErrorMessage).not.toHaveBeenCalled();
    }
  );

  it('keeps a newer in-flight refresh shared when the old request finishes', async () => {
    const tokens = storeSession();
    const oldToken = service.getValidToken();
    const oldRefresh = httpMock.expectOne('http://localhost:3333/api/auth/refresh');
    service.setToken(createToken(-10));
    service.setRefreshToken('new-refresh-token');
    const newToken = service.getValidToken();
    const newRefresh = httpMock.expectOne('http://localhost:3333/api/auth/refresh');
    expect(newRefresh.request.body).toEqual({ refresh_token: 'new-refresh-token' });

    oldRefresh.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });
    await expect(oldToken).resolves.toBeUndefined();
    const sharedNewToken = service.getValidToken();
    httpMock.expectNone('http://localhost:3333/api/auth/refresh');
    const freshToken = createToken(600);
    newRefresh.flush({ access_token: freshToken, refresh_token: 'rotated-new-refresh-token' });

    await expect(newToken).resolves.toBe(freshToken);
    await expect(sharedNewToken).resolves.toBe(freshToken);
    expect(tokens.get('auth_token')).toBe(freshToken);
  });
});
