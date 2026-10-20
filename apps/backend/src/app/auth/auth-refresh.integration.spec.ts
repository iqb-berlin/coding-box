import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { AddressInfo } from 'net';
import { of, throwError } from 'rxjs';
import { AuthController } from './auth.controller';
import { AuthService } from './service/auth.service';
import { OidcAuthService } from './service/oidc-auth.service';
import { OAuth2ClientCredentialsService } from './service/oauth2-client-credentials.service';
import { CacheService } from '../cache/cache.service';
import { GlobalHttpExceptionFilter } from '../http/global-http-exception.filter';
import { requestIdMiddleware } from '../http/request-id.middleware';

describe('Auth refresh HTTP contract', () => {
  let app: INestApplication;
  let url: string;
  const post = jest.fn();
  let warn: jest.SpyInstance;
  let errorLog: jest.SpyInstance;

  beforeAll(async () => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        OidcAuthService,
        { provide: AuthService, useValue: {} },
        { provide: OAuth2ClientCredentialsService, useValue: {} },
        { provide: CacheService, useValue: {} },
        { provide: HttpService, useValue: { post } },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => ({ OIDC_TOKEN_ENDPOINT: 'https://issuer.test/token', OAUTH2_CLIENT_ID: 'coding-box' })[key] }
        }
      ]
    }).compile();
    app = module.createNestApplication();
    app.use(requestIdMiddleware);
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/auth/refresh`;
  });

  afterAll(async () => {
    await app?.close();
    warn?.mockRestore();
    errorLog?.mockRestore();
  });

  it.each([
    [400, 'invalid_grant', 401, 'session-invalid'],
    [401, 'invalid_client', 503, 'configuration-error'],
    [500, 'server_error', 503, 'provider-unavailable']
  ])('translates provider %s/%s to HTTP %s with safe diagnostics', async (providerStatus, providerCode, status, code) => {
    warn.mockClear();
    post.mockReturnValue(throwError(() => ({
      response: { status: providerStatus, data: { error: providerCode, error_description: 'private-provider-detail' } }
    })));
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'refresh-request-123' },
      body: JSON.stringify({ refresh_token: 'private-refresh-token' })
    });
    expect(response.status).toBe(status);
    expect(response.headers.get('X-Request-Id')).toBe('refresh-request-123');
    expect(await response.json()).toMatchObject({ code, statusCode: status, requestId: 'refresh-request-123' });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'refresh-request-123', errorClass: code }));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private-');
  });

  it('returns the refreshed token after recovery', async () => {
    post.mockReturnValue(of({ data: { access_token: 'fresh-token', refresh_token: 'rotated-token' } }));
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: 'refresh-token' })
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ access_token: 'fresh-token', refresh_token: 'rotated-token' });
  });
});
