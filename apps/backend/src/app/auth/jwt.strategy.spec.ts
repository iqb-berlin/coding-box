import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const createStrategy = () => new JwtStrategy({
    get: jest.fn((key: string) => ({
      OIDC_ISSUER: 'https://issuer.example.test',
      OIDC_JWKS_URI: 'https://issuer.example.test/certs',
      OAUTH2_CLIENT_ID: 'coding-box'
    })[key])
  } as unknown as ConfigService);

  it('accepts tokens issued for the configured client through azp', async () => {
    const strategy = createStrategy();

    await expect(strategy.validate({
      sub: 'oidc-user-id',
      preferred_username: 'tester',
      azp: 'coding-box',
      realm_access: { roles: ['admin'] }
    })).resolves.toEqual(expect.objectContaining({
      id: 'oidc-user-id',
      userId: 'oidc-user-id',
      isAdmin: true
    }));
  });

  it('accepts tokens issued for the configured client through aud', async () => {
    const strategy = createStrategy();

    await expect(strategy.validate({
      sub: 'oidc-user-id',
      preferred_username: 'tester',
      aud: ['account', 'coding-box']
    })).resolves.toEqual(expect.objectContaining({
      id: 'oidc-user-id'
    }));
  });

  it('rejects tokens for another client', async () => {
    const strategy = createStrategy();

    await expect(strategy.validate({
      sub: 'oidc-user-id',
      preferred_username: 'tester',
      azp: 'other-client',
      aud: ['account']
    })).rejects.toThrow(UnauthorizedException);
  });
});
