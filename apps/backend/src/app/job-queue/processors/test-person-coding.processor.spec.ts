import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { WorkspaceCodingService } from '../../database/services/workspace';
import { TestPersonCodingJobData } from '../job-queue.service';
import { TestPersonCodingProcessor } from './test-person-coding.processor';

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
      personIds: Array.from({ length: 100 }, (_, index) => String(index + 1)),
      autoCoderRun: 1
    },
    getState: jest.fn().mockResolvedValue('active'),
    progress: jest.fn().mockResolvedValue(undefined),
    queue: {
      getJob: getLatestJob
    }
  } as unknown as Job<TestPersonCodingJobData>);

  const createPlan = (batch: number) => ({
    workspaceId: 1,
    codedResponses: [{ id: batch }],
    statistics: {
      totalResponses: 5,
      statusCounts: { CODED: 5 }
    },
    unitIds: [batch],
    autoCoderRun: 1 as const
  });

  const createWorkspaceCodingService = () => {
    const queryRunner = {
      isTransactionActive: false,
      isReleased: false
    };
    const preflightContext = {
      codingSchemeValidations: new Map(),
      fileRevision: 'files-v1'
    };
    let nextPlan = 0;
    return {
      queryRunner,
      preflightContext,
      prepareAutocoderPreflight: jest.fn().mockResolvedValue('files-v1'),
      assertAutocoderFileRevision: jest.fn().mockResolvedValue(undefined),
      assertAutocoderFileRevisionForCommit: jest.fn().mockResolvedValue(undefined),
      createAutocoderPreflightContext: jest.fn().mockReturnValue(preflightContext),
      beginAutocoderPersistenceSession: jest.fn().mockResolvedValue(queryRunner),
      startAutocoderPersistenceTransaction: jest.fn().mockImplementation(async () => {
        queryRunner.isTransactionActive = true;
      }),
      preflightTestPersonsBatch: jest.fn().mockImplementation(async () => {
        nextPlan += 1;
        const plan = createPlan(nextPlan);
        return { statistics: plan.statistics, plan };
      }),
      persistAutocoderBatchPlan: jest.fn().mockResolvedValue(true),
      scheduleAutocoderFinalization: jest.fn().mockResolvedValue(17),
      commitAutocoderPersistenceTransaction: jest.fn().mockImplementation(async () => {
        queryRunner.isTransactionActive = false;
      }),
      rollbackAutocoderPersistenceTransaction: jest.fn().mockImplementation(async () => {
        queryRunner.isTransactionActive = false;
      }),
      releaseAutocoderPersistenceSession: jest.fn().mockImplementation(async () => {
        queryRunner.isReleased = true;
      }),
      finalizeAutocoderPersistence: jest.fn().mockResolvedValue(undefined),
      completeAutocoderFinalization: jest.fn().mockResolvedValue(undefined),
      recordAutocoderFinalizationFailure: jest.fn().mockResolvedValue(undefined),
      recoverPendingAutocoderFinalizations: jest.fn().mockResolvedValue(0)
    };
  };

  it('rolls back when an active job is marked as paused during preflight', async () => {
    const workspaceCodingService = createWorkspaceCodingService();
    const getLatestJob = jest.fn()
      .mockResolvedValueOnce({ data: { isPaused: false } })
      .mockResolvedValueOnce({ data: { isPaused: false } })
      .mockResolvedValueOnce({ data: { isPaused: false } })
      .mockResolvedValueOnce({ data: { isPaused: true } });
    const processor = new TestPersonCodingProcessor(
      workspaceCodingService as unknown as WorkspaceCodingService
    );

    const result = await processor.process(createJob(getLatestJob));

    expect(workspaceCodingService.preflightTestPersonsBatch)
      .toHaveBeenCalledTimes(2);
    expect(workspaceCodingService.createAutocoderPreflightContext)
      .toHaveBeenCalledWith('files-v1');
    expect(
      workspaceCodingService.prepareAutocoderPreflight.mock.invocationCallOrder[0]
    ).toBeLessThan(
      workspaceCodingService.createAutocoderPreflightContext.mock
        .invocationCallOrder[0]
    );
    expect(workspaceCodingService.preflightTestPersonsBatch.mock.calls[0][7])
      .toBe(workspaceCodingService.preflightContext);
    expect(workspaceCodingService.preflightTestPersonsBatch.mock.calls[1][7])
      .toBe(workspaceCodingService.preflightContext);
    expect(workspaceCodingService.persistAutocoderBatchPlan)
      .not.toHaveBeenCalled();
    expect(workspaceCodingService.rollbackAutocoderPersistenceTransaction)
      .toHaveBeenCalledWith(workspaceCodingService.queryRunner);
    expect(workspaceCodingService.commitAutocoderPersistenceTransaction)
      .not.toHaveBeenCalled();
    expect(workspaceCodingService.startAutocoderPersistenceTransaction)
      .not.toHaveBeenCalled();
    expect(result).toEqual({ totalResponses: 0, statusCounts: {} });
  });

  it('continues processing when refreshing the latest job data fails', async () => {
    const workspaceCodingService = createWorkspaceCodingService();
    const getLatestJob = jest.fn()
      .mockRejectedValueOnce(new Error('Redis unavailable'))
      .mockResolvedValue({ data: { isPaused: false } });
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const processor = new TestPersonCodingProcessor(
      workspaceCodingService as unknown as WorkspaceCodingService
    );

    const result = await processor.process(createJob(getLatestJob));

    expect(workspaceCodingService.preflightTestPersonsBatch)
      .toHaveBeenCalledTimes(2);
    expect(workspaceCodingService.persistAutocoderBatchPlan)
      .toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Redis unavailable')
    );
    expect(result).toEqual({
      totalResponses: 10,
      statusCounts: { CODED: 10 }
    });
  });

  it('preflights every batch before persisting the captured plans', async () => {
    const workspaceCodingService = createWorkspaceCodingService();
    const processor = new TestPersonCodingProcessor(
      workspaceCodingService as unknown as WorkspaceCodingService
    );

    await processor.process(createJob(jest.fn().mockResolvedValue({
      data: { isPaused: false }
    })));

    expect(workspaceCodingService.preflightTestPersonsBatch)
      .toHaveBeenCalledTimes(2);
    expect(workspaceCodingService.persistAutocoderBatchPlan)
      .toHaveBeenCalledTimes(2);
    expect(
      workspaceCodingService.preflightTestPersonsBatch.mock
        .invocationCallOrder[1]
    ).toBeLessThan(
      workspaceCodingService.persistAutocoderBatchPlan.mock
        .invocationCallOrder[0]
    );
    expect(workspaceCodingService.persistAutocoderBatchPlan.mock.calls[0][0])
      .toEqual(createPlan(1));
    expect(
      workspaceCodingService.startAutocoderPersistenceTransaction.mock
        .invocationCallOrder[0]
    ).toBeGreaterThan(
      workspaceCodingService.preflightTestPersonsBatch.mock
        .invocationCallOrder[1]
    );
    expect(workspaceCodingService.commitAutocoderPersistenceTransaction)
      .toHaveBeenCalledTimes(1);
  });

  it('does not persist any plan when a later preflight finds a collision', async () => {
    const collision = new Error(
      'Autocoder produced multiple updates for response:6235425'
    );
    const workspaceCodingService = createWorkspaceCodingService();
    workspaceCodingService.preflightTestPersonsBatch
      .mockResolvedValueOnce({
        statistics: createPlan(1).statistics,
        plan: createPlan(1)
      })
      .mockRejectedValueOnce(collision);
    const processor = new TestPersonCodingProcessor(
      workspaceCodingService as unknown as WorkspaceCodingService
    );

    await expect(processor.process(createJob(jest.fn().mockResolvedValue({
      data: { isPaused: false }
    })))).rejects.toBe(collision);

    expect(workspaceCodingService.persistAutocoderBatchPlan)
      .not.toHaveBeenCalled();
    expect(workspaceCodingService.startAutocoderPersistenceTransaction)
      .not.toHaveBeenCalled();
    expect(workspaceCodingService.rollbackAutocoderPersistenceTransaction)
      .toHaveBeenCalledTimes(1);
  });

  it('rolls back every plan when test files change before commit', async () => {
    const fileChange = new Error(
      'Test files changed during autocoder preflight for workspace 1'
    );
    const workspaceCodingService = createWorkspaceCodingService();
    workspaceCodingService.assertAutocoderFileRevisionForCommit
      .mockRejectedValueOnce(fileChange);
    const processor = new TestPersonCodingProcessor(
      workspaceCodingService as unknown as WorkspaceCodingService
    );

    await expect(processor.process(createJob(jest.fn().mockResolvedValue({
      data: { isPaused: false }
    })))).rejects.toBe(fileChange);

    expect(workspaceCodingService.persistAutocoderBatchPlan)
      .toHaveBeenCalledTimes(2);
    expect(workspaceCodingService.scheduleAutocoderFinalization)
      .not.toHaveBeenCalled();
    expect(workspaceCodingService.commitAutocoderPersistenceTransaction)
      .not.toHaveBeenCalled();
    expect(workspaceCodingService.rollbackAutocoderPersistenceTransaction)
      .toHaveBeenCalledTimes(1);
  });

  it('deduplicates person IDs before creating batches', async () => {
    const workspaceCodingService = createWorkspaceCodingService();
    const processor = new TestPersonCodingProcessor(
      workspaceCodingService as unknown as WorkspaceCodingService
    );
    const job = createJob(jest.fn().mockResolvedValue({
      data: { isPaused: false }
    }));
    job.data.personIds = [
      ...Array.from({ length: 50 }, (_, index) => String(index + 1)),
      '01'
    ];

    await processor.process(job);

    expect(workspaceCodingService.preflightTestPersonsBatch)
      .toHaveBeenCalledTimes(1);
    expect(workspaceCodingService.preflightTestPersonsBatch.mock.calls[0][1])
      .toEqual(Array.from({ length: 50 }, (_, index) => String(index + 1)));
  });

  it('retries only finalization after a transient post-commit failure', async () => {
    const workspaceCodingService = createWorkspaceCodingService();
    workspaceCodingService.finalizeAutocoderPersistence
      .mockRejectedValueOnce(new Error('cache unavailable'));
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const processor = new TestPersonCodingProcessor(
      workspaceCodingService as unknown as WorkspaceCodingService
    );

    await expect(processor.process(createJob(jest.fn().mockResolvedValue({
      data: { isPaused: false }
    })))).resolves.toEqual({
      totalResponses: 10,
      statusCounts: { CODED: 10 }
    });

    expect(workspaceCodingService.commitAutocoderPersistenceTransaction)
      .toHaveBeenCalledTimes(1);
    expect(workspaceCodingService.finalizeAutocoderPersistence)
      .toHaveBeenCalledTimes(2);
    expect(workspaceCodingService.completeAutocoderFinalization)
      .toHaveBeenCalledWith(17);
    expect(workspaceCodingService.recordAutocoderFinalizationFailure)
      .not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Retrying cache finalization only')
    );
  });

  it('keeps a committed job successful after finalization retries are exhausted', async () => {
    const workspaceCodingService = createWorkspaceCodingService();
    workspaceCodingService.finalizeAutocoderPersistence
      .mockRejectedValue(new Error('cache unavailable'));
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const processor = new TestPersonCodingProcessor(
      workspaceCodingService as unknown as WorkspaceCodingService
    );

    await expect(processor.process(createJob(jest.fn().mockResolvedValue({
      data: { isPaused: false }
    })))).resolves.toEqual({
      totalResponses: 10,
      statusCounts: { CODED: 10 }
    });

    expect(workspaceCodingService.commitAutocoderPersistenceTransaction)
      .toHaveBeenCalledTimes(1);
    expect(workspaceCodingService.finalizeAutocoderPersistence)
      .toHaveBeenCalledTimes(3);
    expect(workspaceCodingService.completeAutocoderFinalization)
      .not.toHaveBeenCalled();
    expect(workspaceCodingService.recordAutocoderFinalizationFailure)
      .toHaveBeenCalledWith(17, expect.any(Error));
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('finalization failed after 3 attempts'),
      expect.any(String)
    );
  });

  it('keeps a committed job successful when final progress reporting fails', async () => {
    const workspaceCodingService = createWorkspaceCodingService();
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const processor = new TestPersonCodingProcessor(
      workspaceCodingService as unknown as WorkspaceCodingService
    );
    const job = createJob(jest.fn().mockResolvedValue({
      data: { isPaused: false }
    }));
    (job.progress as jest.Mock).mockImplementation(async (progress: number) => {
      if (progress === 100) throw new Error('Redis unavailable');
    });

    await expect(processor.process(job)).resolves.toEqual({
      totalResponses: 10,
      statusCounts: { CODED: 10 }
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('progress could not be set to 100')
    );
  });

  it('rolls back the first persisted batch when a later persistence fails', async () => {
    const databaseError = new Error('database failed in batch 2');
    const workspaceCodingService = createWorkspaceCodingService();
    workspaceCodingService.persistAutocoderBatchPlan
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(databaseError);
    const processor = new TestPersonCodingProcessor(
      workspaceCodingService as unknown as WorkspaceCodingService
    );

    await expect(processor.process(createJob(jest.fn().mockResolvedValue({
      data: { isPaused: false }
    })))).rejects.toBe(databaseError);

    expect(workspaceCodingService.persistAutocoderBatchPlan)
      .toHaveBeenCalledTimes(2);
    expect(workspaceCodingService.rollbackAutocoderPersistenceTransaction)
      .toHaveBeenCalledTimes(1);
    expect(workspaceCodingService.commitAutocoderPersistenceTransaction)
      .not.toHaveBeenCalled();
  });

  it('returns no processed responses when a pause rolls back persisted plans', async () => {
    const workspaceCodingService = createWorkspaceCodingService();
    const getLatestJob = jest.fn()
      .mockResolvedValueOnce({ data: { isPaused: false } })
      .mockResolvedValueOnce({ data: { isPaused: false } })
      .mockResolvedValueOnce({ data: { isPaused: false } })
      .mockResolvedValueOnce({ data: { isPaused: false } })
      .mockResolvedValueOnce({ data: { isPaused: false } })
      .mockResolvedValueOnce({ data: { isPaused: true } });
    const processor = new TestPersonCodingProcessor(
      workspaceCodingService as unknown as WorkspaceCodingService
    );

    await expect(processor.process(createJob(getLatestJob))).resolves.toEqual({
      totalResponses: 0,
      statusCounts: {}
    });

    expect(workspaceCodingService.persistAutocoderBatchPlan)
      .toHaveBeenCalledTimes(1);
    expect(workspaceCodingService.rollbackAutocoderPersistenceTransaction)
      .toHaveBeenCalledTimes(1);
    expect(workspaceCodingService.commitAutocoderPersistenceTransaction)
      .not.toHaveBeenCalled();
  });

  it.each([undefined, 3])(
    'fails before processing when autoCoderRun is %s',
    async autoCoderRun => {
      const workspaceCodingService = createWorkspaceCodingService();
      const job = createJob(jest.fn());
      (job.data as { autoCoderRun?: number }).autoCoderRun = autoCoderRun;
      const processor = new TestPersonCodingProcessor(
        workspaceCodingService as unknown as WorkspaceCodingService
      );

      await expect(processor.process(job)).rejects.toThrow(
        'autoCoderRun must be 1 or 2'
      );

      expect(workspaceCodingService.beginAutocoderPersistenceSession)
        .not.toHaveBeenCalled();
      expect(workspaceCodingService.preflightTestPersonsBatch)
        .not.toHaveBeenCalled();
      expect(job.progress).not.toHaveBeenCalled();
    }
  );
});
