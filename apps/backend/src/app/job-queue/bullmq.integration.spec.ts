import { randomUUID } from 'crypto';
import { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BullModule, getQueueToken, Processor, WorkerHost
} from '@nestjs/bullmq';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import {
  Job, Queue, QueueEvents, Worker
} from 'bullmq';
import Redis from 'ioredis';
import { JobQueueService, TestPersonCodingJobData } from './job-queue.service';
import { AutocoderRunService } from './autocoder-run.service';
import { TestPersonCodingProcessor } from './processors/test-person-coding.processor';
import { CodingResetPreviewProcessor } from './processors/coding-reset-preview.processor';
import { CodingResetPreviewService } from '../database/services/coding/coding-reset-preview.service';
import { createJobQueueOptions, JOB_QUEUE_NAMES } from './job-queue.config';
import { requireJobId } from './job-queue.util';
import { ValidationTask } from '../database/entities/validation-task.entity';
import { CacheService } from '../cache/cache.service';

// Redis integration isolates queue delivery; PostgreSQL lifecycle locks have their own real-DB suite.
jest.mock('../database/services/shared/workspace-lifecycle-lock.util', () => ({
  withWorkspaceJobLock: jest.fn(async (_source, _workspaceId, operation: () => Promise<unknown>) => operation())
}));

const redisPort = Number(process.env.BULLMQ_TEST_REDIS_PORT);
const integration = redisPort ? describe : describe.skip;

