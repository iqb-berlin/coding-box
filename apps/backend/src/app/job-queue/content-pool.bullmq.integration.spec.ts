import { randomUUID } from 'crypto';
import { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Queue, QueueEvents } from 'bullmq';
import { JobQueueService } from './job-queue.service';
import { createJobQueueOptions, JOB_QUEUE_NAMES } from './job-queue.config';
import { ContentPoolProcessor } from './processors/content-pool.processor';
import { ContentPoolIntegrationService } from '../admin/content-pool/content-pool-integration.service';
import { ContentPoolJobData, ContentPoolJobResult } from '../admin/content-pool/content-pool-job';
import { ValidationTask } from '../database/entities/validation-task.entity';
import { Setting } from '../database/entities/setting.entity';
import FileUpload from '../database/entities/file_upload.entity';
import { WorkspaceFilesService } from '../database/services/workspace';

jest.mock('../database/services/shared/workspace-lifecycle-lock.util', () => ({
  withWorkspaceJobLock: jest.fn(async (_source, _workspaceId, operation: () => Promise<unknown>) => operation())
}));

const redisPort = Number(process.env.BULLMQ_TEST_REDIS_PORT);
const integration = redisPort ? describe : describe.skip;

integration('Content-Pool jobs with real Redis and separate API/worker contexts', () => {
  let api: INestApplicationContext;
  let worker: INestApplicationContext | undefined;
  let events: QueueEvents;
  let queue: Queue<ContentPoolJobData, ContentPoolJobResult>;
  const result = {
    total: 1, uploaded: 1, failed: 0, uploadedFiles: [], failedFiles: []
  };
  const options = createJobQueueOptions(new ConfigService({
    REDIS_HOST: process.env.BULLMQ_TEST_REDIS_HOST || '127.0.0.1',
    REDIS_PORT: String(redisPort),
    REDIS_PREFIX: `content-pool-test-${randomUUID()}`
  }));

  async function createContext(consume: boolean) {
    const app = await Test.createTestingModule({
      imports: [BullModule.forRoot(options), BullModule.registerQueue(...JOB_QUEUE_NAMES.map(name => ({ name })))],
      providers: [
        JobQueueService, ContentPoolIntegrationService,
        ...(consume ? [ContentPoolProcessor] : []),
        { provide: getDataSourceToken(), useValue: {} },
        ...[ValidationTask, Setting, FileUpload].map(entity => ({ provide: getRepositoryToken(entity), useValue: {} })),
        { provide: HttpService, useValue: {} },
        { provide: WorkspaceFilesService, useValue: {} }
      ]
    }).compile();
    jest.spyOn(app.get(ContentPoolIntegrationService), 'importAcpFilesToWorkspace').mockImplementation(async (_input, progress) => {
      await progress?.({ phase: 'downloading-files', progress: 25 });
      return result;
    });
    await app.init();
    if (consume) await app.get(ContentPoolProcessor).worker.waitUntilReady();
    return app;
  }

  beforeAll(async () => {
    api = await createContext(false);
    queue = api.get(getQueueToken('content-pool'));
    events = new QueueEvents('content-pool', options);
    await events.waitUntilReady();
  }, 15_000);
  afterAll(async () => {
    await worker?.close();
    await events?.close();
    if (api) {
      for (const name of JOB_QUEUE_NAMES) await api.get<Queue>(getQueueToken(name)).obliterate();
      await api.close();
    }
  });

  it('processes persisted work after a worker starts and retains results after that worker shuts down', async () => {
    const service = api.get(ContentPoolIntegrationService);
    const { jobId } = await service.startAcpImportToWorkspace({ workspaceId: 2, acpId: 'fixture' });
    await expect(service.getAcpImportProgress(2, jobId)).resolves.toMatchObject({ status: 'pending' });
    worker = await createContext(true);
    const job = await queue.getJob(jobId);
    await expect(job!.waitUntilFinished(events, 5000)).resolves.toEqual(result);
    await worker.close();
    worker = undefined;
    await expect(service.getAcpImportProgress(2, jobId)).resolves.toMatchObject({ status: 'completed', progress: 100, result });
    await expect(service.getAcpImportProgress(1, jobId)).rejects.toMatchObject({ status: 404 });
  });

  it('returns the persisted result when the worker completes between loading the job and reading its state', async () => {
    worker = await createContext(true);
    let release!: () => void;
    let markStarted!: () => void;
    const completion = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    jest.spyOn(worker.get(ContentPoolIntegrationService), 'importAcpFilesToWorkspace').mockImplementation(async () => {
      markStarted();
      await completion;
      return result;
    });
    const readJob = jest.spyOn(queue, 'getJob');
    try {
      const service = api.get(ContentPoolIntegrationService);
      const { jobId } = await service.startAcpImportToWorkspace({ workspaceId: 2, acpId: 'fixture' });
      await started;
      const snapshot = (await queue.getJob(jobId))!;
      expect(snapshot.returnvalue).toBeNull();
      const readState = snapshot.getState.bind(snapshot);
      jest.spyOn(snapshot, 'getState').mockImplementationOnce(async () => {
        release();
        await snapshot.waitUntilFinished(events, 5000);
        return readState();
      });
      readJob.mockResolvedValueOnce(snapshot);

      await expect(service.getAcpImportProgress(2, jobId)).resolves.toMatchObject({ status: 'completed', result });
    } finally {
      release();
      readJob.mockRestore();
      await worker.close();
      worker = undefined;
    }
  });
});
