import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { ValidationTask } from '../database/entities/validation-task.entity';
import { JOB_QUEUE_NAMES } from './job-queue.config';
import { JobQueueService } from './job-queue.service';

const integration = process.env.POSTGRES_INTEGRATION_TESTS === 'true' && process.env.BULLMQ_TEST_REDIS_PORT ? describe : describe.skip;

integration('Workspace result job starts with two API instances', () => {
  const prefix = `result-job-start-${randomUUID()}`;
  const sources: DataSource[] = [];
  const apps: TestingModule[] = [];
  const uploadData = { resultType: 'responses' as const, overwriteExisting: false };
  const files = ['one.csv', 'two.csv'].map(originalname => ({
    originalname, fieldname: 'files', mimetype: 'text/csv', size: 0, encoding: 'utf8'
  }));

  beforeAll(async () => {
    for (let index = 0; index < 2; index++) {
      const database = await new DataSource({
        type: 'postgres',
        host: process.env.POSTGRES_HOST,
        port: Number(process.env.POSTGRES_PORT),
        username: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
        database: process.env.POSTGRES_DB
      }).initialize();
      sources.push(database);
      const app = await Test.createTestingModule({
        imports: [
          BullModule.forRoot({
            prefix,
            connection: {
              host: process.env.BULLMQ_TEST_REDIS_HOST, port: Number(process.env.BULLMQ_TEST_REDIS_PORT)
            }
          }),
          BullModule.registerQueue(...JOB_QUEUE_NAMES.map(name => ({ name })))
        ],
        providers: [
          JobQueueService, { provide: getDataSourceToken(), useValue: database },
          { provide: getRepositoryToken(ValidationTask), useValue: {} }
        ]
      }).compile();
      apps.push(app);
    }
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    for (const name of ['test-results-upload', 'test-person-coding']) {
      await apps[0].get<Queue>(getQueueToken(name)).obliterate({ force: true });
    }
  });

  afterAll(async () => {
    await Promise.all(apps.map(app => app.close()));
    await Promise.all(sources.map(source => source.destroy()));
  });

  it('admits a later request when Redis rejects the enqueue', async () => {
    const queue = apps[0].get<Queue>(getQueueToken('test-results-upload'));
    jest.spyOn(queue, 'addBulk').mockRejectedValueOnce(new Error('enqueue failed'));
    await expect(apps[0].get(JobQueueService).addUploadJobs({ workspaceId: 17, ...uploadData }, files))
      .rejects.toThrow('enqueue failed');
    await expect(apps[1].get(JobQueueService).addTestPersonCodingJob({
      workspaceId: 17, personIds: ['1'], autoCoderRun: 1
    })).resolves.toHaveProperty('id');
  });

  it.each(['upload', 'coding'] as const)('admits only the first request while %s is being enqueued', async first => {
    const firstApi = apps[0].get(JobQueueService);
    const otherApi = apps[1].get(JobQueueService);
    const upload = (api: JobQueueService, workspaceId: number) => api.addUploadJobs({ workspaceId, ...uploadData }, files);
    const coding = (api: JobQueueService, workspaceId: number) => api.addTestPersonCodingJob({ workspaceId, personIds: ['1'], autoCoderRun: 1 });
    const competingStart = first === 'upload' ? coding : upload;
    const queue = apps[0].get<Queue>(getQueueToken(first === 'upload' ? 'test-results-upload' : 'test-person-coding'));
    // Let a second API attempt both workspaces after the checks and before Redis receives the winning job.
    const beforeEnqueue = jest.fn(async () => {
      await expect(competingStart(otherApi, 17)).rejects.toBeInstanceOf(ConflictException);
      await expect(competingStart(otherApi, 18)).resolves.toBeDefined();
    });
    if (first === 'upload') {
      const add = queue.addBulk.bind(queue);
      jest.spyOn(queue, 'addBulk').mockImplementationOnce(async jobs => {
        await beforeEnqueue();
        return add(jobs);
      });
      await upload(firstApi, 17);
    } else {
      const add = queue.add.bind(queue);
      jest.spyOn(queue, 'add').mockImplementationOnce(async (...args) => {
        await beforeEnqueue();
        return add(...args);
      });
      await coding(firstApi, 17);
    }
    expect(beforeEnqueue).toHaveBeenCalledTimes(1);
    await expect(competingStart(otherApi, 17)).rejects.toBeInstanceOf(ConflictException);
    const admitted = await queue.getJobs(['waiting']);
    expect(admitted.map(job => job.data.workspaceId)).toEqual(first === 'upload' ? [17, 17] : [17]);
    for (const job of admitted) await job.remove();
    await expect(competingStart(otherApi, 17)).resolves.toBeDefined();
  });
});
