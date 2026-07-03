import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { OidcAuthService } from './oidc-auth.service';
import { CacheService } from '../../cache/cache.service';

describe('OidcAuthService', () => {
  let service: OidcAuthService;
  let cacheService: jest.Mocked<Pick<CacheService, 'set' | 'getAndDelete'>>;
  let httpService: jest.Mocked<Pick<HttpService, 'post'>>;

  beforeEach(() => {
    cacheService = {
      set: jest.fn().mockResolvedValue(true),
      getAndDelete: jest.fn()
    };
    httpService = {
      post: jest.fn()
    };

    service = new OidcAuthService(
      httpService as unknown as HttpService,
      {
        get: jest.fn((key: string) => ({
          OIDC_TOKEN_ENDPOINT: 'https://issuer.example.test/token',
          OAUTH2_CLIENT_ID: 'coding-box',
          OAUTH2_CLIENT_SECRET: 'client-secret'
        })[key] || '')
      } as unknown as ConfigService,
      cacheService as unknown as CacheService
    );
  });

  it('stores PKCE verifiers in the shared cache', async () => {
    await expect(service.storePkceVerifier('state-1', 'verifier-1')).resolves.toBe(true);

    expect(cacheService.set).toHaveBeenCalledWith(
      expect.stringMatching(/^oidc:pkce:[a-f0-9]{64}$/),
      { codeVerifier: 'verifier-1' },
      300
    );
  });

  it('consumes PKCE verifiers atomically from the shared cache', async () => {
    cacheService.getAndDelete.mockResolvedValue({ codeVerifier: 'verifier-1' });

    await expect(service.consumePkceVerifier('state-1')).resolves.toBe('verifier-1');

    expect(cacheService.getAndDelete).toHaveBeenCalledWith(
      expect.stringMatching(/^oidc:pkce:[a-f0-9]{64}$/)
    );
  });

  it('returns null when a PKCE verifier is missing or expired', async () => {
    cacheService.getAndDelete.mockResolvedValue(null);

    await expect(service.consumePkceVerifier('state-1')).resolves.toBeNull();
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
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    expect(httpService.post.mock.calls[0][1]).toContain('refresh_token=refresh-token');
    expect(httpService.post.mock.calls[0][1]).toContain('client_secret=client-secret');
  });

  it('rejects failed token refreshes', async () => {
    httpService.post.mockReturnValue(throwError(() => new Error('refresh failed')) as never);

    await expect(service.refreshToken('refresh-token')).rejects.toThrow('Failed to refresh access token');
  });
});
