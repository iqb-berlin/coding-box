import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { ReadinessService } from './readiness.service';
import { GlobalHttpExceptionFilter } from '../http/global-http-exception.filter';

describe('Health HTTP contracts', () => {
  let app: INestApplication;
  let baseUrl: string;
  let log: jest.SpyInstance;
  const readiness = { check: jest.fn(), redisStatus: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController], providers: [{ provide: ReadinessService, useValue: readiness }]
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  beforeEach(() => {
    readiness.check.mockResolvedValue({ status: 'ok', checks: { database: 'up', redis: 'up' } });
    readiness.redisStatus.mockResolvedValue({ connected: true, message: 'Redis is connected' });
  });

  afterAll(async () => { await app.close(); log.mockRestore(); });

  it('keeps process liveness independent of dependency availability', async () => {
    readiness.check.mockRejectedValue(new Error('dependency unavailable'));
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', uptime: expect.any(Number) });
  });

  it('reports ready only after both required dependencies passed', async () => {
    const response = await fetch(`${baseUrl}/api/health/ready`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  it.each(['database', 'redis'])('returns 503 when %s is down', async dependency => {
    readiness.check.mockResolvedValue({ status: 'down', checks: { database: 'up', redis: 'up', [dependency]: 'down' } });
    expect((await fetch(`${baseUrl}/api/health/ready`)).status).toBe(503);
  });

  it('preserves successful Redis diagnostic responses', async () => {
    const response = await fetch(`${baseUrl}/api/health/redis`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ connected: true, message: 'Redis is connected' });
  });

  it('returns 503 and hides diagnostic details when Redis is disconnected', async () => {
    readiness.redisStatus.mockResolvedValue({ connected: false, message: 'private connection details' });
    const response = await fetch(`${baseUrl}/api/health/redis`);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('private connection details');
  });
});
