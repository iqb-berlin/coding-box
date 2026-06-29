import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { KeycloakJwksService } from './keycloak-jwks.service';
import { UsersService } from '../database/services/users';
import {
  WORKSPACE_API_TOKEN_TYPE,
  WORKSPACE_TOKEN_SCOPE_REPLAY_READ
} from './workspace-token';

describe('JwtStrategy', () => {
  const issuer = 'https://sso.example.test/realms/coding-box';
  let strategy: JwtStrategy;
  let usersService: {
    syncKeycloakUser: jest.Mock;
  };

  beforeEach(() => {
    const configValues: Record<string, string> = {
      JWT_SECRET: 'test-secret',
      OIDC_ISSUER: issuer,
      KEYCLOAK_CLIENT_ID: 'coding-box'
    };

    const configService = {
      get: jest.fn((key: string) => configValues[key])
    } as unknown as ConfigService;

    usersService = {
      syncKeycloakUser: jest.fn().mockResolvedValue(42)
    };

    strategy = new JwtStrategy(
      configService,
      {} as KeycloakJwksService,
      usersService as unknown as UsersService
    );
  });

  it('validates Keycloak tokens and syncs the user from trusted claims', async () => {
    await expect(strategy.validate({
      iss: issuer,
      sub: 'user-subject',
      preferred_username: 'alice',
      aud: ['account', 'coding-box'],
      email: 'alice@example.test',
      given_name: 'Alice',
      family_name: 'Example',
      realm_access: {
        roles: ['offline_access', 'admin']
      },
      resource_access: {
        'coding-box': {
          roles: ['coder']
        }
      }
    })).resolves.toEqual({
      userId: 42,
      id: 42,
      name: 'alice',
      workspace: '',
      identity: 'user-subject',
      issuer,
      roles: ['offline_access', 'admin', 'coder']
    });

    expect(usersService.syncKeycloakUser).toHaveBeenCalledWith({
      identity: 'user-subject',
      issuer,
      username: 'alice',
      isAdmin: true,
      email: 'alice@example.test',
      firstName: 'Alice',
      lastName: 'Example'
    });
  });

  it('rejects Keycloak tokens from untrusted issuers', async () => {
    await expect(strategy.validate({
      iss: 'https://other.example.test/realms/coding-box',
      sub: 'user-subject',
      preferred_username: 'alice',
      aud: 'coding-box'
    })).rejects.toBeInstanceOf(UnauthorizedException);

    expect(usersService.syncKeycloakUser).not.toHaveBeenCalled();
  });

  it('rejects Keycloak tokens for a different client', async () => {
    await expect(strategy.validate({
      iss: issuer,
      sub: 'user-subject',
      preferred_username: 'alice',
      aud: 'other-client',
      azp: 'other-client'
    })).rejects.toBeInstanceOf(UnauthorizedException);

    expect(usersService.syncKeycloakUser).not.toHaveBeenCalled();
  });

  it('keeps scoped workspace tokens valid for API special-token flows', async () => {
    await expect(strategy.validate({
      userId: 7,
      username: 'workspace-user',
      workspace: 11,
      tokenType: WORKSPACE_API_TOKEN_TYPE,
      scopes: [WORKSPACE_TOKEN_SCOPE_REPLAY_READ],
      sub: {
        identity: 'identity-1'
      }
    })).resolves.toEqual({
      userId: 7,
      id: 7,
      name: 'workspace-user',
      workspace: 11,
      identity: 'identity-1',
      tokenType: WORKSPACE_API_TOKEN_TYPE,
      scopes: [WORKSPACE_TOKEN_SCOPE_REPLAY_READ]
    });

    expect(usersService.syncKeycloakUser).not.toHaveBeenCalled();
  });

  it('rejects old internal session tokens without workspace scope', async () => {
    await expect(strategy.validate({
      userId: 7,
      username: 'session-user',
      sub: {
        identity: 'identity-1'
      }
    })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('keeps legacy workspace tokens authenticated but without endpoint scopes', async () => {
    await expect(strategy.validate({
      userId: 7,
      username: 'workspace-user',
      workspace: 11,
      sub: {
        identity: 'identity-1'
      }
    })).resolves.toEqual({
      userId: 7,
      id: 7,
      name: 'workspace-user',
      workspace: 11,
      identity: 'identity-1',
      tokenType: WORKSPACE_API_TOKEN_TYPE,
      scopes: []
    });
  });
});
