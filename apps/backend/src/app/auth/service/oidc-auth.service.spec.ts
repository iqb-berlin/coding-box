import { createHash } from 'crypto';
import { Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { OidcAuthService } from './oidc-auth.service';
import { CacheService } from '../../cache/cache.service';

describe('OidcAuthService', () => {
  let service: OidcAuthService;
  let cacheService: jest.Mocked<Pick<CacheService, 'set' | 'getAndDelete' | 'getAndDeleteIfFieldMatches'>>;
  let httpService: jest.Mocked<Pick<HttpService, 'post'>>;

  beforeEach(() => {
    cacheService = {
      set: jest.fn().mockResolvedValue(true),
      getAndDelete: jest.fn(),
      getAndDeleteIfFieldMatches: jest.fn()
    };
    httpService = {
      post: jest.fn()
    };

    service = new OidcAuthService(
      httpService as unknown as HttpService,
      {
        get: jest.fn((key: string) => ({
          OIDC_ISSUER: 'https://issuer.example.test/realms/coding-box',
          OIDC_TOKEN_ENDPOINT: 'https://issuer.example.test/token',
          OAUTH2_CLIENT_ID: 'coding-box',
          OAUTH2_CLIENT_SECRET: 'client-secret'
        })[key] || '')
      } as unknown as ConfigService,
      cacheService as unknown as CacheService
    );
  });

  it('uses the configured issuer for OIDC user identities', () => {
    expect(service.getIssuer()).toBe('https://issuer.example.test/realms/coding-box');
  });

  it('rejects missing issuer configuration before creating an OIDC identity', () => {
    const unconfiguredService = new OidcAuthService(
      httpService as unknown as HttpService,
      { get: () => undefined } as unknown as ConfigService,
      cacheService as unknown as CacheService
    );
    expect(() => unconfiguredService.getIssuer()).toThrow('OpenID Connect issuer configuration is missing');
  });

  it('stores server PKCE verifiers and browser challenges in the shared cache', async () => {
    await expect(service.storePkceVerifier('state-1', 'verifier-1', 'challenge-1')).resolves.toBe(true);

    expect(cacheService.set).toHaveBeenCalledWith(
      expect.stringMatching(/^oidc:pkce:[a-f0-9]{64}$/),
      { codeVerifier: 'verifier-1', browserChallenge: 'challenge-1' },
      300
    );
  });

  it('consumes PKCE verifiers atomically from the shared cache', async () => {
    cacheService.getAndDelete.mockResolvedValue({
      codeVerifier: 'verifier-1',
      browserChallenge: 'challenge-1'
    });

    await expect(service.consumePkceVerifier('state-1')).resolves.toEqual({
      codeVerifier: 'verifier-1',
      browserChallenge: 'challenge-1'
    });

    expect(cacheService.getAndDelete).toHaveBeenCalledWith(
      expect.stringMatching(/^oidc:pkce:[a-f0-9]{64}$/)
    );
  });

  it('returns null when a PKCE verifier is missing or expired', async () => {
    cacheService.getAndDelete.mockResolvedValue(null);

    await expect(service.consumePkceVerifier('state-1')).resolves.toBeNull();
  });

  it('stores login tokens bound to the initiating browser challenge', async () => {
    const verifier = 'B'.repeat(43);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const tokenResponse = {
      access_token: 'access-token',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'refresh-token'
    };

    const code = await service.storeTokenExchange(tokenResponse, challenge);

    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cacheService.set).toHaveBeenCalledWith(
      expect.stringMatching(/^oidc:token-exchange:[a-f0-9]{64}$/),
      { tokenResponse, browserChallenge: challenge },
      60
    );
  });

  it('redeems a login code only with the matching browser verifier', async () => {
    const verifier = 'B'.repeat(43);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const tokenResponse = {
      access_token: 'access-token',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'refresh-token'
    };
    cacheService.getAndDeleteIfFieldMatches.mockResolvedValue({
      tokenResponse,
      browserChallenge: challenge
    });

    await expect(service.consumeTokenExchange('exchange-code', verifier)).resolves.toEqual(tokenResponse);

    expect(cacheService.getAndDeleteIfFieldMatches).toHaveBeenCalledWith(
      expect.stringMatching(/^oidc:token-exchange:[a-f0-9]{64}$/),
      'browserChallenge',
      challenge
    );
  });

  it('does not consume a login code when the browser verifier does not match', async () => {
    const verifier = 'B'.repeat(43);
    cacheService.getAndDeleteIfFieldMatches.mockResolvedValue(null);

    await expect(service.consumeTokenExchange('exchange-code', verifier)).resolves.toBeNull();
    expect(cacheService.getAndDeleteIfFieldMatches).toHaveBeenCalled();

    cacheService.getAndDeleteIfFieldMatches.mockClear();
    await expect(service.consumeTokenExchange('exchange-code', 'short')).resolves.toBeNull();
    expect(cacheService.getAndDeleteIfFieldMatches).not.toHaveBeenCalled();
  });

  it('refreshes access tokens through the OIDC token endpoint', async () => {
    httpService.post.mockReturnValue(of({
      data: {
        access_token: 'fresh-access-token',
        token_type: 'Bearer',
        expires_in: 300,
        refresh_token: 'rotated-refresh-token'
      }
    }) as never);

    await expect(service.refreshToken('refresh-token')).resolves.toEqual({
      access_token: 'fresh-access-token',
      token_type: 'Bearer',
      expires_in: 300,
      refresh_token: 'rotated-refresh-token'
    });
    expect(httpService.post).toHaveBeenCalledWith(
      'https://issuer.example.test/token',
      expect.stringContaining('grant_type=refresh_token'),
      { timeout: 10_000, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    expect(httpService.post.mock.calls[0][1]).toContain('refresh_token=refresh-token');
    expect(httpService.post.mock.calls[0][1]).toContain('client_secret=client-secret');
  });

  it('rejects failed token refreshes', async () => {
    httpService.post.mockReturnValue(throwError(() => new Error('refresh failed')) as never);

    await expect(service.refreshToken('refresh-token')).rejects.toMatchObject({
      code: 'provider-unavailable'
    });
  });

  it.each([
    [400, 'invalid_grant', 401, 'session-invalid'],
    [400, 'invalid_client', 503, 'configuration-error'],
    [401, 'invalid_client', 503, 'configuration-error'],
    [403, 'access_denied', 503, 'configuration-error'],
    [429, 'temporarily_unavailable', 503, 'provider-unavailable'],
    [500, 'invalid_grant', 503, 'provider-unavailable'],
    [503, 'temporarily_unavailable', 503, 'provider-unavailable']
  ])('classifies provider HTTP %s / %s as %s / %s without exposing provider data', async (status, error, expectedStatus, code) => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      httpService.post.mockReturnValue(throwError(() => ({
        response: { status, data: { error, error_description: 'private-refresh-token' } },
        config: { data: 'client_secret=private-client-secret' }
      })) as never);
      const failure = await service.refreshToken('private-refresh-token', 'request-123').catch(value => value);
      expect(failure.getStatus()).toBe(expectedStatus);
      expect(failure.getResponse()).toEqual({ code, message: expect.any(String) });
      expect(warn).toHaveBeenCalledWith({
        event: 'oidc-refresh-failed',
        errorClass: code,
        endpoint: 'https://issuer.example.test/token',
        httpStatus: status,
        requestId: 'request-123'
      });
      expect(JSON.stringify([failure.getResponse(), warn.mock.calls])).not.toContain('private-');
    } finally {
      warn.mockRestore();
    }
  });

  it('reports missing token endpoint configuration separately from an invalid session', async () => {
    const unconfigured = new OidcAuthService(
      httpService as unknown as HttpService,
      { get: () => undefined } as unknown as ConfigService,
      cacheService as unknown as CacheService
    );
    await expect(unconfigured.refreshToken('refresh-token')).rejects.toMatchObject({ code: 'configuration-error' });
    expect(httpService.post).not.toHaveBeenCalled();
  });

  it('classifies a malformed provider success response as unavailable', async () => {
    httpService.post.mockReturnValue(of({ data: { message: 'unexpected provider page' } }) as never);
    await expect(service.refreshToken('refresh-token')).rejects.toMatchObject({ code: 'provider-unavailable' });
  });
});