integration('BullMQ with real Redis and the production Nest worker', () => {
  let app: INestApplicationContext;
  let queue: Queue<TestPersonCodingJobData>;
  let events: QueueEvents;
  let service: JobQueueService;
  const run = jest.fn();
  const previewRun = jest.fn().mockResolvedValue({ status: 'valid', affectedResponseCount: 123 });
  const result = { totalResponses: 1, statusCounts: { CODED: 1 } };
  const legacyPrefix = `bullmq-test-${randomUUID()}`;
  const options = createJobQueueOptions(new ConfigService({
    REDIS_HOST: process.env.BULLMQ_TEST_REDIS_HOST || '127.0.0.1',
    REDIS_PORT: String(redisPort),
    REDIS_PREFIX: legacyPrefix
  }));

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [
        BullModule.forRoot(options),
        BullModule.registerQueue(...JOB_QUEUE_NAMES.map(name => ({ name })))
      ],
      providers: [
        JobQueueService, TestPersonCodingProcessor, CodingResetPreviewProcessor,
        { provide: CodingResetPreviewService, useValue: { preview: previewRun } },
        { provide: getDataSourceToken(), useValue: {} },
        { provide: AutocoderRunService, useValue: { run } },
        { provide: getRepositoryToken(ValidationTask), useValue: { find: jest.fn().mockResolvedValue([]) } }
      ]
    }).compile();
    await app.init();
    queue = app.get<Queue<TestPersonCodingJobData>>(getQueueToken('test-person-coding'));
    service = app.get(JobQueueService);
    events = new QueueEvents('test-person-coding', options);
    await events.waitUntilReady();
    await app.get(TestPersonCodingProcessor).worker.waitUntilReady();
  }, 15_000);

  beforeEach(async () => {
    await queue.resume();
    run.mockReset();
    run.mockImplementation(async (job: Job) => {
      await job.updateProgress(37);
      return result;
    });
  });

  afterEach(async () => {
    await queue.resume();
    // Only queues with this test's random namespace are removed.
    await queue.drain(true);
  });

  afterAll(async () => {
    await events?.close();
    if (app) {
      for (const name of JOB_QUEUE_NAMES) {
        await app.get<Queue>(getQueueToken(name)).obliterate();
      }
    }
    await app?.close();
  });

  it('enqueues named work and persists progress/results through the real Nest worker', async () => {
    const job = await service.addTestPersonCodingJob({ workspaceId: 1, personIds: ['1'], autoCoderRun: 1 });
    expect(job.name).toBe('test-person-coding');
    await expect(job.waitUntilFinished(events, 5_000)).resolves.toEqual(result);
    const stored = await queue.getJob(requireJobId(job));
    expect(stored?.progress).toBe(37);
    expect(stored?.returnvalue).toEqual(result);
    expect(app.get(TestPersonCodingProcessor).worker.opts.concurrency).toBe(1);
    await expect(service.getTestPersonCodingJob('missing')).resolves.toBeNull();
    await expect(service.checkRedisConnection()).resolves.toMatchObject({ connected: true });
  });

  it('persists preview results in a separate queue with a Redis-enforced global concurrency limit', async () => {
    const previewQueue = app.get<Queue>(getQueueToken('coding-reset-preview'));
    const previewEvents = new QueueEvents('coding-reset-preview', options);
    await previewEvents.waitUntilReady();
    try {
      const scope = { version: 'v1' as const, unitFilters: ['DHB003'], variableFilters: [] };
      const job = await service.addResetCodingPreviewJob({ workspaceId: 7, scope });
      await expect(job.waitUntilFinished(previewEvents, 5_000)).resolves.toMatchObject({ affectedResponseCount: 123 });
      expect(await previewQueue.getGlobalConcurrency()).toBe(1);
      expect(previewRun).toHaveBeenCalledWith(7, scope);
      await expect(service.getWorkspaceJob(8, 'coding-reset-preview', requireJobId(job))).resolves.toBeNull();
    } finally {
      await previewEvents.close();
    }
  });

  it('publishes response analysis only while its result lists are complete and the run is current', async () => {
    const redis = new Redis({
      host: process.env.BULLMQ_TEST_REDIS_HOST || '127.0.0.1',
      port: redisPort,
      keyPrefix: `${legacyPrefix}:response-analysis:`
    });
    const cache = new CacheService(redis);
    const publication = {
      ttl: 600,
      listTtl: 660,
      lists: [{ key: 'empty', length: 2 }, { key: 'duplicates', length: 0 }],
      marker: { key: 'run', value: 'current-run' }
    };
    try {
      await cache.set('run', 'current-run', 0);
      await cache.set('result', { previous: true }, 600);
      await cache.appendListItems('empty', [{ responseId: 1 }, { responseId: 2 }], 3600);
      await redis.expire('empty', 0);
      await cache.appendListItems('empty', [{ responseId: 3 }], 3600);
      await expect(cache.publishListResult('result', { incomplete: true }, publication))
        .rejects.toThrow('Incomplete analysis result list');
      await expect(cache.get('result')).resolves.toEqual({ previous: true });

      await cache.appendListItems('empty', [{ responseId: 4 }], 3600);
      await expect(cache.publishListResult('result', { total: 2 }, publication)).resolves.toBe(true);
      expect(await redis.ttl('empty')).toBeGreaterThan(await redis.ttl('result'));

      await cache.set('run', 'new-run', 0);
      await expect(cache.publishListResult('result', { stale: true }, publication)).resolves.toBe(false);
      await expect(cache.get('result')).resolves.toEqual({ total: 2 });
    } finally {
      await redis.del('run', 'empty', 'duplicates', 'result');
      await redis.quit();
    }
  });

  it('does not consume or overwrite the previous Bull namespace', async () => {
    const client = await queue.getBackend().client;
    const oldWait = `${legacyPrefix}:test-person-coding:wait`;
    const oldResult = `${legacyPrefix}:cache:codebook-result:1`;
    await client.runCommand('rpush', [oldWait, 'legacy-job']);
    await client.runCommand('set', [oldResult, 'legacy-result']);
    try {
      const job = await service.addTestPersonCodingJob({ workspaceId: 2, personIds: ['1'], autoCoderRun: 1 });
      expect(requireJobId(job)).toMatch(/^[a-f0-9-]{36}$/);
      await job.waitUntilFinished(events, 5_000);
      expect(await client.runCommand('lrange', [oldWait, 0, -1])).toEqual(['legacy-job']);
      expect(await client.runCommand('get', [oldResult])).toBe('legacy-result');
    } finally {
      await client.runCommand('del', [oldWait, oldResult]);
    }
  });

  it('reports a validation waiting for recovery when its active lock is gone', async () => {
    const validationQueue = app.get<Queue>(getQueueToken('validation-task'));
    const worker = new Worker('validation-task', null, { ...options, autorun: false });
    try {
      const submitted = await service.addValidationTaskJob({ taskId: 71 });
      await worker.getNextJob('test-worker', { block: false });
      expect(await submitted.getState()).toBe('active');
      expect(await service.getValidationTaskRecovery([71])).toEqual(new Map());

      const redis = await validationQueue.getBackend().client;
      await redis.runCommand('del', [validationQueue.toKey(`${submitted.id}:lock`)]);
      expect(await submitted.getState()).toBe('active');
      expect(await service.getValidationTaskRecovery([71])).toEqual(new Map([[71, { status: 'pending' }]]));
    } finally {
      await worker.close(true);
      await validationQueue.obliterate({ force: true });
    }
  });

  it('includes prioritized and paused waiting work in ownership/conflict/cancellation checks', async () => {
    await queue.pause();
    const job = await service.addTestPersonCodingJob({ workspaceId: 3, personIds: ['1'], autoCoderRun: 1 }, { priority: 2 });
    expect(await job.getState()).toBe('prioritized');
    expect(await service.getJobsForWorkspaceDeletion([3])).toEqual(expect.arrayContaining([expect.objectContaining({ id: job.id, workspaceId: 3 })]));
    await expect(service.addTestPersonCodingJob({ workspaceId: 3, personIds: ['2'], autoCoderRun: 1 }))
      .rejects.toThrow('already running');
    await expect(service.getWorkspaceJob(4, 'test-person-coding', requireJobId(job))).resolves.toBeNull();
    expect((await service.getAllWorkspaceJobs(3))[0].status).toBe('paused');
    await expect(service.checkRedisConnection()).resolves.toMatchObject({
      details: { queueStatus: { jobCounts: { waiting: 0, paused: 1 } } }
    });
    await expect(service.cancelWorkspaceJob(3, 'test-person-coding', requireJobId(job))).resolves.toBe(true);
    expect(await queue.getJob(requireJobId(job))).toBeUndefined();
    const waiting = await service.addTestPersonCodingJob({ workspaceId: 3, personIds: ['1'], autoCoderRun: 1 });
    expect(await waiting.getState()).toBe('waiting');
    expect(await service.getJobsForWorkspaceDeletion([3])).toEqual(expect.arrayContaining([expect.objectContaining({ id: waiting.id, workspaceId: 3 })]));
    expect((await service.getAllWorkspaceJobs(3)).some(item => item.id === waiting.id)).toBe(true);
    await queue.resume();
    await waiting.waitUntilFinished(events, 5_000);
  });

  it('retains normal retry/backoff behavior', async () => {
    run.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValue(result);
    const job = await service.addTestPersonCodingJob({ workspaceId: 4, personIds: ['1'], autoCoderRun: 1 }, {
      attempts: 3, backoff: { type: 'fixed', delay: 20 }
    });
    await expect(job.waitUntilFinished(events, 5_000)).resolves.toEqual(result);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it.each(['isPaused', 'isCancelled', 'skipRetries'])('stops retries after another process sets %s on an active job', async flag => {
    let started!: () => void;
    let release!: () => void;
    const active = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    run.mockImplementation(async () => {
      started();
      await gate;
      throw new Error('failed after pause');
    });
    const job = await service.addTestPersonCodingJob({ workspaceId: 5, personIds: ['1'], autoCoderRun: 1 }, {
      attempts: 3, backoff: { type: 'fixed', delay: 20 }
    });
    await active;
    try {
      const external = await queue.getJob(requireJobId(job));
      if (!external) throw new Error('Active job is missing');
      if (flag === 'skipRetries') {
        await expect(service.cancelTestPersonCodingJob(requireJobId(job), 5)).resolves.toBe(true);
        expect((await queue.getJob(requireJobId(job)))?.data.skipRetries).toBe(true);
      } else {
        await external.updateData({ ...external.data, [flag]: true });
      }
    } finally {
      release();
    }
    await expect(job.waitUntilFinished(events, 5_000)).rejects.toThrow('failed after pause');
    expect(run).toHaveBeenCalledTimes(1);
    expect(await (await queue.getJob(requireJobId(job)))?.getState()).toBe('failed');
  });

  it('waits for active work when the Nest context shuts down', async () => {
    let started!: () => void;
    let release!: () => void;
    const active = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    @Processor('shutdown-check', { concurrency: 1 })
    class ShutdownWorker extends WorkerHost {
      async process() {
        started();
        await gate;
        return 'completed-before-shutdown';
      }
    }
    const context = await Test.createTestingModule({
      imports: [BullModule.forRoot(options), BullModule.registerQueue({ name: 'shutdown-check' })],
      providers: [ShutdownWorker]
    }).compile();
    await context.init();
    const producer = context.get<Queue>(getQueueToken('shutdown-check'));
    const job = await producer.add('shutdown-check', {});
    const inspect = new Queue('shutdown-check', options);
    let closed = false;
    try {
      await active;
      const closing = context.close().then(() => { closed = true; });
      try {
        await new Promise(resolve => { setTimeout(resolve, 30); });
        expect(closed).toBe(false);
      } finally {
        release();
      }
      await closing;
      const stored = await inspect.getJob(requireJobId(job));
      expect(await stored?.getState()).toBe('completed');
      expect(stored?.returnvalue).toBe('completed-before-shutdown');
    } finally {
      release();
      if (!closed) await context.close();
      await inspect.obliterate();
      await inspect.close();
    }
  });
});
