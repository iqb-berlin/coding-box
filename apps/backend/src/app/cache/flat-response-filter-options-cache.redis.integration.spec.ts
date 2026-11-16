import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { Job } from 'bullmq';
import { CacheService } from './cache.service';
import { WorkspaceStatsCacheService } from '../database/services/workspace/workspace-stats-cache.service';
import { WorkspaceTestResultsAnalysisController } from '../admin/workspace/workspace-test-results-analysis.controller';
import { WorkspaceTestResultsService } from '../database/services/test-results';
import { WorkspaceSettingsService } from '../workspace/workspace-settings.service';
import { FlatResponseFilterOptions } from '../admin/workspace/dto/workspace-test-results.interfaces';
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
      keyPrefix: `filter-options-test:${randomUUID()}:`,
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
    const job = { data: { workspaceId: 1, processingDurationThresholdMs: 60000 }, updateProgress: jest.fn(), id: 'test' };
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

  it.each(['import', 'controller'] as const)('isolates post-%s reads from pending old work across replicas', async invalidator => {
    const started = deferred<void>();
    const pending = deferred<FlatResponseFilterOptions>();
    const old = cache.getOrComputeFlatResponseFilterOptions(1, 60000, () => {
      started.resolve();
      return pending.promise;
    });
    await started.promise;
    const oldGeneration = await redis.get(cache.generateFlatResponseFilterOptionsVersionKey(1));
    if (invalidator === 'import') {
      await new WorkspaceStatsCacheService(otherReplica).invalidateWorkspaceStatsCache(1);
    } else {
      await otherReplica.invalidateFlatResponseFilterOptions(1);
    }
    const fresh = jest.fn().mockResolvedValue(value('after'));
    await expect(cache.getOrComputeFlatResponseFilterOptions(1, 60000, fresh)).resolves.toEqual(value('after'));
    const newGeneration = await redis.get(cache.generateFlatResponseFilterOptionsVersionKey(1));
    expect(newGeneration).not.toEqual(oldGeneration);
    pending.resolve(value('before'));
    await expect(old).resolves.toEqual(value('before'));
    expect(await redis.get(cache.generateFlatResponseFilterOptionsCacheKey(1, oldGeneration!, 60000))).toBeNull();
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
    expect(await redis.get(versionKey)).toBeNull();
    expect(await redis.get(cache.generateFlatResponseFilterOptionsCacheKey(1, generation, 60000))).toBeNull();
    await expect(cache.getOrComputeFlatResponseFilterOptions(1, 60000, async () => value('after'))).resolves.toEqual(value('after'));
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
