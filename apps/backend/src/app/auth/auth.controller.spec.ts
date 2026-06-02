import { HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './service/auth.service';
import { OAuth2ClientCredentialsService } from './service/oauth2-client-credentials.service';
import { OidcAuthService } from './service/oidc-auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let oidcAuthService: jest.Mocked<Partial<OidcAuthService>>;
  let authService: jest.Mocked<Partial<AuthService>>;
  let response: Response;
  let redirect: jest.Mock;
  let json: jest.Mock;
  let status: jest.Mock;
  let originalOAuth2RedirectUrl: string | undefined;
  let originalNodeEnv: string | undefined;
  let originalHttpPort: string | undefined;
  let originalFrontendUrl: string | undefined;

  const encodedState = (redirectUri: string): string => `state:${encodeURIComponent(redirectUri)}`;

  beforeEach(() => {
    originalOAuth2RedirectUrl = process.env.OAUTH2_REDIRECT_URL;
    originalNodeEnv = process.env.NODE_ENV;
    originalHttpPort = process.env.HTTP_PORT;
    originalFrontendUrl = process.env.FRONTEND_URL;
    process.env.OAUTH2_REDIRECT_URL = '//app.example.test/api/auth/callback';
    process.env.NODE_ENV = 'production';
    delete process.env.HTTP_PORT;
    delete process.env.FRONTEND_URL;

    oidcAuthService = {
      generatePkcePair: jest.fn().mockReturnValue({
        codeVerifier: 'code-verifier',
        codeChallenge: 'code-challenge'
      }),
      storePkceVerifier: jest.fn().mockResolvedValue(true),
      getAuthorizationUrl: jest.fn().mockReturnValue('https://oidc.example.test/auth'),
      consumePkceVerifier: jest.fn().mockResolvedValue('code-verifier'),
      storeTokenExchange: jest.fn().mockResolvedValue('exchange-code'),
      consumeTokenExchange: jest.fn().mockResolvedValue({
        access_token: 'access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        id_token: 'id-token',
        refresh_token: 'refresh-token'
      }),
      exchangeCodeForToken: jest.fn().mockResolvedValue({
        access_token: 'access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        id_token: 'id-token',
        refresh_token: 'refresh-token'
      }),
      getUserInfo: jest.fn().mockResolvedValue({
        sub: 'subject',
        preferred_username: 'tester',
        given_name: 'Test',
        family_name: 'User',
        email: 'tester@example.test',
        realm_access: { roles: [] }
      })
    };

    authService = {
      storeOidcProviderUser: jest.fn().mockResolvedValue(undefined)
    };

    controller = new AuthController(
      {} as OAuth2ClientCredentialsService,
      oidcAuthService as unknown as OidcAuthService,
      authService as unknown as AuthService
    );

    redirect = jest.fn();
    json = jest.fn();
    status = jest.fn().mockReturnThis();
    response = { redirect, json, status } as unknown as Response;
  });

  afterEach(() => {
    if (originalOAuth2RedirectUrl === undefined) {
      delete process.env.OAUTH2_REDIRECT_URL;
    } else {
      process.env.OAUTH2_REDIRECT_URL = originalOAuth2RedirectUrl;
    }

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }

    if (originalHttpPort === undefined) {
      delete process.env.HTTP_PORT;
    } else {
      process.env.HTTP_PORT = originalHttpPort;
    }

    if (originalFrontendUrl === undefined) {
      delete process.env.FRONTEND_URL;
    } else {
      process.env.FRONTEND_URL = originalFrontendUrl;
    }
  });

  it('falls back to the login page when an error redirect points to another origin', async () => {
    await controller.callback('', encodedState('https://evil.example.test/phish'), response);

    expect(redirect).toHaveBeenCalledWith('/login?error=authentication_failed');
  });

  it('preserves allowed same-origin error redirects', async () => {
    await controller.callback('', encodedState('https://app.example.test/workspace/1?tab=checks'), response);

    expect(redirect).toHaveBeenCalledWith('https://app.example.test/workspace/1?tab=checks&error=authentication_failed');
  });

  it('redirects successful callbacks only to same-origin URLs', async () => {
    await controller.callback('auth-code', encodedState('/workspace/1'), response);

    expect(redirect).toHaveBeenCalledWith(
      'https://app.example.test/workspace/1?auth_code=exchange-code'
    );
    expect(oidcAuthService.storeTokenExchange).toHaveBeenCalledWith(expect.objectContaining({
      access_token: 'access-token',
      refresh_token: 'refresh-token'
    }));
    expect(json).not.toHaveBeenCalled();
  });

  it('allows the local frontend origin as a login redirect in development', async () => {
    process.env.NODE_ENV = 'development';
    process.env.OAUTH2_REDIRECT_URL = '//localhost:3333/api/auth/callback';
    process.env.HTTP_PORT = '4200';
    const frontendRedirectUri = 'http://localhost:4200/#/workspace-admin/1/test-results';

    await controller.login(response, frontendRedirectUri);

    expect(oidcAuthService.storePkceVerifier).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent(frontendRedirectUri)),
      'code-verifier'
    );

    await controller.callback('auth-code', encodedState(frontendRedirectUri), response);

    expect(redirect).toHaveBeenLastCalledWith(
      'http://localhost:4200/?auth_code=exchange-code#/workspace-admin/1/test-results'
    );
  });

  it('does not return tokens for successful callbacks with a disallowed redirect URL', async () => {
    await controller.callback('auth-code', encodedState('https://evil.example.test/phish'), response);

    expect(redirect).toHaveBeenCalledWith('/login?error=authentication_failed');
    expect(json).not.toHaveBeenCalled();
    expect(oidcAuthService.storeTokenExchange).not.toHaveBeenCalled();
  });

  it('exchanges a one-time login code for stored tokens', async () => {
    await expect(controller.exchangeLoginCode({ code: 'exchange-code' })).resolves.toEqual(
      expect.objectContaining({
        access_token: 'access-token',
        refresh_token: 'refresh-token'
      })
    );

    expect(oidcAuthService.consumeTokenExchange).toHaveBeenCalledWith('exchange-code');
  });

  it('rejects expired one-time login codes', async () => {
    oidcAuthService.consumeTokenExchange?.mockResolvedValue(null);

    await expect(controller.exchangeLoginCode({ code: 'expired-code' })).rejects.toThrow('Invalid or expired login code');
  });

  it('does not store disallowed login redirect URLs in the state parameter', async () => {
    await controller.login(response, 'https://evil.example.test/phish');

    expect(oidcAuthService.storePkceVerifier).toHaveBeenCalledWith(expect.not.stringContaining('evil.example.test'), 'code-verifier');
    expect(oidcAuthService.getAuthorizationUrl).toHaveBeenCalledWith(
      expect.not.stringContaining('evil.example.test'),
      'https://app.example.test/api/auth/callback',
      'code-challenge'
    );
    expect(redirect).toHaveBeenCalledWith('https://oidc.example.test/auth');
  });

  it('returns an error when login cannot store the PKCE verifier', async () => {
    oidcAuthService.storePkceVerifier?.mockResolvedValue(false);

    await controller.login(response, '/workspace/1');

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({ error: 'Failed to initiate login' });
  });
});
