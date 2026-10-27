import { DataSource } from 'typeorm';
import { JobQueueService } from '../job-queue/job-queue.service';
import { ReadinessService } from './readiness.service';

describe('ReadinessService', () => {
  const database = { query: jest.fn() };
  const jobs = { pingRedis: jest.fn(), checkRedisConnection: jest.fn() };
  let service: ReadinessService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    database.query.mockResolvedValue([{ '?column?': 1 }]);
    jobs.pingRedis.mockResolvedValue(undefined);
    service = new ReadinessService(database as unknown as DataSource, jobs as unknown as JobQueueService);
  });

  afterEach(() => jest.useRealTimers());

  it('requires both dependencies and recovers after a failed probe', async () => {
    database.query.mockRejectedValueOnce(new Error('private database details'));
    await expect(service.check()).resolves.toEqual({ status: 'down', checks: { database: 'down', redis: 'up' } });
    await expect(service.check()).resolves.toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  it('bounds hung probes and shares them until the original operation settles', async () => {
    let release!: () => void;
    database.query.mockReturnValueOnce(new Promise<void>(resolve => { release = resolve; }));
    const first = service.check();
    const concurrent = service.check();
    await jest.advanceTimersByTimeAsync(1500);
    await expect(first).resolves.toMatchObject({ status: 'down', checks: { database: 'down' } });
    await expect(concurrent).resolves.toMatchObject({ status: 'down' });
    await expect(service.check()).resolves.toMatchObject({ status: 'down' });
    expect(database.query).toHaveBeenCalledTimes(1);
    release();
    await jest.advanceTimersByTimeAsync(0);
    await expect(service.check()).resolves.toMatchObject({ status: 'ok' });
  });

  it('reports Redis failure without publishing driver errors', async () => {
    jobs.pingRedis.mockRejectedValueOnce(new Error('redis://private-host:6379'));
    await expect(service.check()).resolves.toEqual({ status: 'down', checks: { database: 'up', redis: 'down' } });
  });

  it('also bounds detailed Redis diagnostics', async () => {
    jobs.checkRedisConnection.mockReturnValue(new Promise(() => { /* Deliberately hung driver. */ }));
    const result = service.redisStatus();
    await jest.advanceTimersByTimeAsync(1500);
    await expect(result).resolves.toEqual({ connected: false, message: 'Redis is unavailable' });
  });
});
