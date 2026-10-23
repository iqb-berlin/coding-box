import {
  Controller, Get, INestApplication, Logger, Req, UseGuards
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync } from 'crypto';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtOrWorkspaceTokenAuthGuard } from './jwt-or-workspace-token-auth.guard';
import { WorkspaceTokenStrategy } from './workspace-token.strategy';
import { UsersService } from '../database/services/users';
import { GlobalHttpExceptionFilter } from '../http/global-http-exception.filter';
import { requestIdMiddleware } from '../http/request-id.middleware';
import { AllowWorkspaceTokenScopes, WORKSPACE_TOKEN_SCOPE_REPLAY_READ } from './workspace-token';
import { WORKSPACE_TOKEN_AUDIENCE, WORKSPACE_TOKEN_ISSUER, WORKSPACE_TOKEN_USE } from './workspace-token.constants';

@Controller()
class ProtectedController {
  @Get('jwt')
  @UseGuards(JwtAuthGuard)
  jwt(@Req() request: { user: unknown }) { return { authenticated: true, user: request.user }; }

  @Get('combined')
  @UseGuards(JwtOrWorkspaceTokenAuthGuard)
  @AllowWorkspaceTokenScopes(WORKSPACE_TOKEN_SCOPE_REPLAY_READ)
  combined(@Req() request: { user: unknown }) { return { authenticated: true, user: request.user }; }

  @Get('unscoped')
  @UseGuards(JwtOrWorkspaceTokenAuthGuard)
  unscoped() { return { authenticated: true }; }
}

