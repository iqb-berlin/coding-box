import { createMock } from '@golevelup/ts-jest';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import {
  Job, Queue, QueueEvents, Worker
} from 'bullmq';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FlatResponseFilterCleanupService } from './flat-response-filter-cleanup.service';
import { FlatResponseFilterPurgeStore } from './flat-response-filter-purge.store';
import { CacheService } from './cache.service';
import { TestResultsCacheService } from '../database/services/test-results/test-results-cache.service';
import { WorkspaceStatsCacheService } from '../database/services/workspace/workspace-stats-cache.service';
import { WorkspaceTestResultsAnalysisController } from '../admin/workspace/workspace-test-results-analysis.controller';
import { WorkspaceTestResultsService } from '../database/services/test-results';
import { WorkspaceSettingsService } from '../workspace/workspace-settings.service';
import { FlatResponseFilterOptions } from '../admin/workspace/dto/workspace-test-results.interfaces';
import { ValidationTask } from '../database/entities/validation-task.entity';
import { JOB_QUEUE_NAMES } from '../job-queue/job-queue.config';
import { JobQueueService } from '../job-queue/job-queue.service';
import { FLAT_RESPONSE_FILTER_OPTIONS_PURGE_JOB, FlatResponseFilterOptionsJobData } from '../job-queue/flat-response-filter-options-job';
import { FlatResponseFilterOptionsProcessor } from '../job-queue/processors/flat-response-filter-options.processor';

