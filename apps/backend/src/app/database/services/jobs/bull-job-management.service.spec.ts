import { BadRequestException } from '@nestjs/common';
import { Job } from 'bull';
import {
  JobQueueService,
  TestPersonCodingJobData
} from '../../../job-queue/job-queue.service';
import { BullJobManagementService } from './bull-job-management.service';
import { CodingFreshnessService } from '../coding/coding-freshness.service';
import { CodingReadinessService } from '../coding/coding-readiness.service';

describe('BullJobManagementService', () => {
  const createFailedJob = (
    data: TestPersonCodingJobData
  ): Job<TestPersonCodingJobData> => ({
    id: 'old-job',
    data,
    getState: jest.fn().mockResolvedValue('failed')
  } as unknown as Job<TestPersonCodingJobData>);

  const createService = (job: Job<TestPersonCodingJobData>) => {
    const jobQueueService = {
      getWorkspaceJob: jest.fn().mockResolvedValue(job),
      assertNoDependencyConflicts: jest.fn().mockResolvedValue(undefined),
      addTestPersonCodingJob: jest.fn().mockResolvedValue({ id: 'new-job' }),
      deleteTestPersonCodingJob: jest.fn().mockResolvedValue(true)
    };

    return {
      service: new BullJobManagementService(
        jobQueueService as unknown as JobQueueService,
        {
          assertAutoCodingRunCanStart: jest.fn().mockResolvedValue(undefined),
          isRevisionCurrent: jest.fn().mockResolvedValue(true)
        } as unknown as CodingFreshnessService,
        { assertAutoCodingCanProcess: jest.fn().mockResolvedValue(undefined) } as unknown as CodingReadinessService
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

    await expect(service.restartJob('old-job', 7)).resolves.toEqual({
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
      'old-job', 7
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

      await expect(service.restartJob('old-job', 7)).resolves.toEqual({
        success: false,
        message: 'Error restarting job: autoCoderRun must be 1 or 2'
      });

      expect(jobQueueService.addTestPersonCodingJob).not.toHaveBeenCalled();
      expect(jobQueueService.deleteTestPersonCodingJob).not.toHaveBeenCalled();
    }
  );
});

describe('BullJobManagementService workspace isolation', () => {
  const createJob = (workspaceId: number, state = 'waiting') => ({
    id: '17',
    data: {
      workspaceId,
      personIds: ['1'],
      unitIds: [8],
      autoCoderRun: 2,
      groupNames: 'G1',
      source: 'coding-freshness',
      freshnessVersion: 'v3',
      freshnessStates: ['PENDING', 'STALE'],
      freshnessSourceRevision: 9,
      isPaused: true
    } as TestPersonCodingJobData,
    getState: jest.fn().mockResolvedValue(state),
    update: jest.fn().mockResolvedValue(undefined)
  });

  const createService = (job: ReturnType<typeof createJob>) => {
    const queue = {
      getWorkspaceJob: jest.fn().mockImplementation(async workspaceId => (
        job.data.workspaceId === workspaceId ? job : null
      )),
      assertNoDependencyConflicts: jest.fn().mockResolvedValue(undefined),
      addTestPersonCodingJob: jest.fn().mockResolvedValue({ id: '18' }),
      deleteTestPersonCodingJob: jest.fn().mockResolvedValue(true)
    };
    const freshness = {
      assertAutoCodingRunCanStart: jest.fn().mockResolvedValue(undefined),
      isRevisionCurrent: jest.fn().mockResolvedValue(true)
    };
    const readiness = {
      assertAutoCodingCanProcess: jest.fn().mockResolvedValue(undefined)
    };
    return {
      queue,
      freshness,
      readiness,
      service: new BullJobManagementService(
        queue as unknown as JobQueueService,
        freshness as unknown as CodingFreshnessService,
        readiness as unknown as CodingReadinessService
      )
    };
  };

  it.each(['pauseJob', 'resumeJob', 'restartJob'] as const)(
    '%s rejects a foreign job before reading or changing its state', async operation => {
      const job = createJob(2, 'failed');
      const {
        service, queue, freshness, readiness
      } = createService(job);

      await expect(service[operation]('17', 1)).resolves.toMatchObject({ success: false });
      expect(queue.getWorkspaceJob).toHaveBeenCalledWith(1, 'test-person-coding', '17');
      expect(job.getState).not.toHaveBeenCalled();
      expect(job.update).not.toHaveBeenCalled();
      expect(queue.addTestPersonCodingJob).not.toHaveBeenCalled();
      expect(queue.deleteTestPersonCodingJob).not.toHaveBeenCalled();
      expect(freshness.assertAutoCodingRunCanStart).not.toHaveBeenCalled();
      expect(freshness.isRevisionCurrent).not.toHaveBeenCalled();
      expect(readiness.assertAutoCodingCanProcess).not.toHaveBeenCalled();
    }
  );

  it('pauses and resumes jobs owned by the requested workspace', async () => {
    const job = createJob(1);
    const { service } = createService(job);

    await expect(service.pauseJob('17', 1)).resolves.toMatchObject({ success: true });
    expect(job.update).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 1, isPaused: true }));
    await expect(service.resumeJob('17', 1)).resolves.toMatchObject({ success: true });
    expect(job.update).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: 1, unitIds: [8] }));
    expect(job.update.mock.calls[1][0]).not.toHaveProperty('isPaused');
  });

  it('restarts an owned failed job while retaining its original coding scope and revision', async () => {
    const job = createJob(1, 'failed');
    const {
      service, queue, freshness, readiness
    } = createService(job);

    await expect(service.restartJob('17', 1)).resolves.toMatchObject({ success: true, jobId: '18' });
    expect(queue.addTestPersonCodingJob).toHaveBeenCalledWith({ ...job.data, isPaused: false });
    expect(queue.deleteTestPersonCodingJob).toHaveBeenCalledWith('17', 1);
    expect(freshness.assertAutoCodingRunCanStart).toHaveBeenCalledWith(1, 2);
    expect(readiness.assertAutoCodingCanProcess).toHaveBeenCalledWith(1, {
      personIds: ['1'],
      unitIds: [8],
      autoCoderRun: 2
    });
    expect(freshness.isRevisionCurrent).toHaveBeenCalledWith(1, 9);
    expect(job.update).not.toHaveBeenCalled();
  });

  it('rejects restarting run 2 when the regular freshness prerequisites are blocked', async () => {
    const job = createJob(1, 'failed');
    delete job.data.freshnessSourceRevision;
    const originalData = { ...job.data };
    const {
      service, queue, freshness, readiness
    } = createService(job);
    freshness.assertAutoCodingRunCanStart.mockRejectedValue(
      new BadRequestException('Auto-Coding 1 ist veraltet. Manuelle Prüfung ist erforderlich.')
    );

    await expect(service.restartJob('17', 1)).resolves.toMatchObject({
      success: false,
      message: expect.stringContaining('Manuelle Prüfung ist erforderlich')
    });
    expect(freshness.assertAutoCodingRunCanStart).toHaveBeenCalledWith(1, 2);
    expect(readiness.assertAutoCodingCanProcess).not.toHaveBeenCalled();
    expect(queue.addTestPersonCodingJob).not.toHaveBeenCalled();
    expect(queue.deleteTestPersonCodingJob).not.toHaveBeenCalled();
    expect(job.update).not.toHaveBeenCalled();
    expect(job.data).toEqual(originalData);
  });

  it('retains the failed job when scoped coding readiness rejects the restart', async () => {
    const job = createJob(1, 'failed');
    const originalData = { ...job.data };
    const {
      service, queue, readiness
    } = createService(job);
    readiness.assertAutoCodingCanProcess.mockRejectedValue(
      new BadRequestException('Das Kodierschema für die gewählte Aufgabe ist ungültig.')
    );

    await expect(service.restartJob('17', 1)).resolves.toMatchObject({
      success: false,
      message: expect.stringContaining('Kodierschema')
    });
    expect(queue.addTestPersonCodingJob).not.toHaveBeenCalled();
    expect(queue.deleteTestPersonCodingJob).not.toHaveBeenCalled();
    expect(job.update).not.toHaveBeenCalled();
    expect(job.data).toEqual(originalData);
  });

  it('rejects a stale planned revision without creating or deleting a job', async () => {
    const job = createJob(1, 'failed');
    const originalData = { ...job.data };
    const { service, queue, freshness } = createService(job);
    freshness.isRevisionCurrent.mockResolvedValue(false);

    await expect(service.restartJob('17', 1)).resolves.toMatchObject({
      success: false,
      message: expect.stringContaining('Bitte starten Sie einen neuen Autocoder-Lauf')
    });
    expect(freshness.isRevisionCurrent).toHaveBeenCalledWith(1, 9);
    expect(queue.addTestPersonCodingJob).not.toHaveBeenCalled();
    expect(queue.deleteTestPersonCodingJob).not.toHaveBeenCalled();
    expect(job.update).not.toHaveBeenCalled();
    expect(job.data).toEqual(originalData);
  });

  it.each([0, 3, '2', null])('does not reinterpret an invalid stored run %p', async storedRun => {
    const job = createJob(1, 'failed');
    job.data.autoCoderRun = storedRun as unknown as TestPersonCodingJobData['autoCoderRun'];
    const {
      service, queue, freshness, readiness
    } = createService(job);

    await expect(service.restartJob('17', 1)).resolves.toMatchObject({ success: false });
    expect(queue.addTestPersonCodingJob).not.toHaveBeenCalled();
    expect(queue.deleteTestPersonCodingJob).not.toHaveBeenCalled();
    expect(freshness.assertAutoCodingRunCanStart).not.toHaveBeenCalled();
    expect(readiness.assertAutoCodingCanProcess).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, NaN, Infinity, '9', null])(
    'does not reinterpret an invalid stored revision %p', async storedRevision => {
      const job = createJob(1, 'failed');
      job.data.freshnessSourceRevision = storedRevision as unknown as number;
      const {
        service, queue, freshness, readiness
      } = createService(job);

      await expect(service.restartJob('17', 1)).resolves.toMatchObject({ success: false });
      expect(queue.addTestPersonCodingJob).not.toHaveBeenCalled();
      expect(queue.deleteTestPersonCodingJob).not.toHaveBeenCalled();
      expect(freshness.isRevisionCurrent).not.toHaveBeenCalled();
      expect(readiness.assertAutoCodingCanProcess).not.toHaveBeenCalled();
    }
  );

  it('does not validate or enqueue a job that is not failed', async () => {
    const job = createJob(1, 'active');
    const {
      service, queue, freshness, readiness
    } = createService(job);

    await expect(service.restartJob('17', 1)).resolves.toMatchObject({ success: false });
    expect(queue.addTestPersonCodingJob).not.toHaveBeenCalled();
    expect(queue.deleteTestPersonCodingJob).not.toHaveBeenCalled();
    expect(freshness.assertAutoCodingRunCanStart).not.toHaveBeenCalled();
    expect(readiness.assertAutoCodingCanProcess).not.toHaveBeenCalled();
  });
});
