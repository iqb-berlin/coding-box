import { INestApplication, Logger, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as http from 'http';
import { AddressInfo } from 'net';
import axios from 'axios';
import { AppController } from '../app.controller';
import { TestcenterService } from '../database/services/test-results/testcenter.service';
import { UsersService } from '../database/services/users';
import { WorkspaceUsersService } from '../database/services/workspace';
import { AuthRateLimitModule } from './auth-rate-limit.module';
import { AUTH_RATE_LIMIT_REDIS } from './auth-rate-limit.storage';
import { JwtAuthGuard } from './jwt-auth.guard';
import { createRequestValidationPipe } from '../http/request-validation';
import { GlobalHttpExceptionFilter } from '../http/global-http-exception.filter';

describe('Testcenter authentication HTTP boundary', () => {
  let app: INestApplication;
  let upstream: http.Server;
  let baseUrl: string;
  let targetUrl: string;
  let responseStatus: number;
  let targetRequests: string[];
  let counters: Map<string, number>;
  let log: jest.SpyInstance;

  beforeAll(async () => {
    log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    upstream = http.createServer((request, response) => {
      targetRequests.push(request.url || '');
      response.writeHead(responseStatus, { 'Content-Type': 'application/json', Location: `${targetUrl}/redirected` });
      response.end(JSON.stringify(responseStatus === 200 ? { token: 'fixture' } : { error: 'private provider detail' }));
    });
    await new Promise<void>(resolve => { upstream.listen(0, '127.0.0.1', resolve); });
    targetUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    const config = new ConfigService({ TESTCENTER_ALLOWED_URLS: targetUrl });
    const service = new TestcenterService({} as never, new HttpService(axios.create({ proxy: false })), {} as never, {} as never, {} as never, {} as never, undefined, undefined, config);
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({
        isGlobal: true, ignoreEnvFile: true, ignoreEnvVars: true, load: [() => ({ AUTH_RATE_LIMIT_LIMIT: 2 })]
      }), AuthRateLimitModule],
      controllers: [AppController],
      providers: [
        { provide: TestcenterService, useValue: service },
        { provide: UsersService, useValue: {} },
        { provide: WorkspaceUsersService, useValue: {} }
      ]
    }).overrideProvider(AUTH_RATE_LIMIT_REDIS).useValue({
      status: 'ready',
      disconnect: () => undefined,
      eval: async (_script: string, _keys: number, key: string, _ttl: number, limit: number) => {
        const count = (counters.get(key) || 0) + 1;
        counters.set(key, count);
        return [count, 60, count > limit ? 1 : 0, count > limit ? 60 : 0];
      }
    }).overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: { switchToHttp: () => { getRequest: () => http.IncomingMessage } }) {
          if (context.switchToHttp().getRequest().headers.authorization !== 'Bearer fixture') throw new UnauthorizedException();
          return true;
        }
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createRequestValidationPipe());
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });
  beforeEach(() => { counters = new Map(); targetRequests = []; responseStatus = 200; });
  afterAll(async () => {
    await app?.close();
    if (upstream) await new Promise<void>(resolve => { upstream.close(() => resolve()); });
    log?.mockRestore();
  });
  const authenticate = (authorized = true, url = targetUrl) => fetch(`${baseUrl}/api/tc_authentication`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: 'Bearer fixture' } : {}) },
    body: JSON.stringify({
      username: 'fixture', password: 'synthetic', server: '', url
    })
  });

  it('documents bearer authentication and integration failure statuses in OpenAPI', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().addBearerAuth().build());
    const operation = document.paths['/api/tc_authentication'].post!;
    expect(operation.security).toContainEqual({ bearer: [] });
    expect(Object.keys(operation.responses)).toEqual(expect.arrayContaining(['201', '400', '401', '403', '422', '429', '502', '503', '504']));
  });
  it('rejects unauthenticated requests before contacting any Testcenter', async () => {
    expect((await authenticate(false)).status).toBe(401);
    expect(targetRequests).toEqual([]);
  });
  it('blocks unapproved targets before sending credentials', async () => {
    expect((await authenticate(true, `${targetUrl}/unapproved`)).status).toBe(403);
    expect(targetRequests).toEqual([]);
  });
  it('authenticates against an explicitly approved target and applies the shared rate limit', async () => {
    expect((await authenticate()).status).toBe(201);
    expect((await authenticate()).status).toBe(201);
    const limited = await authenticate();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
    expect(targetRequests).toEqual(['/api/session/admin', '/api/session/admin']);
  });
  it('does not follow upstream redirects with credentials', async () => {
    responseStatus = 307;
    expect((await authenticate()).status).toBe(502);
    expect(targetRequests).toEqual(['/api/session/admin']);
  });
  it('keeps invalid provider credentials separate from application authentication failures', async () => {
    responseStatus = 401;
    const response = await authenticate();
    expect(response.status).toBe(422);
    expect((await response.json()).message).toBe('Invalid Testcenter credentials');
    responseStatus = 200;
    expect((await authenticate()).status).toBe(201);
  });
});
