import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { READINESS_TIMEOUT_MS, ReadinessService } from './readiness.service';

describe('ReadinessService', () => {
  const query = jest.fn();
  const runCommand = jest.fn();
  const getBackend = jest.fn();
  let dataSource: { isInitialized: boolean; query: typeof query };
  let service: ReadinessService;

  beforeEach(() => {
    query.mockReset().mockResolvedValue([{ '?column?': 1 }]);
    runCommand.mockReset().mockResolvedValue('PONG');
    getBackend.mockReset().mockReturnValue({ client: Promise.resolve({ runCommand }) });
    dataSource = { isInitialized: true, query };
    service = new ReadinessService(dataSource as unknown as DataSource, { getBackend } as unknown as Queue);
  });

  afterEach(() => { jest.useRealTimers(); });

  it('checks PostgreSQL and the existing queue Redis without inspecting queue contents', async () => {
    await expect(service.check()).resolves.toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
    expect(query).toHaveBeenCalledWith('SELECT 1');
    expect(runCommand).toHaveBeenCalledWith('ping', []);
  });

  it('rejects an uninitialized data source without querying it', async () => {
    dataSource.isInitialized = false;
    await expect(service.check()).resolves.toEqual({ status: 'error', checks: { database: 'down', redis: 'up' } });
    expect(query).not.toHaveBeenCalled();
  });

  it.each(['database', 'redis'])('reports a failed %s probe without disclosing driver errors', async dependency => {
    const probe = dependency === 'database' ? query : runCommand;
    probe.mockRejectedValueOnce(new Error('sensitive connection detail'));
    const result = await service.check();
    expect(result).toEqual({
      status: 'error',
      checks: { database: dependency === 'database' ? 'down' : 'up', redis: dependency === 'redis' ? 'down' : 'up' }
    });
    expect(JSON.stringify(result)).not.toContain('sensitive');
    await expect(service.check()).resolves.toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  it('reports Redis as down when client acquisition rejects or PING has an unexpected reply', async () => {
    getBackend.mockReturnValueOnce({ client: Promise.reject(new Error('connection unavailable')) });
    expect((await service.check()).checks.redis).toBe('down');
    runCommand.mockResolvedValueOnce('unexpected');
    expect((await service.check()).checks.redis).toBe('down');
  });

  it('bounds response time and reuses hanging probes across concurrent and later polls', async () => {
    jest.useFakeTimers();
    let resolveQuery!: (value: unknown[]) => void;
    let resolvePing!: (value: string) => void;
    query.mockReturnValueOnce(new Promise(resolve => { resolveQuery = resolve; }));
    runCommand.mockReturnValueOnce(new Promise(resolve => { resolvePing = resolve; }));

    const first = service.check();
    const concurrent = service.check();
    await jest.advanceTimersByTimeAsync(READINESS_TIMEOUT_MS);
    const down = { status: 'error', checks: { database: 'down', redis: 'down' } };
    await expect(first).resolves.toEqual(down);
    await expect(concurrent).resolves.toEqual(down);

    const later = service.check();
    await jest.advanceTimersByTimeAsync(READINESS_TIMEOUT_MS);
    await expect(later).resolves.toEqual(down);
    expect(query).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);

    resolveQuery([]);
    resolvePing('PONG');
    await jest.advanceTimersByTimeAsync(0);
    await expect(service.check()).resolves.toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
    expect(query).toHaveBeenCalledTimes(2);
    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('handles a late driver rejection after the response timeout and recovers', async () => {
    jest.useFakeTimers();
    let rejectQuery!: (error: Error) => void;
    query.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectQuery = reject; }));
    const pending = service.check();
    await jest.advanceTimersByTimeAsync(READINESS_TIMEOUT_MS);
    expect((await pending).checks.database).toBe('down');
    rejectQuery(new Error('late failure'));
    await jest.advanceTimersByTimeAsync(0);
    expect((await service.check()).status).toBe('ok');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('reports shutdown without starting more probes', async () => {
    service.beforeApplicationShutdown();
    await expect(service.check()).resolves.toEqual({ status: 'shutting_down', checks: {} });
    expect(query).not.toHaveBeenCalled();
    expect(getBackend).not.toHaveBeenCalled();
  });
});
