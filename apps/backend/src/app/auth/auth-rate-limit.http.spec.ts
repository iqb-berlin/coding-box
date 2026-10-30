import {
  Controller, Get, INestApplication, Logger
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthRateLimitModule } from './auth-rate-limit.module';
import { AUTH_RATE_LIMIT_REDIS } from './auth-rate-limit.storage';
import { AuthService } from './service/auth.service';
import { OidcAuthService } from './service/oidc-auth.service';
import { OAuth2ClientCredentialsService } from './service/oauth2-client-credentials.service';
import { GlobalHttpExceptionFilter } from '../http/global-http-exception.filter';
import { createRequestValidationPipe } from '../http/request-validation';
import { parseTrustedProxies } from '../http/trusted-proxies';

@Controller('health')
class HealthProbeController {
  @Get()
  check(): string { return 'ok'; }
}

describe('authentication limits over HTTP', () => {
  const counters = new Map<string, number>();
  const refreshToken = jest.fn().mockResolvedValue({ access_token: 'fresh-token' });
  const redis = {
    status: 'ready',
    disconnect: jest.fn(),
    eval: jest.fn(async (_script: string, _keys: number, key: string, _ttl: number, limit: number) => {
      const count = (counters.get(key) || 0) + 1;
      counters.set(key, count);
      return [count, 60, count > limit ? 1 : 0, count > limit ? 60 : 0];
    })
  };
  let apps: INestApplication[];
  let urls: string[];
  let errorLog: jest.SpyInstance;

  beforeAll(async () => {
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    apps = await Promise.all([false, false].map(async () => {
      const module = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            ignoreEnvVars: true,
            load: [() => ({ AUTH_RATE_LIMIT_LIMIT: 2, AUTH_RATE_LIMIT_TTL_MS: 60_000 })]
          }),
          AuthRateLimitModule
        ],
        controllers: [AuthController, HealthProbeController],
        providers: [
          { provide: AuthService, useValue: {} },
          { provide: OidcAuthService, useValue: { refreshToken } },
          { provide: OAuth2ClientCredentialsService, useValue: {} }
        ]
      }).overrideProvider(AUTH_RATE_LIMIT_REDIS).useValue(redis).compile();
      const app = module.createNestApplication();
      app.useGlobalPipes(createRequestValidationPipe());
      app.useGlobalFilters(new GlobalHttpExceptionFilter());
      await app.listen(0, '127.0.0.1');
      return app;
    }));
    urls = await Promise.all(apps.map(app => app.getUrl()));
  });

  beforeEach(() => {
    counters.clear();
    refreshToken.mockClear();
    redis.status = 'ready';
    apps.forEach(app => app.getHttpAdapter().getInstance().set('trust proxy', false));
  });

  afterAll(async () => {
    await Promise.all(apps?.map(app => app.close()) || []);
    errorLog?.mockRestore();
  });

  const post = (base: string, forwardedFor?: string, route = 'refresh') => fetch(`${base}/auth/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}) },
    body: JSON.stringify({ refresh_token: 'synthetic-token' })
  });

  it('shares limits across API replicas and blocks before the provider is called', async () => {
    expect((await post(urls[0])).status).toBe(200);
    const lastAllowed = await post(urls[1]);
    expect(lastAllowed.status).toBe(200);
    expect(lastAllowed.headers.get('x-ratelimit-remaining')).toBe('0');
    const blocked = await post(urls[0]);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('60');
    expect(await blocked.json()).toMatchObject({ statusCode: 429 });
    expect(refreshToken).toHaveBeenCalledTimes(2);
    expect((await fetch(`${urls[0]}/health`)).status).toBe(200);
  });

  it('ignores spoofed forwarded headers from an untrusted connection', async () => {
    await post(urls[0], '192.0.2.1');
    await post(urls[0], '192.0.2.2');
    expect((await post(urls[0], '192.0.2.3')).status).toBe(429);
  });

  it('separates clients behind an explicitly trusted proxy and uses the nearest untrusted address', async () => {
    apps[0].getHttpAdapter().getInstance().set('trust proxy', parseTrustedProxies('loopback'));
    await post(urls[0], '192.0.2.1');
    await post(urls[0], '192.0.2.1');
    expect((await post(urls[0], '203.0.113.9, 192.0.2.1')).status).toBe(429);
    expect((await post(urls[0], '192.0.2.2')).status).toBe(200);
  });

  it('groups rotating IPv6 addresses in the same /64 subnet', async () => {
    apps[0].getHttpAdapter().getInstance().set('trust proxy', parseTrustedProxies('loopback'));
    await post(urls[0], '2001:db8:abcd:1::1');
    await post(urls[0], '2001:db8:abcd:1::2');
    expect((await post(urls[0], '2001:db8:abcd:1::3')).status).toBe(429);
    expect((await post(urls[0], '2001:db8:abcd:2::1')).status).toBe(200);
  });

  it('does not trust forged earlier entries when the client itself has a private address', async () => {
    apps[0].getHttpAdapter().getInstance().set('trust proxy', parseTrustedProxies('1'));
    await post(urls[0], '192.0.2.1, 10.1.2.3');
    await post(urls[0], '192.0.2.2, 10.1.2.3');
    expect((await post(urls[0], '192.0.2.3, 10.1.2.3')).status).toBe(429);
    expect((await post(urls[0], '192.0.2.3, 10.1.2.4')).status).toBe(200);
  });

  it('counts invalid bodies and covers every public authentication route', async () => {
    for (const route of ['token', 'validate', 'exchange', 'refresh', 'logout']) {
      expect((await post(urls[0], undefined, route)).status).not.toBe(429);
      await post(urls[0], undefined, route);
      expect((await post(urls[0], undefined, route)).status).toBe(429);
    }
    for (const route of ['login', 'callback', 'profile']) {
      await fetch(`${urls[0]}/auth/${route}`, { redirect: 'manual' });
      await fetch(`${urls[0]}/auth/${route}`, { redirect: 'manual' });
      expect((await fetch(`${urls[0]}/auth/${route}`, { redirect: 'manual' })).status).toBe(429);
    }
  });

  it('fails closed during Redis outages without calling the auth provider', async () => {
    redis.status = 'reconnecting';
    const unavailable = await post(urls[0]);
    expect(unavailable.status).toBe(503);
    expect(refreshToken).not.toHaveBeenCalled();
  });
});