const describeRedis = process.env.BULLMQ_TEST_REDIS_HOST && process.env.BULLMQ_TEST_REDIS_PORT ? describe : describe.skip;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describeRedis('filter-options generations against isolated Redis', () => {
  let redis: Redis;
  let cache: CacheService;
  let otherReplica: CacheService;
  let purgeQueue: Pick<JobQueueService, 'addFlatResponseFilterOptionsPurgeJob'>;
  const value = (code: string) => ({ codes: [code] } as FlatResponseFilterOptions);

  beforeAll(async () => {
    redis = new Redis({
      host: process.env.BULLMQ_TEST_REDIS_HOST,
      port: Number(process.env.BULLMQ_TEST_REDIS_PORT),
      keyPrefix: `filter-options-test:[${randomUUID()}]:`,
      lazyConnect: true,
      commandTimeout: 1000,
      maxRetriesPerRequest: 0
    });
    await redis.connect();
  });

  beforeEach(() => {
    cache = new CacheService(redis, { pendingEvent: jest.fn(), complete: jest.fn() });
    otherReplica = new CacheService(redis, { pendingEvent: jest.fn(), complete: jest.fn() });
    purgeQueue = { addFlatResponseFilterOptionsPurgeJob: jest.fn() };
  });

  afterEach(async () => { await cache.deleteByPattern('*'); });
  afterAll(() => { redis?.disconnect(); });

  function createQueueModule(queue: Queue<FlatResponseFilterOptionsJobData>) {
    return Test.createTestingModule({
      providers: [
        JobQueueService,
        ...JOB_QUEUE_NAMES.map(name => ({ provide: getQueueToken(name), useValue: name === queue.name ? queue : {} })),
        { provide: getRepositoryToken(ValidationTask), useValue: {} }
      ]
    }).compile();
  }

  it('coalesces concurrent API and worker reads in the same generation', async () => {
    const started = deferred<void>();
    const pending = deferred<FlatResponseFilterOptions>();
    const findFlatResponseFilterOptions = jest.fn(() => {
      started.resolve();
      return pending.promise;
    });
    const results = { findFlatResponseFilterOptions } as unknown as WorkspaceTestResultsService;
    const api = new WorkspaceTestResultsAnalysisController(results, cache, {} as WorkspaceSettingsService);
    const processor = new FlatResponseFilterOptionsProcessor(cache, results);
    const generation = await cache.invalidateFlatResponseFilterOptions(1);
    const job = { data: { workspaceId: 1, processingDurationThresholdMs: 60000, generation }, updateProgress: jest.fn(), id: 'test' };
    const requests = Array.from({ length: 10 }, () => api.findFlatResponseFilterOptions(1));
    const worker = processor.processWorkspaceJob(job as unknown as Job);
    await started.promise;
    // All earlier Redis commands complete before PING on this connection.
    await redis.ping();
    expect(findFlatResponseFilterOptions).toHaveBeenCalledTimes(1);
    pending.resolve(value('shared'));
    expect(await Promise.all(requests)).toEqual(Array(10).fill(value('shared')));
    await worker;
    const compute = jest.fn();
    await expect(otherReplica.getOrComputeFlatResponseFilterOptions(1, 60000, compute)).resolves.toEqual(value('shared'));
    expect(compute).not.toHaveBeenCalled();
  });

  it('refreshes cached filters after a single failed workspace invalidation write', async () => {
    await cache.getOrComputeFlatResponseFilterOptions(1, 60000, async () => value('excluded'));
    const set = jest.spyOn(redis, 'set').mockRejectedValueOnce(new Error('temporary write failure'));
    try {
      await expect(new WorkspaceStatsCacheService(cache, purgeQueue).invalidateWorkspaceStatsCache(1)).resolves.toBe(true);
      expect(set).toHaveBeenCalledTimes(2);

      const compute = jest.fn().mockResolvedValue(value('current'));
      await expect(otherReplica.getOrComputeFlatResponseFilterOptions(1, 60000, compute)).resolves.toEqual(value('current'));
      expect(compute).toHaveBeenCalledTimes(1);
    } finally {
      set.mockRestore();
    }
  });

  it('stops serving cached filters when Redis rejects both generation writes', async () => {
    const versionKey = cache.generateFlatResponseFilterOptionsVersionKey(1);
    await cache.getOrComputeFlatResponseFilterOptions(1, 60000, async () => value('excluded'));
    const oldGeneration = await redis.get(versionKey);
    const oom = new Error("OOM command not allowed when used memory > 'maxmemory'.");
    const set = jest.spyOn(redis, 'set').mockRejectedValue(oom);
    const evalScript = jest.spyOn(redis, 'eval').mockRejectedValueOnce(oom);
    try {
      await new WorkspaceStatsCacheService(cache, purgeQueue).invalidateWorkspaceStatsCache(1);
      expect(set).toHaveBeenCalledTimes(2);
      expect(await redis.get(versionKey)).toBeNull();
      await expect(otherReplica.getOrComputeFlatResponseFilterOptions(1, 60000, async () => value('while full')))
        .resolves.toEqual(value('while full'));
    } finally {
      set.mockRestore();
      evalScript.mockRestore();
    }
    await expect(otherReplica.getOrComputeFlatResponseFilterOptions(1, 60000, async () => value('recovered')))
      .resolves.toEqual(value('recovered'));
    expect(await redis.get(versionKey)).not.toBe(oldGeneration);
  });

  it('purges retired filter values after result deletion and protects concurrent fresh publications', async () => {
    const versionKey = cache.generateFlatResponseFilterOptionsVersionKey(1);
    await cache.getOrComputeFlatResponseFilterOptions(1, 60000, async () => value('older result'));
    const older = (await redis.get(versionKey))!;
    const beforeDeletion = (await cache.invalidateFlatResponseFilterOptions(1))!;
    await cache.getOrComputeFlatResponseFilterOptions(1, 100, async () => value('deleted result'));
    await cache.getOrComputeFlatResponseFilterOptions(10, 60000, async () => value('other workspace'));
    const legacyKey = cache.generateFlatResponseFilterOptionsCacheKey(1, 1, 60000);
    await cache.set(legacyKey, value('legacy result'), 0);

    const started = deferred<void>();
    const pending = deferred<FlatResponseFilterOptions>();
    const oldRead = otherReplica.getOrComputeFlatResponseFilterOptions(1, 60000, () => {
      started.resolve();
      return pending.promise;
    });
    await started.promise;
    const clearGeneration = cache.clearFlatResponseFilterOptionsGeneration.bind(cache);
    const clear = jest.spyOn(cache, 'clearFlatResponseFilterOptionsGeneration').mockImplementation(async workspaceId => {
      const cleared = await clearGeneration(workspaceId);
      await otherReplica.getOrComputeFlatResponseFilterOptions(1, 60000, async () => value('after deletion'));
      return cleared;
    });
    const deletionCache = new TestResultsCacheService(
      { invalidateIncompleteVariablesCache: async () => undefined } as never, new WorkspaceStatsCacheService(cache, purgeQueue)
    );
    try {
      await deletionCache.invalidateCachesAfterTestResultDeletion(1);
    } finally {
      clear.mockRestore();
      pending.resolve(value('late result'));
      await oldRead;
    }

    const keys = [
      cache.generateFlatResponseFilterOptionsCacheKey(1, older, 60000),
      cache.generateFlatResponseFilterOptionsCacheKey(1, beforeDeletion, 100),
      cache.generateFlatResponseFilterOptionsCacheKey(1, beforeDeletion, 60000),
      legacyKey
    ];
    expect(await redis.exists(...keys)).toBe(0);
    const unexpectedRecompute = jest.fn();
    await expect(cache.getOrComputeFlatResponseFilterOptions(1, 60000, unexpectedRecompute))
      .resolves.toEqual(value('after deletion'));
    await expect(cache.getOrComputeFlatResponseFilterOptions(10, 60000, unexpectedRecompute))
      .resolves.toEqual(value('other workspace'));
    expect(unexpectedRecompute).not.toHaveBeenCalled();
  });

  it('purges deleted filter values after a transient Redis generation deletion error', async () => {
    const before = await cache.invalidateFlatResponseFilterOptions(1);
    const staleKey = cache.generateFlatResponseFilterOptionsCacheKey(1, before!, 60000);
    const stale = { sessionBrowsers: ['old browser'] };
    await cache.getOrComputeFlatResponseFilterOptions(1, 60000, async () => stale);
    const versionKey = cache.generateFlatResponseFilterOptionsVersionKey(1);
    const del = redis.del.bind(redis);
    let failed = false;
    const deleteKey = jest.spyOn(redis, 'del').mockImplementation((...args) => {
      if (String(args[0]) === versionKey && !failed) {
        failed = true;
        return Promise.reject(new Error('temporary generation deletion failure'));
      }
      return del(...args);
    });
    try {
      const stats = new WorkspaceStatsCacheService(cache, purgeQueue);
      const deletionCache = new TestResultsCacheService({} as never, stats);
      await expect(deletionCache.invalidateWorkspaceStatsAfterDeletion(1)).resolves.toBe(true);
      expect(failed).toBe(true);
      expect(await redis.get(staleKey)).toBeNull();
      const compute = jest.fn().mockResolvedValue({ sessionBrowsers: [] });
      await expect(otherReplica.getOrComputeFlatResponseFilterOptions(1, 60000, compute))
        .resolves.toEqual({ sessionBrowsers: [] });
      expect(compute).toHaveBeenCalledTimes(1);
      expect(purgeQueue.addFlatResponseFilterOptionsPurgeJob).not.toHaveBeenCalled();
    } finally {
      deleteKey.mockRestore();
    }
  });

  it('keeps a pending purge and deduplicates only warmups with the same generation and threshold', async () => {
    const queue = new Queue<FlatResponseFilterOptionsJobData>('flat-response-filter-options', {
      connection: { host: redis.options.host, port: redis.options.port },
      prefix: `filter-options-warmup-${randomUUID()}`
    });
    try {
      const module = await createQueueModule(queue);
      const jobs = module.get(JobQueueService);
      const purge = await jobs.addFlatResponseFilterOptionsPurgeJob(1);
      const previous = await jobs.addFlatResponseFilterOptionsJob(1, 60000, 'g2-previous');
      const [first, duplicate, otherThreshold] = await Promise.all([
        jobs.addFlatResponseFilterOptionsJob(1, 60000, 'g2-current'),
        jobs.addFlatResponseFilterOptionsJob(1, 60000, 'g2-current'),
        jobs.addFlatResponseFilterOptionsJob(1, 100, 'g2-current')
      ]);
      expect(duplicate.id).toBe(first.id);
      const waiting = await queue.getWaiting();
      expect(waiting).toHaveLength(4);
      expect(waiting.map(job => job.id)).toEqual(expect.arrayContaining([
        purge.id, previous.id, first.id, otherThreshold.id
      ]));
    } finally {
      await queue.obliterate();
      await queue.close();
    }
  });

  it('retries a queued purge after both immediate deletion attempts fail', async () => {
    await cache.getOrComputeFlatResponseFilterOptions(1, 60000, async () => value('deleted'));
    await cache.getOrComputeFlatResponseFilterOptions(1, 100, async () => value('deleted at another threshold'));
    await cache.getOrComputeFlatResponseFilterOptions(10, 60000, async () => value('other workspace'));
    const versionKey = cache.generateFlatResponseFilterOptionsVersionKey(1);
    const generation = (await redis.get(versionKey))!;
    const staleKeys = [60000, 100].map(threshold => (
      cache.generateFlatResponseFilterOptionsCacheKey(1, generation, threshold)
    ));
    const queueName = 'flat-response-filter-options';
    const queueOptions = {
      connection: { host: redis.options.host, port: redis.options.port },
      prefix: `filter-options-purge-${randomUUID()}`
    };
    const queue = new Queue<FlatResponseFilterOptionsJobData>(queueName, queueOptions);
    const events = new QueueEvents(queueName, queueOptions);
    let worker: Worker<FlatResponseFilterOptionsJobData> | undefined;
    const clear = jest.spyOn(cache, 'clearFlatResponseFilterOptionsGeneration')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    const workerClear = jest.spyOn(otherReplica, 'clearFlatResponseFilterOptionsGeneration').mockResolvedValueOnce(false);
    try {
      const module = await createQueueModule(queue);
      const stats = new WorkspaceStatsCacheService(cache, module.get(JobQueueService));
      const deletionCache = new TestResultsCacheService(
        { invalidateIncompleteVariablesCache: jest.fn() } as never, stats
      );
      await events.waitUntilReady();
      await deletionCache.invalidateCachesAfterTestResultDeletion(1);
      expect(clear).toHaveBeenCalledTimes(2);
      const waiting = await queue.getWaiting();
      expect(waiting).toEqual([expect.objectContaining({
        name: FLAT_RESPONSE_FILTER_OPTIONS_PURGE_JOB, data: { workspaceId: 1 }
      })]);
      expect(await redis.exists(...staleKeys)).toBe(staleKeys.length);

      const compute = jest.fn().mockResolvedValue(value('fresh'));
      const processor = new FlatResponseFilterOptionsProcessor(
        otherReplica, { findFlatResponseFilterOptions: compute } as unknown as WorkspaceTestResultsService
      );
      worker = new Worker(queueName, job => processor.processWorkspaceJob(job), queueOptions);
      await expect(waiting[0].waitUntilFinished(events, 7000)).resolves.toBeNull();
      expect(workerClear).toHaveBeenCalledTimes(2);
      expect(await redis.exists(...staleKeys)).toBe(0);
      expect(await redis.get(versionKey)).toBeNull();
      expect(compute).not.toHaveBeenCalled();
      await expect(cache.getOrComputeFlatResponseFilterOptions(1, 60000, compute)).resolves.toEqual(value('fresh'));
      await expect(cache.getOrComputeFlatResponseFilterOptions(10, 60000, compute)).resolves.toEqual(value('other workspace'));
      expect(compute).toHaveBeenCalledTimes(1);
    } finally {
      clear.mockRestore();
      workerClear.mockRestore();
      await worker?.close();
      await events.close();
      await queue.obliterate();
      await queue.close();
    }
  }, 15_000);

  it('retries the failed post-import invalidation in BullMQ before caching fresh filter options', async () => {
    await cache.getOrComputeFlatResponseFilterOptions(1, 60000, async () => value('deleted'));
    await cache.getOrComputeFlatResponseFilterOptions(1, 100, async () => value('deleted'));
    const versionKey = cache.generateFlatResponseFilterOptionsVersionKey(1);
    const oldGeneration = await redis.get(versionKey);
    const queueName = 'flat-response-filter-options';
    const queueOptions = {
      connection: { host: redis.options.host, port: redis.options.port },
      prefix: `filter-options-repair-${randomUUID()}`
    };
    const queue = new Queue<FlatResponseFilterOptionsJobData>(queueName, queueOptions);
    const events = new QueueEvents(queueName, queueOptions);
    let worker: Worker<FlatResponseFilterOptionsJobData> | undefined;
    const set = jest.spyOn(redis, 'set');
    const statsDelete = jest.spyOn(cache, 'clearFlatResponseFilterOptionsGeneration').mockResolvedValueOnce(false);
    const repairDelete = jest.spyOn(otherReplica, 'clearFlatResponseFilterOptionsGeneration').mockResolvedValueOnce(false);
    try {
      const module = await createQueueModule(queue);
      await events.waitUntilReady();
      // Both writes and the fallback deletion during import fail, as does the first repair attempt.
      set.mockRejectedValueOnce(new Error('temporary write failure'))
        .mockRejectedValueOnce(new Error('immediate retry failed'));
      await expect(new WorkspaceStatsCacheService(cache, purgeQueue).invalidateWorkspaceStatsCache(1)).resolves.toBe(false);
      expect(await redis.get(versionKey)).toBe(oldGeneration);
      const compute = jest.fn().mockResolvedValue(value('fresh'));
      await expect(cache.getOrComputeFlatResponseFilterOptions(1, 60000, compute)).resolves.toEqual(value('deleted'));
      const job = await module.get(JobQueueService).addFlatResponseFilterOptionsJob(1, 60000, null);
      expect(job?.data).toEqual({ workspaceId: 1, processingDurationThresholdMs: 60000, generation: null });
      const results = { findFlatResponseFilterOptions: compute } as unknown as WorkspaceTestResultsService;
      const processor = new FlatResponseFilterOptionsProcessor(otherReplica, results);
      const processJob = jest.fn((repairJob: Job<FlatResponseFilterOptionsJobData>) => (
        processor.processWorkspaceJob(repairJob)
      ));
      worker = new Worker(queueName, processJob, queueOptions);
      await expect(job!.waitUntilFinished(events, 7000)).resolves.toBeNull();
      expect(processJob).toHaveBeenCalledTimes(2);
      await expect(processJob.mock.results[0].value).rejects.toThrow('Could not invalidate');
      expect(compute).toHaveBeenCalledTimes(1);
      expect(await redis.get(versionKey)).not.toBe(oldGeneration);
      const miss = jest.fn().mockResolvedValue(value('other threshold'));
      await expect(cache.getOrComputeFlatResponseFilterOptions(1, 60000, miss)).resolves.toEqual(value('fresh'));
      expect(miss).not.toHaveBeenCalled();
      await expect(cache.getOrComputeFlatResponseFilterOptions(1, 100, miss)).resolves.toEqual(value('other threshold'));
    } finally {
      set.mockRestore();
      statsDelete.mockRestore();
      repairDelete.mockRestore();
      await worker?.close();
      await events.close();
      await queue.obliterate();
      await queue.close();
    }
  }, 15_000);

  it.each(['import', 'controller'] as const)('isolates post-%s reads from pending old work across replicas', async invalidator => {
    await cache.getOrComputeFlatResponseFilterOptions(1, 100, async () => value('cached before'));
    const started = deferred<void>();
    const pending = deferred<FlatResponseFilterOptions>();
    const old = cache.getOrComputeFlatResponseFilterOptions(1, 60000, () => {
      started.resolve();
      return pending.promise;
    });
    await started.promise;
    const versionKey = cache.generateFlatResponseFilterOptionsVersionKey(1);
    const oldGeneration = (await redis.get(versionKey))!;
    if (invalidator === 'import') {
      await expect(new WorkspaceStatsCacheService(otherReplica, purgeQueue).invalidateWorkspaceStatsCache(1)).resolves.toBe(true);
    } else {
      await otherReplica.invalidateFlatResponseFilterOptions(1);
    }
    // The previous value can expire naturally and is unreachable in the new generation.
    expect(await redis.ttl(cache.generateFlatResponseFilterOptionsCacheKey(1, oldGeneration, 100))).toBeGreaterThan(0);
    const fresh = jest.fn().mockResolvedValue(value('after'));
    await expect(cache.getOrComputeFlatResponseFilterOptions(1, 100, async () => value('new threshold options')))
      .resolves.toEqual(value('new threshold options'));
    await expect(cache.getOrComputeFlatResponseFilterOptions(1, 60000, fresh)).resolves.toEqual(value('after'));
    const newGeneration = (await redis.get(versionKey))!;
    expect(newGeneration).not.toEqual(oldGeneration);
    expect(await redis.ttl(cache.generateFlatResponseFilterOptionsCacheKey(1, newGeneration, 60000))).toBeGreaterThan(0);
    pending.resolve(value('before'));
    await expect(old).resolves.toEqual(value('before'));
    expect(await redis.get(cache.generateFlatResponseFilterOptionsCacheKey(1, oldGeneration, 60000))).toBeNull();
    await expect(otherReplica.getOrComputeFlatResponseFilterOptions(1, 60000, fresh)).resolves.toEqual(value('after'));
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it('does not resurrect a value when invalidated work completes before the next read', async () => {
    const started = deferred<void>();
    const pending = deferred<FlatResponseFilterOptions>();
    const old = cache.getOrComputeFlatResponseFilterOptions(1, 60000, () => {
      started.resolve();
      return pending.promise;
    });
    await started.promise;
    const versionKey = cache.generateFlatResponseFilterOptionsVersionKey(1);
    const generation = (await redis.get(versionKey))!;
    await new WorkspaceStatsCacheService(otherReplica, purgeQueue).invalidateWorkspaceStatsCache(1);
    pending.resolve(value('before'));
    await old;
    expect(await redis.get(versionKey)).not.toBe(generation);
    expect(await redis.get(cache.generateFlatResponseFilterOptionsCacheKey(1, generation, 60000))).toBeNull();
    await expect(cache.getOrComputeFlatResponseFilterOptions(1, 60000, async () => value('after'))).resolves.toEqual(value('after'));
  });

  it('removes numeric cache values without changing generations, newer values or other namespaces', async () => {
    const legacyKeys = [
      cache.generateFlatResponseFilterOptionsCacheKey(1, 1, 60000),
      cache.generateFlatResponseFilterOptionsCacheKey(2, 12, -100)
    ];
    const oldVersion = cache.generateFlatResponseFilterOptionsVersionKey(2);
    const newVersion = cache.generateFlatResponseFilterOptionsVersionKey(1);
    const similarlyNamedKey = `${legacyKeys[0]}:other-data`;
    const foreign = redis.duplicate({ keyPrefix: `other:${redis.options.keyPrefix}` });
    await foreign.connect();
    try {
      await Promise.all([
        ...legacyKeys.map(key => cache.set(key, value('legacy'), 0)),
        redis.set(oldVersion, '12'),
        cache.set(similarlyNamedKey, value('other'), 0),
        foreign.set(legacyKeys[0], 'foreign')
      ]);
      await cache.getOrComputeFlatResponseFilterOptions(1, 60000, async () => value('current'));
      const generation = (await redis.get(newVersion))!;
      const currentKey = cache.generateFlatResponseFilterOptionsCacheKey(1, generation, 60000);

      await expect(cache.removeLegacyFlatResponseFilterOptions()).resolves.toBe(true);
      await expect(cache.removeLegacyFlatResponseFilterOptions()).resolves.toBe(true);
      for (const key of legacyKeys) await expect(redis.exists(key)).resolves.toBe(0);
      await expect(redis.get(newVersion)).resolves.toBe(generation);
      await expect(redis.get(oldVersion)).resolves.toBe('12');
      await expect(cache.get(currentKey)).resolves.toEqual(value('current'));
      await expect(cache.get(similarlyNamedKey)).resolves.toEqual(value('other'));
      await expect(foreign.get(legacyKeys[0])).resolves.toBe('foreign');
    } finally {
      await foreign.del(legacyKeys[0]);
      foreign.disconnect();
    }
  });

  it.each(['scan', 'del'] as const)('restarts legacy cleanup after a Redis %s failure and stops scanning on success', async command => {
    const key = cache.generateFlatResponseFilterOptionsCacheKey(1, 1, 60000);
    await cache.set(key, value('legacy'), 0);
    const store = createMock<FlatResponseFilterPurgeStore>({ pendingWorkspaces: async () => [] });
    const cleanup = new FlatResponseFilterCleanupService(cache, store);
    const retry = jest.spyOn(cleanup, 'retryCleanup');
    const sweep = jest.spyOn(cache, 'removeLegacyFlatResponseFilterOptions');
    const failed = jest.spyOn(redis, command).mockRejectedValueOnce(new Error('temporary Redis outage'));
    try {
      cleanup.onModuleInit();
      await retry.mock.results[0].value;
      expect(await redis.exists(key)).toBe(1);
      await cleanup.retryCleanup();
      expect(await redis.exists(key)).toBe(0);
      await cleanup.retryCleanup();
      expect(sweep).toHaveBeenCalledTimes(2);
    } finally {
      failed.mockRestore();
    }
  });

  it('retires legacy counters and isolates workspaces and thresholds', async () => {
    const versionKey = cache.generateFlatResponseFilterOptionsVersionKey(1);
    await redis.set(versionKey, '1');
    await cache.set(cache.generateFlatResponseFilterOptionsCacheKey(1, 1, 60000), value('legacy'), 0);
    await expect(cache.getOrComputeFlatResponseFilterOptions(1, 60000, async () => value('new'))).resolves.toEqual(value('new'));
    const first = await redis.get(versionKey);
    expect(first).toMatch(/^g2-[\da-f-]+$/);
    await expect(cache.getOrComputeFlatResponseFilterOptions(1, 1, async () => value('threshold'))).resolves.toEqual(value('threshold'));
    await expect(cache.getOrComputeFlatResponseFilterOptions(2, 60000, async () => value('workspace'))).resolves.toEqual(value('workspace'));
    await redis.del(versionKey);
    await expect(cache.getOrComputeFlatResponseFilterOptions(1, 60000, async () => value('recreated'))).resolves.toEqual(value('recreated'));
    expect(await redis.get(versionKey)).not.toEqual(first);
  });
});
