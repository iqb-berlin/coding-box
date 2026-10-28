import { Global, INestApplication, Module } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { JobQueueClientModule } from '../job-queue/job-queue-client.module';
import { JobQueueService } from '../job-queue/job-queue.service';
import { GlobalHttpExceptionFilter } from '../http/global-http-exception.filter';
import { HealthModule } from './health.module';
import { ReadinessService } from './readiness.service';

const query = jest.fn();
const runCommand = jest.fn();

@Global()
@Module({
  providers: [
    { provide: DataSource, useValue: { isInitialized: true, query } },
    { provide: JobQueueService, useValue: {} },
    {
      provide: getQueueToken('test-person-coding'),
      useValue: { getBackend: () => ({ client: Promise.resolve({ runCommand }) }) }
    }
  ],
  exports: [DataSource, JobQueueService, getQueueToken('test-person-coding')]
})
class HealthDependenciesFixtureModule {}

describe('HealthModule readiness over HTTP', () => {
  let app: INestApplication;
  let url: string;

  beforeEach(async () => {
    query.mockReset().mockResolvedValue([]);
    runCommand.mockReset().mockResolvedValue('PONG');
    const module = await Test.createTestingModule({ imports: [HealthModule] })
      .overrideModule(JobQueueClientModule).useModule(HealthDependenciesFixtureModule)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });

  afterEach(async () => { await app?.close(); });

  it('returns an uncached 200 only when PostgreSQL and Redis answer', async () => {
    const response = await fetch(`${url}/api/health/ready`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  it.each(['database', 'redis'])('returns a sanitized 503 when %s fails while liveness stays 200', async dependency => {
    (dependency === 'database' ? query : runCommand).mockRejectedValue(new Error('secret driver detail'));
    const response = await fetch(`${url}/api/health/ready`);
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      status: 'error',
      checks: { database: dependency === 'database' ? 'down' : 'up', redis: dependency === 'redis' ? 'down' : 'up' }
    });
    const calls = query.mock.calls.length;
    const liveness = await fetch(`${url}/api/health`);
    expect(liveness.status).toBe(200);
    expect((await liveness.json()).status).toBe('ok');
    expect(query).toHaveBeenCalledTimes(calls);
  });

  it('returns 503 during shutdown without probing dependencies', async () => {
    app.get(ReadinessService).beforeApplicationShutdown();
    const response = await fetch(`${url}/api/health/ready`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'shutting_down', checks: {} });
    expect(query).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
  });
});
