import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { UsersService } from '../database/services/users';

describe('JwtStrategy', () => {
  let usersService: jest.Mocked<Pick<UsersService, 'createOidcProviderUser'>>;

  const createStrategy = () => {
    usersService = {
      createOidcProviderUser: jest.fn().mockResolvedValue(42)
    };

    return new JwtStrategy({
      get: jest.fn((key: string) => ({
        OIDC_ISSUER: 'https://issuer.example.test',
        OIDC_JWKS_URI: 'https://issuer.example.test/certs',
        OAUTH2_CLIENT_ID: 'coding-box'
      })[key])
    } as unknown as ConfigService, usersService as unknown as UsersService);
  };

  it('accepts tokens issued for the configured client through azp', async () => {
    const strategy = createStrategy();

    await expect(strategy.validate({
      sub: 'oidc-user-id',
      iss: 'https://issuer.example.test',
      preferred_username: 'tester',
      azp: 'coding-box',
      email: 'tester@example.test',
      given_name: 'Test',
      family_name: 'User',
      realm_access: { roles: ['admin'] }
    })).resolves.toEqual(expect.objectContaining({
      id: 42,
      userId: 42,
      identity: 'oidc-user-id',
      isAdmin: true,
      sub: 'oidc-user-id'
    }));
    expect(usersService.createOidcProviderUser).toHaveBeenCalledWith({
      identity: 'oidc-user-id',
      issuer: 'https://issuer.example.test',
      username: 'tester',
      email: 'tester@example.test',
      firstName: 'Test',
      lastName: 'User',
      isAdmin: true
    });
  });

  it('accepts tokens issued for the configured client through aud', async () => {
    const strategy = createStrategy();

    await expect(strategy.validate({
      sub: 'oidc-user-id',
      preferred_username: 'tester',
      aud: ['account', 'coding-box']
    })).resolves.toEqual(expect.objectContaining({
      id: 42,
      identity: 'oidc-user-id'
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
    expect(usersService.createOidcProviderUser).not.toHaveBeenCalled();
  });

  it('rejects tokens without a subject', async () => {
    const strategy = createStrategy();

    await expect(strategy.validate({
      preferred_username: 'tester',
      azp: 'coding-box'
    })).rejects.toThrow(UnauthorizedException);
    expect(usersService.createOidcProviderUser).not.toHaveBeenCalled();
  });
});
