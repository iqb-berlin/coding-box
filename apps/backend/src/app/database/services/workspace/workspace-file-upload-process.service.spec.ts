import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import Redis from 'ioredis';
import { TEST_FILES_UPLOAD_PROCESS, WorkspaceFileUploadProcessService } from './workspace-file-upload-process.service';

describe('WorkspaceFileUploadProcessService', () => {
  const key = 'test-files-upload:workspace:7';
  const redis = {
    on: jest.fn(),
    get: jest.fn(),
    eval: jest.fn(),
    disconnect: jest.fn()
  };
  const duplicate = jest.fn(() => redis);
  const service = new WorkspaceFileUploadProcessService({ duplicate } as unknown as Redis);

  beforeEach(() => {
    jest.clearAllMocks();
    redis.eval.mockResolvedValue(1);
  });

  it('uses a bounded connection and disconnects it on shutdown', () => {
    const createConnection = jest.fn(() => redis);
    const tracker = new WorkspaceFileUploadProcessService({ duplicate: createConnection } as unknown as Redis);
    expect(createConnection).toHaveBeenCalledWith(expect.objectContaining({
      enableOfflineQueue: false,
      autoResendUnfulfilledCommands: false,
      commandTimeout: 1000,
      socketTimeout: 2000
    }));
    tracker.onApplicationShutdown();
    expect(redis.disconnect).toHaveBeenCalledTimes(1);
  });

  it('renews the active entry, preserves monotonic progress and publishes the result', async () => {
    jest.useFakeTimers();
    try {
      const result = {
        total: 1, uploaded: 5, failed: 2, conflicts: [{ fileId: 'unit-7', filename: 'unit.xml' }]
      };
      await expect(service.track(7, '42', 1, async report => {
        report(0.4);
        report(0.2);
        await jest.advanceTimersByTimeAsync(20_000);
        return result;
      })).resolves.toBe(result);

      const calls = redis.eval.mock.calls.map(([, , cacheKey, version, value, ttl]) => {
        const process = JSON.parse(value);
        return {
          cacheKey, version, process, ttl
        };
      });
      expect(calls.map(({ cacheKey, process, ttl }) => [cacheKey, process.status, process.progress, ttl]))
        .toEqual([[key, 'active', 0, 60_000], [key, 'active', 40, 60_000], [key, 'active', 40, 60_000], [key, 'completed', 100, 86_400_000]]);
      expect(calls.map(({ version }) => version)).toEqual([1, 2, 3, 4].map(revision => `00000000000000000042:0000000${revision}`));
      expect(calls[3].process).toMatchObject({
        finishedOn: expect.any(Number),
        queueName: TEST_FILES_UPLOAD_PROCESS,
        data: {
          fileCount: 1, uploadedFileCount: 5, failedFileCount: 2, conflictCount: 1
        }
      });
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('preserves the upload error even when reporting fails', async () => {
    redis.eval.mockRejectedValue(new Error('status store unavailable'));
    const error = new Error('upload failure');
    await expect(service.track(7, '42', 1, async () => { throw error; })).rejects.toBe(error);
    expect(JSON.parse(redis.eval.mock.lastCall[4])).toMatchObject({ status: 'failed', progress: 0 });
  });

  it('records an import where all files failed as failed', async () => {
    await service.track(7, '42', 1, async () => ({ total: 1, uploaded: 0, failed: 1 }));
    expect(JSON.parse(redis.eval.mock.lastCall[4])).toMatchObject({ status: 'failed' });
  });
});

const describeRedis = process.env.BULLMQ_TEST_REDIS_HOST ? describe : describe.skip;

describeRedis('Workspace file upload process ordering in Redis', () => {
  const root = new Redis({
    lazyConnect: true,
    host: process.env.BULLMQ_TEST_REDIS_HOST,
    port: Number(process.env.BULLMQ_TEST_REDIS_PORT || 6379),
    keyPrefix: `upload-process-test:${randomUUID()}:`
  });
  const key = 'test-files-upload:workspace:7';
  let first: WorkspaceFileUploadProcessService;
  let second: WorkspaceFileUploadProcessService;

  beforeAll(async () => {
    await root.connect();
    const duplicate = jest.spyOn(root, 'duplicate');
    try {
      first = new WorkspaceFileUploadProcessService(root);
      second = new WorkspaceFileUploadProcessService(root);
      await Promise.all(duplicate.mock.results.map(({ value }) => (
        value.status === 'ready' ? Promise.resolve() : once(value, 'ready')
      )));
    } finally {
      duplicate.mockRestore();
    }
  });

  afterAll(async () => {
    first?.onApplicationShutdown();
    second?.onApplicationShutdown();
    if (root.status === 'ready') await root.del(key);
    root.disconnect();
  });

  it('rejects old writes across connections, including after removal of the latest result', async () => {
    const upload = async () => ({ total: 1, uploaded: 1, failed: 0 });
    await second.track(7, '42', 2, upload);
    const latest = await second.getProcess(7);
    expect(latest).toMatchObject({ status: 'completed', data: { fileCount: 2 } });
    expect(latest).not.toHaveProperty('version');

    await first.track(7, '41', 1, upload);
    expect(await first.getProcess(7)).toEqual(latest);

    expect(await first.removeFinishedProcess(7, 'previous-id')).toBe(false);
    expect(await first.removeFinishedProcess(7, String(latest?.id))).toBe(true);
    await first.track(7, '41', 1, upload);
    expect(await first.getProcess(7)).toBeNull();

    await first.track(7, '43', 3, upload);
    expect(await first.getProcess(7)).toMatchObject({ status: 'completed', data: { fileCount: 3 } });
  });

  it('leaves an active upload intact', async () => {
    await first.track(7, '44', 1, async () => {
      const active = await first.getProcess(7);
      expect(active).toMatchObject({ status: 'active' });
      expect(await second.removeFinishedProcess(7, String(active?.id))).toBe(false);
      return { total: 1, uploaded: 1, failed: 0 };
    });
  });
});
