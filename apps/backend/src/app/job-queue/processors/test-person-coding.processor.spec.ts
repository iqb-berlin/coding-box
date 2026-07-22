import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { WorkspaceCodingService } from '../../database/services/workspace';
import { TestPersonCodingJobData } from '../job-queue.service';
import { TestPersonCodingProcessor } from './test-person-coding.processor';
import { AutocoderPersistenceTargetCollisionError } from '../../database/services/coding/autocoder-persistence-target-collision.error';

describe('TestPersonCodingProcessor', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const createJob = (
    getLatestJob: jest.Mock<Promise<{ data?: Partial<TestPersonCodingJobData> } | null>, []>
  ): Job<TestPersonCodingJobData> => ({
    id: 'job-1',
    data: {
      workspaceId: 1,
      personIds: Array.from({ length: 100 }, (_, index) => `person-${index + 1}`)
    },
    getState: jest.fn().mockResolvedValue('active'),
    progress: jest.fn().mockResolvedValue(undefined),
    queue: {
      getJob: getLatestJob
    }
  } as unknown as Job<TestPersonCodingJobData>);

  it('stops before the next batch when an active job was marked as paused in Bull', async () => {
    const workspaceCodingService = {
      processTestPersonsBatch: jest.fn().mockResolvedValue({
        totalResponses: 5,
        statusCounts: { CODED: 5 }
      })
    };
    const getLatestJob = jest.fn()
      .mockResolvedValueOnce({
        data: { isPaused: false }
      })
      .mockResolvedValueOnce({
        data: { isPaused: true }
      });
    const processor = new TestPersonCodingProcessor(
      workspaceCodingService as unknown as WorkspaceCodingService
    );

    const result = await processor.process(createJob(getLatestJob));

    expect(workspaceCodingService.processTestPersonsBatch).toHaveBeenCalledTimes(1);
    expect(workspaceCodingService.processTestPersonsBatch).toHaveBeenCalledWith(
      1,
      expect.arrayContaining(['person-1', 'person-50']),
      1,
      expect.any(Function),
      'job-1',
      undefined,
      undefined
    );
    expect(getLatestJob).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      totalResponses: 5,
      statusCounts: { CODED: 5 }
    });
  });

  it('continues processing when refreshing the latest job data fails', async () => {
    const workspaceCodingService = {
      processTestPersonsBatch: jest.fn().mockResolvedValue({
        totalResponses: 5,
        statusCounts: { CODED: 5 }
      })
    };
    const getLatestJob = jest.fn()
      .mockRejectedValueOnce(new Error('Redis unavailable'))
      .mockResolvedValue({
        data: { isPaused: false }
      });
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const processor = new TestPersonCodingProcessor(
      workspaceCodingService as unknown as WorkspaceCodingService
    );

    const result = await processor.process(createJob(getLatestJob));

    expect(workspaceCodingService.processTestPersonsBatch).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Redis unavailable')
    );
    expect(result).toEqual({
      totalResponses: 10,
      statusCounts: { CODED: 10 }
    });
  });

  it('fails collision jobs without reporting 100 percent or success', async () => {
    const collisionError = new AutocoderPersistenceTargetCollisionError(
      'response:10',
      0,
      1
    );
    const workspaceCodingService = {
      processTestPersonsBatch: jest.fn().mockRejectedValue(collisionError)
    };
    const getLatestJob = jest.fn().mockResolvedValue({
      data: { isPaused: false }
    });
    const job = createJob(getLatestJob);
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const processor = new TestPersonCodingProcessor(
      workspaceCodingService as unknown as WorkspaceCodingService
    );

    await expect(processor.process(job)).rejects.toBe(collisionError);

    expect(job.progress).toHaveBeenCalledWith(0);
    expect(job.progress).not.toHaveBeenCalledWith(100);
    expect(logSpy).not.toHaveBeenCalledWith(
      `Job ${job.id} completed successfully`
    );
  });
});
