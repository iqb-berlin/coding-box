import { ConflictException } from '@nestjs/common';
import { JobQueueService } from './job-queue.service';

const createJob = (data: Record<string, unknown> = { workspaceId: 1, taskId: 7 }, state = 'waiting') => ({
  id: 'job-1',
  data,
  failedReason: undefined,
  timestamp: 100,
  processedOn: 110,
  finishedOn: 120,
  getState: jest.fn().mockResolvedValue(state),
  progress: jest.fn().mockReturnValue(40),
  remove: jest.fn().mockResolvedValue(undefined),
  update: jest.fn().mockResolvedValue(undefined),
  discard: jest.fn().mockResolvedValue(undefined)
});

const createQueue = (job = createJob()) => ({
  add: jest.fn().mockImplementation(async data => ({ ...job, data })),
  getJob: jest.fn().mockResolvedValue(job),
  getJobs: jest.fn().mockResolvedValue([job]),
  getJobCounts: jest.fn().mockResolvedValue({
    waiting: 1, active: 0, completed: 0, failed: 0, delayed: 0
  }),
  isReady: jest.fn().mockResolvedValue(undefined),
  client: { ping: jest.fn().mockResolvedValue('PONG') }
});

describe('JobQueueService', () => {
  let queues: ReturnType<typeof createQueue>[];
  let validationTaskRepository: { find: jest.Mock };
  let service: JobQueueService;

  beforeEach(() => {
    queues = Array.from({ length: 11 }, () => createQueue());
    validationTaskRepository = {
      find: jest.fn().mockResolvedValue([{ id: 7, workspace_id: 1 }])
    };
    service = new JobQueueService(
      queues[0] as never,
      queues[1] as never,
      queues[2] as never,
      queues[3] as never,
      queues[4] as never,
      queues[5] as never,
      queues[6] as never,
      queues[7] as never,
      queues[8] as never,
      queues[9] as never,
      queues[10] as never,
      validationTaskRepository as never
    );
  });

  it('adds and retrieves queue jobs', async () => {
    await expect(service.addTestPersonCodingJob({ workspaceId: 1, personIds: ['p1'] })).resolves.toMatchObject({ data: { workspaceId: 1 } });
    await expect(service.getTestPersonCodingJob('job-1')).resolves.toHaveProperty('id', 'job-1');
    await expect(service.addUploadJob({
      workspaceId: 1,
      file: { originalname: 'results.xml' } as never,
      resultType: 'responses',
      overwriteExisting: false
    })).resolves.toHaveProperty('data.resultType', 'responses');
    await expect(service.getUploadJob('job-1')).resolves.toHaveProperty('id', 'job-1');
    await expect(service.addResetCodingVersionJob({ workspaceId: 1, version: 'v1' })).resolves.toHaveProperty('data.version', 'v1');
    await expect(service.getResetCodingVersionJob('job-1')).resolves.toHaveProperty('id', 'job-1');
    await expect(service.addCodingAnalysisJob({
      workspaceId: 1, matchingFlags: [], threshold: 0, cacheKey: 'k'
    })).resolves.toHaveProperty('data.cacheKey', 'k');
    await expect(service.getCodingAnalysisJob('job-1')).resolves.toHaveProperty('id', 'job-1');
    await expect(service.addVariableAnalysisJob({ workspaceId: 1, unitId: 2 })).resolves.toHaveProperty('data.unitId', 2);
    await expect(service.getVariableAnalysisJob('job-1')).resolves.toHaveProperty('id', 'job-1');
    queues[10].getJobs.mockResolvedValue([]);
    await expect(service.addExternalCodingImportJob({ workspaceId: 1, tempFilePath: '/tmp/a', fileName: 'a.csv' })).resolves.toHaveProperty('data.fileName', 'a.csv');
    await expect(service.getExternalCodingImportJob('job-1')).resolves.toHaveProperty('id', 'job-1');
  });

  it('prevents duplicate active jobs where required', async () => {
    await expect(service.addCodingStatisticsJob(1, 'v2')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.addFlatResponseFilterOptionsJob(1, 250)).resolves.toBeNull();
    await expect(service.addCodebookGenerationJob({
      workspaceId: 1,
      missingsProfile: 1,
      contentOptions: {
        exportFormat: 'docx',
        missingsProfile: 'default',
        hasOnlyManualCoding: false,
        hasGeneralInstructions: false,
        hasDerivedVars: false,
        hasOnlyVarsWithCodes: false,
        hasClosedVars: false,
        codeLabelToUpper: false,
        showScore: false,
        hideItemVarRelation: false
      },
      unitIds: [1]
    })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.addValidationTaskJob({ taskId: 7 })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.addExternalCodingImportJob({ workspaceId: 1, tempFilePath: '/tmp/a', fileName: 'a.csv' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows jobs when no duplicate active job exists', async () => {
    queues.forEach(queue => queue.getJobs.mockResolvedValue([]));

    await expect(service.addCodingStatisticsJob(1, 'v1')).resolves.toHaveProperty('data.version', 'v1');
    await expect(service.addFlatResponseFilterOptionsJob(1, 100)).resolves.toHaveProperty('data.processingDurationThresholdMs', 100);
    await expect(service.addCodebookGenerationJob({
      workspaceId: 1,
      missingsProfile: 1,
      contentOptions: {
        exportFormat: 'docx',
        missingsProfile: 'default',
        hasOnlyManualCoding: false,
        hasGeneralInstructions: false,
        hasDerivedVars: false,
        hasOnlyVarsWithCodes: false,
        hasClosedVars: false,
        codeLabelToUpper: false,
        showScore: false,
        hideItemVarRelation: false
      },
      unitIds: [1]
    })).resolves.toHaveProperty('data.workspaceId', 1);
    await expect(service.addValidationTaskJob({ taskId: 8 })).resolves.toHaveProperty('data.taskId', 8);
    await expect(service.addExportJob({ workspaceId: 1, userId: 2, exportType: 'coding-list' })).resolves.toHaveProperty('data.exportType', 'coding-list');
  });

  it('cancels and deletes jobs across queues', async () => {
    await expect(service.cancelJob('test-person-coding', 'job-1')).resolves.toBe(true);
    await expect(service.cancelJob('unknown', 'job-1')).resolves.toBe(false);
    await expect(service.deleteJob('test-person-coding', 'job-1')).resolves.toBe(true);
    await expect(service.cancelTestPersonCodingJob('job-1')).resolves.toBe(true);
    await expect(service.deleteTestPersonCodingJob('job-1')).resolves.toBe(true);
    await expect(service.cancelExportJob('job-1')).resolves.toBe(true);
    await expect(service.markExportJobCancelled('job-1')).resolves.toBe(true);
    await expect(service.isExportJobCancelled('job-1')).resolves.toBe(false);
    await expect(service.deleteExportJob('job-1')).resolves.toBe(true);
    await expect(service.deleteVariableAnalysisJob('job-1')).resolves.toBe(true);
    await expect(service.cancelVariableAnalysisJob('job-1')).resolves.toBe(true);
  });

  it('only cancels workspace jobs that belong to the requested workspace', async () => {
    const ownJob = createJob({ workspaceId: 1 }, 'waiting');
    const otherWorkspaceJob = createJob({ workspaceId: 2 }, 'waiting');

    queues[0].getJob.mockResolvedValueOnce(otherWorkspaceJob);
    await expect(service.cancelWorkspaceJob(1, 'test-person-coding', 'job-1')).resolves.toBe(false);
    expect(otherWorkspaceJob.remove).not.toHaveBeenCalled();

    queues[0].getJob.mockResolvedValueOnce(ownJob);
    await expect(service.cancelWorkspaceJob(1, 'test-person-coding', 'job-1')).resolves.toBe(true);
    expect(ownJob.remove).toHaveBeenCalled();
  });

  it('checks validation-task ownership through the validation task table before cancelling', async () => {
    const validationJob = createJob({ taskId: 7 }, 'waiting');
    queues[7].getJob.mockResolvedValue(validationJob);

    validationTaskRepository.find.mockResolvedValueOnce([{ id: 7, workspace_id: 2 }]);
    await expect(service.cancelWorkspaceJob(1, 'validation-task', 'job-1')).resolves.toBe(false);
    expect(validationJob.remove).not.toHaveBeenCalled();

    validationTaskRepository.find.mockResolvedValueOnce([{ id: 7, workspace_id: 1 }]);
    await expect(service.cancelWorkspaceJob(1, 'validation-task', 'job-1')).resolves.toBe(true);
    expect(validationJob.remove).toHaveBeenCalled();
  });

  it('marks supported active jobs for cancellation without removing locked jobs', async () => {
    const exportJob = createJob({ workspaceId: 1, exportType: 'test-results' }, 'active');
    queues[2].getJob.mockResolvedValue(exportJob);

    await expect(service.cancelWorkspaceJob(1, 'data-export', 'job-1')).resolves.toBe(true);
    expect(exportJob.update).toHaveBeenCalledWith({
      workspaceId: 1,
      exportType: 'test-results',
      isCancelled: true
    });
    expect(exportJob.discard).toHaveBeenCalled();
    expect(exportJob.remove).not.toHaveBeenCalled();

    const unsupportedActiveJob = createJob({ workspaceId: 1 }, 'active');
    queues[1].getJob.mockResolvedValue(unsupportedActiveJob);
    await expect(service.cancelWorkspaceJob(1, 'coding-statistics', 'job-1')).resolves.toBe(false);
    expect(unsupportedActiveJob.remove).not.toHaveBeenCalled();
  });

  it('removes paused workspace jobs', async () => {
    const pausedJob = createJob({ workspaceId: 1 }, 'paused');
    queues[1].getJob.mockResolvedValue(pausedJob);

    await expect(service.cancelWorkspaceJob(1, 'coding-statistics', 'job-1')).resolves.toBe(true);
    expect(pausedJob.remove).toHaveBeenCalled();
  });

  it('handles missing jobs and failing queue operations', async () => {
    queues.forEach(queue => queue.getJob.mockResolvedValue(null));

    await expect(service.cancelJob('test-person-coding', 'missing')).resolves.toBe(false);
    await expect(service.deleteJob('test-person-coding', 'missing')).resolves.toBe(false);
    await expect(service.cancelTestPersonCodingJob('missing')).resolves.toBe(false);
    await expect(service.deleteTestPersonCodingJob('missing')).resolves.toBe(false);
    await expect(service.cancelExportJob('missing')).resolves.toBe(false);
    await expect(service.markExportJobCancelled('missing')).resolves.toBe(false);
    await expect(service.isExportJobCancelled('missing')).resolves.toBe(false);
    await expect(service.deleteExportJob('missing')).resolves.toBe(false);
    await expect(service.deleteVariableAnalysisJob('missing')).resolves.toBe(false);
    await expect(service.cancelVariableAnalysisJob('missing')).resolves.toBe(false);
  });

  it('lists workspace jobs and queue-specific jobs', async () => {
    const workspaceJobs = await service.getAllWorkspaceJobs(1);
    expect(workspaceJobs.length).toBeGreaterThan(0);
    expect(workspaceJobs[0]).toMatchObject({ queueName: expect.any(String), status: 'waiting' });

    await expect(service.getTestPersonCodingJobs(1)).resolves.toHaveLength(1);
    await expect(service.getExportJobs(1)).resolves.toHaveLength(1);
    await expect(service.getVariableAnalysisJobs(1)).resolves.toHaveLength(1);
    await expect(service.getActiveCodingAnalysisJob(1)).resolves.toHaveProperty('id', 'job-1');
    await expect(service.getActiveResetCodingVersionJob(1)).resolves.toHaveProperty('id', 'job-1');
  });

  it('sanitizes workspace job data before exposing process metadata', async () => {
    queues.forEach(queue => queue.getJobs.mockResolvedValue([]));
    queues[2].getJobs.mockResolvedValue([
      createJob({
        workspaceId: 1,
        exportType: 'test-results',
        authToken: 'secret-token',
        serverUrl: 'https://example.test',
        personIds: ['p1', 'p2'],
        testResultFilters: { personIds: [1, 2] }
      })
    ]);

    const workspaceJobs = await service.getAllWorkspaceJobs(1);

    expect(workspaceJobs).toHaveLength(1);
    expect(workspaceJobs[0].data).toEqual({
      workspaceId: 1,
      exportType: 'test-results',
      personCount: 2
    });
    expect(JSON.stringify(workspaceJobs[0].data)).not.toContain('secret-token');
    expect(JSON.stringify(workspaceJobs[0].data)).not.toContain('example.test');
  });

  it('ignores stale null jobs returned by Bull when listing workspace jobs', async () => {
    queues.forEach(queue => queue.getJobs.mockResolvedValue([]));
    queues[1].getJobs.mockResolvedValue([
      null,
      createJob({ workspaceId: 1, version: 'v1' })
    ] as never);

    const workspaceJobs = await service.getAllWorkspaceJobs(1);

    expect(workspaceJobs).toHaveLength(1);
    expect(workspaceJobs[0]).toMatchObject({
      queueName: 'coding-statistics',
      status: 'waiting'
    });
  });

  it('ignores stale null jobs when checking dependency conflicts', async () => {
    queues.forEach(queue => queue.getJobs.mockResolvedValue([]));
    queues[1].getJobs.mockResolvedValue([null] as never);

    await expect(service.assertNoDependencyConflicts('data-export', 1)).resolves.toBeUndefined();
  });

  it('checks dependency conflicts and redis status', async () => {
    await expect(service.assertNoActiveUploadForWorkspace(1)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.assertNoDependencyConflicts('data-export', 1)).rejects.toBeInstanceOf(ConflictException);

    queues.forEach(queue => queue.getJobs.mockResolvedValue([]));
    await expect(service.assertNoActiveUploadForWorkspace(1)).resolves.toBeUndefined();
    await expect(service.assertNoDependencyConflicts('data-export', 1)).resolves.toBeUndefined();

    await expect(service.checkRedisConnection()).resolves.toMatchObject({ connected: true });
    queues[0].client = null;
    await expect(service.checkRedisConnection()).resolves.toMatchObject({ connected: false });
  });

  it('deletes all variable analysis jobs including active ones', async () => {
    const activeJob = createJob({ workspaceId: 1 }, 'active');
    queues[9].getJobs.mockResolvedValue([activeJob]);

    await service.deleteVariableAnalysisJobs(1);

    expect(activeJob.discard).toHaveBeenCalled();
    expect(activeJob.remove).toHaveBeenCalled();
  });
});
