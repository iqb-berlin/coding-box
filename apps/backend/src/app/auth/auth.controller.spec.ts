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

  const encodedState = (redirectUri: string): string => `state:${encodeURIComponent(redirectUri)}`;

  beforeEach(() => {
    originalOAuth2RedirectUrl = process.env.OAUTH2_REDIRECT_URL;
    originalNodeEnv = process.env.NODE_ENV;
    process.env.OAUTH2_REDIRECT_URL = '//app.example.test/api/auth/callback';
    process.env.NODE_ENV = 'production';

    oidcAuthService = {
      generatePkcePair: jest.fn().mockReturnValue({
        codeVerifier: 'code-verifier',
        codeChallenge: 'code-challenge'
      }),
      storePkceVerifier: jest.fn().mockResolvedValue(true),
      getAuthorizationUrl: jest.fn().mockReturnValue('https://oidc.example.test/auth'),
      consumePkceVerifier: jest.fn().mockResolvedValue('code-verifier'),
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
      'https://app.example.test/workspace/1?token=access-token&id_token=id-token&refresh_token=refresh-token'
    );
    expect(json).not.toHaveBeenCalled();
  });

  it('returns JSON for successful callbacks with a disallowed redirect URL', async () => {
    await controller.callback('auth-code', encodedState('https://evil.example.test/phish'), response);

    expect(redirect).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      access_token: 'access-token',
      token_type: 'Bearer',
      expires_in: 3600
    }));
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
