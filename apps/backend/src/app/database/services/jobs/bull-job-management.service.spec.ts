import { Job } from 'bull';
import {
  JobQueueService,
  TestPersonCodingJobData
} from '../../../job-queue/job-queue.service';
import { BullJobManagementService } from './bull-job-management.service';

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
      getTestPersonCodingJob: jest.fn().mockResolvedValue(job),
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
});
