import { INestApplication, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { DatabaseModule } from '../database/database.module';
import { GlobalHttpExceptionFilter } from '../http/global-http-exception.filter';
import { HealthModule } from './health.module';

const integration = process.env.POSTGRES_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

integration('Readiness with the real database and queue client modules', () => {
  let app: INestApplication;
  let baseUrl: string;
  let log: jest.SpyInstance;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), DatabaseModule, HealthModule]
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  }, 15000);

  afterAll(async () => { await app?.close(); log?.mockRestore(); });

  it('reports ready with live PostgreSQL and Redis and keeps liveness after a database disconnect', async () => {
    const ready = await fetch(`${baseUrl}/api/health/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
    expect((await fetch(`${baseUrl}/api/health/redis`)).status).toBe(200);
    await app.get(DataSource).destroy();
    expect((await fetch(`${baseUrl}/api/health/ready`)).status).toBe(503);
    expect((await fetch(`${baseUrl}/api/health`)).status).toBe(200);
  });
});
