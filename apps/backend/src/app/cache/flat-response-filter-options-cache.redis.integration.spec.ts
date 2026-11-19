import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import {
  Job, Queue, QueueEvents, Worker
} from 'bullmq';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CacheService } from './cache.service';
import { WorkspaceStatsCacheService } from '../database/services/workspace/workspace-stats-cache.service';
import { WorkspaceTestResultsAnalysisController } from '../admin/workspace/workspace-test-results-analysis.controller';
import { WorkspaceTestResultsService } from '../database/services/test-results';
import { WorkspaceSettingsService } from '../workspace/workspace-settings.service';
import { FlatResponseFilterOptions } from '../admin/workspace/dto/workspace-test-results.interfaces';
import { ValidationTask } from '../database/entities/validation-task.entity';
import { JOB_QUEUE_NAMES } from '../job-queue/job-queue.config';
import { FlatResponseFilterOptionsJobData, JobQueueService } from '../job-queue/job-queue.service';
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
    cache = new CacheService(redis);
    otherReplica = new CacheService(redis);
  });

  afterEach(async () => { await cache.deleteByPattern('*'); });
  afterAll(() => { redis?.disconnect(); });

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
      await expect(new WorkspaceStatsCacheService(cache).invalidateWorkspaceStatsCache(1)).resolves.toBe(true);
      expect(set).toHaveBeenCalledTimes(2);

      const compute = jest.fn().mockResolvedValue(value('current'));
      await expect(otherReplica.getOrComputeFlatResponseFilterOptions(1, 60000, compute)).resolves.toEqual(value('current'));
      expect(compute).toHaveBeenCalledTimes(1);
    } finally {
      set.mockRestore();
    }
  });

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
    try {
      const module = await Test.createTestingModule({
        providers: [
          JobQueueService,
          ...JOB_QUEUE_NAMES.map(name => ({ provide: getQueueToken(name), useValue: name === queueName ? queue : {} })),
          { provide: getRepositoryToken(ValidationTask), useValue: {} }
        ]
      }).compile();
      await events.waitUntilReady();
      // Both writes during import and the first repair attempt fail.
      set.mockRejectedValueOnce(new Error('temporary write failure'))
        .mockRejectedValueOnce(new Error('immediate retry failed'))
        .mockRejectedValueOnce(new Error('first queued repair failed'));
      await expect(new WorkspaceStatsCacheService(cache).invalidateWorkspaceStatsCache(1)).resolves.toBe(false);
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
      await expect(new WorkspaceStatsCacheService(otherReplica).invalidateWorkspaceStatsCache(1)).resolves.toBe(true);
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
    await new WorkspaceStatsCacheService(otherReplica).invalidateWorkspaceStatsCache(1);
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