describe('OIDC JWT verification over HTTP', () => {
  const issuer = 'https://issuer.example.test';
  const signingKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const wrongKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicJwk = {
    ...signingKey.publicKey.export({ format: 'jwk' }), kid: 'known', alg: 'RS256', use: 'sig'
  };
  const jwtService = new JwtService();
  const users = { createOidcProviderUser: jest.fn().mockResolvedValue(42) };
  let app: INestApplication;
  let jwks: Server;
  let jwksUrl: string;
  let appUrl: string;
  let providerStatus: number;
  let pauseProvider: boolean;
  let warn: jest.SpyInstance;

  const token = (claims = {}, options: JwtSignOptions = {}, key = signingKey.privateKey) => jwtService.sign(
    { sub: 'private-subject', azp: 'coding-box', ...claims },
    {
      privateKey: key.export({ format: 'pem', type: 'pkcs8' }),
      algorithm: 'RS256',
      keyid: 'known',
      issuer,
      expiresIn: 300,
      ...options
    }
  );

  const createApp = async (overrides: Record<string, unknown> = {}) => {
    const config = {
      OIDC_ISSUER: issuer,
      OIDC_JWKS_URI: jwksUrl,
      OAUTH2_CLIENT_ID: 'coding-box',
      JWT_SECRET: 'workspace-test-secret',
      ...overrides
    };
    const module = await Test.createTestingModule({
      controllers: [ProtectedController],
      providers: [
        JwtStrategy, WorkspaceTokenStrategy, JwtAuthGuard, JwtOrWorkspaceTokenAuthGuard,
        { provide: ConfigService, useValue: { get: (key: string) => config[key] } },
        { provide: UsersService, useValue: users }
      ]
    }).compile();
    app = module.createNestApplication();
    app.use(requestIdMiddleware);
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    appUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  };

  const request = (path: string, jwt = token()) => fetch(`${appUrl}/${path}`, {
    headers: { Authorization: `Bearer ${jwt}`, 'X-Request-Id': 'jwks-request-123' }
  });

  beforeEach(async () => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    users.createOidcProviderUser.mockClear();
    providerStatus = 200;
    pauseProvider = false;
    jwks = createServer((_req, response) => {
      if (pauseProvider) return;
      response.writeHead(providerStatus, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(providerStatus === 200 ? { keys: [publicJwk] } : { error: 'private-provider-detail' }));
    });
    await new Promise<void>(resolve => { jwks.listen(0, '127.0.0.1', resolve); });
    jwksUrl = `http://127.0.0.1:${(jwks.address() as AddressInfo).port}/certs?secret=private-query`;
    await createApp();
  });

  afterEach(async () => {
    await app?.close();
    jwks.closeAllConnections();
    if (jwks.listening) await new Promise<void>((resolve, reject) => { jwks.close(error => (error ? reject(error) : resolve())); });
    warn?.mockRestore();
  });

  it('accepts an actual signed token through both guards and reuses cached signing keys during an outage', async () => {
    expect((await request('jwt')).status).toBe(200);
    providerStatus = 503;
    expect((await request('combined')).status).toBe(200);
    expect(users.createOidcProviderUser).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['authorized party', { azp: 'coding-box', aud: 'other-service' }],
    ['single audience', { azp: 'other-client', aud: 'coding-box' }],
    ['audience list', { azp: undefined, aud: ['other-service', 'coding-box'] }]
  ])('maps a verified token with a matching %s to the local user through both guards', async (_label, clientClaims) => {
    const signedToken = token({
      ...clientClaims,
      preferred_username: 'oidc-test-user',
      given_name: 'Test',
      family_name: 'User',
      email: 'oidc-test-user@example.test',
      realm_access: { roles: ['admin'] }
    });
    for (const path of ['jwt', 'combined']) {
      const response = await request(path, signedToken);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        authenticated: true,
        user: {
          id: 42,
          userId: 42,
          name: 'oidc-test-user',
          firstName: 'Test',
          lastName: 'User',
          email: 'oidc-test-user@example.test',
          isAdmin: true,
          sub: 'private-subject',
          identity: 'private-subject',
          issuer
        }
      });
      expect(users.createOidcProviderUser).toHaveBeenLastCalledWith({
        identity: 'private-subject',
        issuer,
        username: 'oidc-test-user',
        email: 'oidc-test-user@example.test',
        firstName: 'Test',
        lastName: 'User',
        isAdmin: true
      });
    }
    expect(users.createOidcProviderUser).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['expired', () => token({}, { expiresIn: -1 })],
    ['wrong signature', () => token({}, {}, wrongKey.privateKey)],
    ['unknown key', () => token({}, { keyid: 'unknown' })],
    ['wrong issuer', () => token({}, { issuer: 'https://other.example.test' })],
    ['wrong client', () => token({ azp: 'other-client' })],
    ['wrong audience', () => token({ azp: undefined, aud: 'other-client' })],
    ['wrong audience list', () => token({ azp: 'other-client', aud: ['other-service', 'another-service'] })],
    ['missing client claims', () => token({ azp: undefined })],
    ['missing subject', () => token({ sub: undefined })],
    ['blank subject', () => token({ sub: '   ' })],
    ['disallowed RSA algorithm', () => token({}, { algorithm: 'RS512' })],
    ['HMAC signed with the public RSA key', () => jwtService.sign({ sub: 'private-subject', azp: 'coding-box' }, {
      secret: signingKey.publicKey.export({ format: 'pem', type: 'spki' }),
      algorithm: 'HS256',
      keyid: 'known',
      issuer,
      expiresIn: 300
    })],
    ['unsigned', () => jwtService.sign({ sub: 'private-subject', azp: 'coding-box' }, {
      algorithm: 'none', keyid: 'known', issuer, expiresIn: 300
    })],
    ['malformed', () => 'not-a-jwt']
  ])('keeps %s tokens unauthorized', async (_label, makeToken) => {
    for (const path of ['jwt', 'combined']) expect((await request(path, makeToken())).status).toBe(401);
    expect(users.createOidcProviderUser).not.toHaveBeenCalled();
  });

  it.each([
    ['modern', {
      token_use: WORKSPACE_TOKEN_USE, scopes: [WORKSPACE_TOKEN_SCOPE_REPLAY_READ]
    }, { issuer: WORKSPACE_TOKEN_ISSUER, audience: WORKSPACE_TOKEN_AUDIENCE }],
    ['legacy replay', { username: 'workspace-test-user' }, {}]
  ])('restricts %s workspace tokens to explicitly scoped routes without provisioning an OIDC user', async (_label, claims, options) => {
    const workspaceToken = jwtService.sign({ userId: 42, workspace: 1, ...claims }, {
      secret: 'workspace-test-secret', algorithm: 'HS256', expiresIn: 300, ...options
    });
    expect((await request('jwt', workspaceToken)).status).toBe(401);
    const scopedResponse = await request('combined', workspaceToken);
    expect(scopedResponse.status).toBe(200);
    expect(await scopedResponse.json()).toMatchObject({
      authenticated: true,
      user: {
        id: 42, userId: 42, workspace: 1, isWorkspaceToken: true, scopes: [WORKSPACE_TOKEN_SCOPE_REPLAY_READ]
      }
    });
    expect((await request('unscoped', workspaceToken)).status).toBe(401);
    expect(users.createOidcProviderUser).not.toHaveBeenCalled();
  });

  it('reports an unavailable JWKS provider as 503 through both guards with sanitized diagnostics', async () => {
    providerStatus = 500;
    for (const path of ['jwt', 'combined']) {
      const response = await request(`${path}?identity=private-subject`);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: 'provider-unavailable', requestId: 'jwks-request-123', path: `/${path}` });
    }
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({
      event: 'oidc-jwks-failed',
      errorClass: 'provider-unavailable',
      endpoint: jwksUrl.split('?')[0],
      httpStatus: 500,
      requestId: 'jwks-request-123'
    }));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private-');
    expect(users.createOidcProviderUser).not.toHaveBeenCalled();
  });

  it('bounds a hanging JWKS request and permits a later retry', async () => {
    pauseProvider = true;
    expect((await request('jwt')).status).toBe(503);
    pauseProvider = false;
    expect((await request('jwt')).status).toBe(200);
  }, 15_000);

  it('reports connection failures without accepting the token', async () => {
    await new Promise<void>(resolve => { jwks.close(() => resolve()); });
    const response = await request('jwt');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'provider-unavailable' });
    expect(users.createOidcProviderUser).not.toHaveBeenCalled();
  });

  it('distinguishes an inaccessible or incorrect JWKS endpoint from an invalid token', async () => {
    providerStatus = 404;
    const response = await request('jwt');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'configuration-error' });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ httpStatus: 404, errorClass: 'configuration-error' }));
    expect(users.createOidcProviderUser).not.toHaveBeenCalled();
  });

  it.each([
    { OIDC_ISSUER: undefined }, { OIDC_JWKS_URI: 'invalid' }, { OAUTH2_CLIENT_ID: '' }
  ])('fails closed for invalid configuration %j without breaking scoped workspace-token fallback', async overrides => {
    await app.close();
    await createApp(overrides);
    for (const path of ['jwt', 'combined']) {
      const response = await request(path);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: 'configuration-error' });
    }
    const workspaceToken = jwtService.sign({
      token_use: WORKSPACE_TOKEN_USE, userId: 42, workspace: 1, scopes: [WORKSPACE_TOKEN_SCOPE_REPLAY_READ]
    }, {
      secret: 'workspace-test-secret', algorithm: 'HS256', issuer: WORKSPACE_TOKEN_ISSUER, audience: WORKSPACE_TOKEN_AUDIENCE, expiresIn: 300
    });
    expect((await request('combined', workspaceToken)).status).toBe(200);
    expect((await request('unscoped', workspaceToken)).status).toBe(401);
    expect(users.createOidcProviderUser).not.toHaveBeenCalled();
  });
});
