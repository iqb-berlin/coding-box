import { Job } from 'bull';
import {
  JobQueueService,
  TestPersonCodingJobData
} from '../../../job-queue/job-queue.service';
import { BullJobManagementService } from './bull-job-management.service';

describe('BullJobManagementService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const createFailedJob = (
    data: TestPersonCodingJobData
  ): Job<TestPersonCodingJobData> => ({
    id: 'old-job',
    data,
    getState: jest.fn().mockResolvedValue('failed')
  } as unknown as Job<TestPersonCodingJobData>);

  const createService = (job: Job<TestPersonCodingJobData>) => {
    const jobQueueService = {
      getTestPersonCodingJob: jest.fn().mockResolvedValue(job),
      getTestPersonCodingJobs: jest.fn().mockResolvedValue([]),
      assertNoDependencyConflicts: jest.fn().mockResolvedValue(undefined),
      addTestPersonCodingJob: jest.fn().mockResolvedValue({ id: 'new-job' }),
      deleteTestPersonCodingJob: jest.fn().mockResolvedValue(true)
    };

    return {
      service: new BullJobManagementService(
        jobQueueService as unknown as JobQueueService
      ),
      jobQueueService
    };
  };

  it('restarts a failed run-2 job with all domain parameters intact', async () => {
    const originalData: TestPersonCodingJobData = {
      workspaceId: 7,
      personIds: ['11', '12'],
      unitIds: [101, 102],
      groupNames: 'group-a,group-b',
      isPaused: true,
      autoCoderRun: 2,
      source: 'coding-freshness',
      freshnessVersion: 'v3',
      freshnessStates: ['PENDING', 'STALE'],
      freshnessSourceRevision: 42
    };
    const { service, jobQueueService } = createService(
      createFailedJob(originalData)
    );

    await expect(service.restartJob('old-job')).resolves.toEqual({
      success: true,
      message: 'Job old-job has been restarted as job new-job',
      jobId: 'new-job'
    });

    expect(jobQueueService.addTestPersonCodingJob).toHaveBeenCalledWith({
      workspaceId: 7,
      personIds: ['11', '12'],
      unitIds: [101, 102],
      groupNames: 'group-a,group-b',
      isPaused: false,
      autoCoderRun: 2,
      source: 'coding-freshness',
      freshnessVersion: 'v3',
      freshnessStates: ['PENDING', 'STALE'],
      freshnessSourceRevision: 42
    });
    expect(jobQueueService.deleteTestPersonCodingJob).toHaveBeenCalledWith(
      'old-job'
    );
  });

  it.each([undefined, 3])(
    'refuses to restart a job with autoCoderRun %s',
    async autoCoderRun => {
      const invalidData = {
        workspaceId: 7,
        personIds: ['11'],
        autoCoderRun
      } as unknown as TestPersonCodingJobData;
      const { service, jobQueueService } = createService(
        createFailedJob(invalidData)
      );

      await expect(service.restartJob('old-job')).resolves.toEqual({
        success: false,
        message: 'Error restarting job: autoCoderRun must be 1 or 2'
      });

      expect(jobQueueService.addTestPersonCodingJob).not.toHaveBeenCalled();
      expect(jobQueueService.deleteTestPersonCodingJob).not.toHaveBeenCalled();
    }
  );

  it('keeps domain parameters when pausing an active job and clears the pause marker on resume', async () => {
    const data: TestPersonCodingJobData = {
      workspaceId: 7,
      personIds: ['11'],
      unitIds: [101],
      autoCoderRun: 2,
      source: 'coding-freshness',
      freshnessVersion: 'v3',
      freshnessSourceRevision: 42
    };
    const job = createFailedJob(data);
    job.getState = jest.fn().mockResolvedValue('active');
    job.update = jest.fn().mockResolvedValue(undefined);
    const { service } = createService(job);

    await expect(service.pauseJob('old-job')).resolves.toEqual({
      success: true, message: 'Job old-job has been paused successfully'
    });
    expect(job.update).toHaveBeenCalledWith({ ...data, isPaused: true });

    job.data = { ...data, isPaused: true };
    await expect(service.resumeJob('old-job')).resolves.toEqual({
      success: true, message: 'Job old-job has been resumed successfully'
    });
    expect(job.update).toHaveBeenLastCalledWith(data);
  });

  it('refuses to pause a completed job without mutating its data', async () => {
    const job = createFailedJob({ workspaceId: 7, personIds: ['11'], autoCoderRun: 1 });
    job.getState = jest.fn().mockResolvedValue('completed');
    job.update = jest.fn();
    const { service } = createService(job);

    await expect(service.pauseJob('old-job')).resolves.toEqual({
      success: false, message: 'Job with ID old-job cannot be paused because it is completed'
    });
    expect(job.update).not.toHaveBeenCalled();
  });

  it('keeps the failed job when a conflicting dependency prevents its restart', async () => {
    const job = createFailedJob({ workspaceId: 7, personIds: ['11'], autoCoderRun: 2 });
    const { service, jobQueueService } = createService(job);
    jobQueueService.assertNoDependencyConflicts.mockRejectedValue(new Error('reset job active'));
    jest.spyOn(
      (service as unknown as { logger: { error: (message: string, stack?: string) => void } }).logger,
      'error'
    ).mockImplementation(() => undefined);

    await expect(service.restartJob('old-job')).resolves.toEqual({
      success: false, message: 'Error restarting job: reset job active'
    });
    expect(jobQueueService.assertNoDependencyConflicts).toHaveBeenCalledWith('test-person-coding', 7);
    expect(jobQueueService.addTestPersonCodingJob).not.toHaveBeenCalled();
    expect(jobQueueService.deleteTestPersonCodingJob).not.toHaveBeenCalled();
  });

  it('returns newest jobs first with state-specific results and normalized progress', async () => {
    const job = createFailedJob({ workspaceId: 7, personIds: ['11'], autoCoderRun: 1 });
    const { service, jobQueueService } = createService(job);
    const statistics = { totalResponses: 2, statusCounts: { CODED: 2 } };
    jobQueueService.getTestPersonCodingJobs.mockResolvedValue([
      {
        id: 11,
        data: {
          ...job.data, unitIds: [101, 102], source: 'coding-freshness', freshnessVersion: 'v3'
        },
        timestamp: 100,
        finishedOn: 400,
        returnvalue: statistics,
        getState: jest.fn().mockResolvedValue('completed'),
        progress: jest.fn().mockResolvedValue(100)
      },
      {
        id: 12,
        data: job.data,
        timestamp: 300,
        failedReason: 'coding failed',
        returnvalue: statistics,
        getState: jest.fn().mockResolvedValue('failed'),
        progress: jest.fn().mockResolvedValue({ rows: 5 })
      },
      {
        id: 13,
        data: job.data,
        timestamp: 200,
        getState: jest.fn().mockResolvedValue('waiting'),
        progress: jest.fn().mockResolvedValue(undefined)
      }
    ]);

    await expect(service.getBullJobs(7)).resolves.toEqual([
      expect.objectContaining({
        jobId: '12',
        status: 'failed',
        progress: 0,
        result: undefined,
        error: 'coding failed',
        workspaceId: 7,
        createdAt: new Date(300),
        completedAt: undefined,
        durationMs: undefined
      }),
      expect.objectContaining({
        jobId: '13',
        status: 'pending',
        progress: 0,
        result: undefined,
        error: undefined,
        workspaceId: 7,
        createdAt: new Date(200)
      }),
      expect.objectContaining({
        jobId: '11',
        status: 'completed',
        progress: 100,
        result: statistics,
        error: undefined,
        workspaceId: 7,
        createdAt: new Date(100),
        completedAt: new Date(400),
        durationMs: 300,
        source: 'coding-freshness',
        freshnessVersion: 'v3',
        unitCount: 2
      })
    ]);
    expect(jobQueueService.getTestPersonCodingJobs).toHaveBeenCalledWith(7);
  });

  it('reports queue lookup failures while returning the documented empty list', async () => {
    const job = createFailedJob({ workspaceId: 7, personIds: ['11'], autoCoderRun: 1 });
    const { service, jobQueueService } = createService(job);
    const error = new Error('redis unavailable');
    jobQueueService.getTestPersonCodingJobs.mockRejectedValue(error);
    const logger = (service as unknown as {
      logger: { error: (message: string, stack?: string) => void }
    }).logger;
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

    await expect(service.getBullJobs(7)).resolves.toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith('Error getting jobs from Redis queue: redis unavailable', error.stack);
  });
});
