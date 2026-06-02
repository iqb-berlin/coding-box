import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { OidcAuthService } from './oidc-auth.service';
import { CacheService } from '../../cache/cache.service';

describe('OidcAuthService', () => {
  let service: OidcAuthService;
  let cacheService: jest.Mocked<Pick<CacheService, 'set' | 'getAndDelete'>>;

  beforeEach(() => {
    cacheService = {
      set: jest.fn().mockResolvedValue(true),
      getAndDelete: jest.fn()
    };

    service = new OidcAuthService(
      {} as HttpService,
      {
        get: jest.fn().mockReturnValue('')
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
});
