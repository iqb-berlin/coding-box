import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { of, throwError } from 'rxjs';
import { AuthController } from './auth.controller';
import { AuthService } from './service/auth.service';
import { OidcAuthService } from './service/oidc-auth.service';
import { OAuth2ClientCredentialsService } from './service/oauth2-client-credentials.service';
import { createRequestValidationPipe } from '../http/request-validation';
import { GlobalHttpExceptionFilter } from '../http/global-http-exception.filter';
import { requestIdMiddleware } from '../http/request-id.middleware';

describe('Auth request contracts over HTTP', () => {
  let app: INestApplication;
  let url: string;
  const token = { access_token: 'synthetic-token', token_type: 'Bearer', expires_in: 300 };
  const http = { post: jest.fn(), get: jest.fn() };
  const oidc = {
    consumeTokenExchange: jest.fn(),
    refreshToken: jest.fn(),
    logoutWithRefreshToken: jest.fn()
  };
  let warn: jest.SpyInstance;
  let errorLog: jest.SpyInstance;

  beforeAll(async () => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        OAuth2ClientCredentialsService,
        { provide: AuthService, useValue: {} },
        { provide: OidcAuthService, useValue: oidc },
        { provide: HttpService, useValue: http },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => ({
              OIDC_TOKEN_ENDPOINT: 'https://provider.test/token',
              OIDC_USERINFO_ENDPOINT: 'https://provider.test/userinfo'
            })[key]
          }
        }
      ]
    }).compile();
    app = module.createNestApplication();
    app.use(requestIdMiddleware);
    app.useGlobalPipes(createRequestValidationPipe());
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    http.post.mockReturnValue(of({ data: token }));
    http.get.mockReturnValue(of({ data: { sub: 'subject' } }));
    oidc.consumeTokenExchange.mockResolvedValue(token);
    oidc.refreshToken.mockResolvedValue(token);
    oidc.logoutWithRefreshToken.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await app?.close();
    warn.mockRestore();
    errorLog.mockRestore();
  });

  function post(route: string, body?: unknown): Promise<Response> {
    return fetch(`${url}/auth/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'auth-contract-probe' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  }

  const validBodies = [
    ['token', { client_id: 'client', client_secret: 'secret' }],
    ['validate', { access_token: 'token' }],
    ['exchange', { code: 'code', browser_verifier: 'V'.repeat(43) }],
    ['refresh', { refresh_token: 'token' }],
    ['logout', { refresh_token: 'token' }]
  ] as const;

  it.each(validBodies)('rejects missing, malformed and unknown fields at /auth/%s before calling services', async (route, valid) => {
    const field = Object.keys(valid)[0];
    for (const body of [undefined, null, [], {}, { ...valid, [field]: 7 }, { ...valid, [field]: {} },
      { ...valid, [field]: '' }, { ...valid, unexpected: true }]) {
      const response = await post(route, body);
      expect(response.status).toBe(400);
      expect(http.post).not.toHaveBeenCalled();
      expect(http.get).not.toHaveBeenCalled();
      Object.values(oidc).forEach(method => expect(method).not.toHaveBeenCalled());
    }
  });

  it.each(validBodies)('accepts the supported /auth/%s contract', async (route, body) => {
    expect((await post(route, body)).status).toBe(200);
  });

  it('rejects an invalid browser verifier without consuming the one-time code', async () => {
    expect((await post('exchange', { code: 'code', browser_verifier: 'invalid' })).status).toBe(400);
    expect(oidc.consumeTokenExchange).not.toHaveBeenCalled();
  });

  it.each(['token', 'validate'])('bounds provider calls at /auth/%s', async route => {
    await post(route, route === 'token' ? validBodies[0][1] : validBodies[1][1]);
    const call = route === 'token' ? http.post.mock.calls[0] : http.get.mock.calls[0];
    expect(call[route === 'token' ? 2 : 1]).toMatchObject({ timeout: 10_000 });
  });

  it.each([
    [401, 401, 'session-invalid'],
    [503, 503, 'provider-unavailable'],
    [404, 503, 'configuration-error'],
    [undefined, 503, 'provider-unavailable']
  ])('maps provider failure %s to HTTP %s with safe diagnostics', async (providerStatus, status, code) => {
    http.post.mockReturnValue(throwError(() => ({
      isAxiosError: true,
      response: providerStatus === undefined ? undefined : {
        status: providerStatus, data: { error_description: 'private-provider-detail' }
      }
    })));
    const response = await post('token', validBodies[0][1]);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code, requestId: 'auth-contract-probe' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private-provider-detail');
    expect(errorLog).not.toHaveBeenCalledWith(expect.stringContaining('private-provider-detail'));
  });

  it('treats a malformed successful provider response as unavailable', async () => {
    http.post.mockReturnValue(of({ data: {} }));
    expect((await post('token', validBodies[0][1])).status).toBe(503);
    http.get.mockReturnValue(of({ data: {} }));
    expect((await post('validate', validBodies[1][1])).status).toBe(503);
  });

  it('documents the runtime constraints for credentials', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    const body = document.paths['/auth/token'].post?.requestBody;
    if (!body || '$ref' in body) throw new Error('Missing credential request schema');
    expect(body.content['application/json'].schema).toMatchObject({
      required: ['client_id', 'client_secret'],
      additionalProperties: false,
      properties: { client_id: { type: 'string', minLength: 1 }, client_secret: { type: 'string', minLength: 1 } }
    });
  });
});
