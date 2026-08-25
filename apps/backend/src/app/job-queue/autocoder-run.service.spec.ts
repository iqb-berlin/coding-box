import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { CodingProcessService } from '../database/services/coding/coding-process.service';
import { WorkspaceCodingService } from '../database/services/workspace';
import { AutocoderRunService } from './autocoder-run.service';
import { TestPersonCodingJobData } from './job-queue.service';

describe('AutocoderRunService', () => {
  afterEach(() => jest.restoreAllMocks());

  const createPlan = (batch: number) => ({
    workspaceId: 1,
    codedResponses: [{ id: batch }],
    statistics: { totalResponses: 5, statusCounts: { CODED: 5 } },
    unitIds: [batch],
    autoCoderRun: 1 as const
  });

  const createJob = (): Job<TestPersonCodingJobData> => ({
    id: 'job-1',
    data: {
      workspaceId: 1,
      personIds: Array.from({ length: 100 }, (_, index) => String(index + 1)),
      autoCoderRun: 1
    },
    getState: jest.fn().mockResolvedValue('active'),
    progress: jest.fn().mockResolvedValue(undefined),
    queue: {
      getJob: jest.fn().mockResolvedValue({ data: { isPaused: false } })
    }
  }) as unknown as Job<TestPersonCodingJobData>;

  const createServices = () => {
    const preflightManager = { getRepository: jest.fn() };
    const queryRunner = {
      manager: preflightManager,
      isTransactionActive: false,
      isReleased: false,
      commitTransaction: jest.fn().mockImplementation(async () => {
        queryRunner.isTransactionActive = false;
      }),
      rollbackTransaction: jest.fn().mockImplementation(async () => {
        queryRunner.isTransactionActive = false;
      }),
      startTransaction: jest.fn().mockImplementation(async () => {
        queryRunner.isTransactionActive = true;
      })
    };
    let nextPlan = 0;
    const codingProcessService = {
      beginAutocoderPersistenceSession: jest
        .fn()
        .mockResolvedValue(queryRunner),
      prepareAutocoderPreflight: jest.fn(),
      createAutocoderPreflightContext: jest.fn().mockReturnValue({
        codingSchemeValidations: new Map()
      }),
      prepareAutocoderBatch: jest
        .fn()
        .mockImplementation(async () => {
          nextPlan += 1;
          return createPlan(nextPlan);
        }),
      persistAutocoderBatchPlan: jest.fn().mockResolvedValue(true),
      releaseAutocoderPersistenceSession: jest
        .fn()
        .mockImplementation(async () => {
          queryRunner.isReleased = true;
        })
    };
    const workspaceCodingService = {
      finalizeAutocoderPersistence: jest.fn().mockResolvedValue(undefined)
    };
    const service = new AutocoderRunService(
      codingProcessService as unknown as CodingProcessService,
      workspaceCodingService as unknown as WorkspaceCodingService
    );
    return {
      service,
      queryRunner,
      preflightManager,
      codingProcessService,
      workspaceCodingService
    };
  };

  it('preflights every batch before persisting the in-memory plans', async () => {
    const {
      service,
      codingProcessService,
      queryRunner,
      preflightManager
    } = createServices();

    await expect(service.run(createJob())).resolves.toEqual({
      totalResponses: 10,
      statusCounts: { CODED: 10 }
    });

    expect(codingProcessService.prepareAutocoderBatch).toHaveBeenCalledTimes(
      2
    );
    expect(
      codingProcessService.persistAutocoderBatchPlan
    ).toHaveBeenCalledTimes(2);
    expect(
      codingProcessService.prepareAutocoderBatch.mock.invocationCallOrder[1]
    ).toBeLessThan(
      codingProcessService.persistAutocoderBatchPlan.mock.invocationCallOrder[0]
    );
    expect(
      codingProcessService.persistAutocoderBatchPlan.mock.calls[0][0]
    ).toEqual(createPlan(1));
    expect(
      codingProcessService.prepareAutocoderBatch.mock.calls[0][8]
    ).toBe(250_000);
    expect(
      codingProcessService.prepareAutocoderBatch.mock.calls[1][8]
    ).toBe(249_999);
    expect(
      codingProcessService.prepareAutocoderBatch.mock.calls[0][9]
    ).toBe(preflightManager);
    expect(
      codingProcessService.prepareAutocoderBatch.mock.calls[1][9]
    ).toBe(preflightManager);
    expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not persist when a later preflight fails', async () => {
    const collision = new Error('duplicate persistence target');
    const { service, codingProcessService, queryRunner } = createServices();
    codingProcessService.prepareAutocoderBatch
      .mockResolvedValueOnce(createPlan(1))
      .mockRejectedValueOnce(collision);

    await expect(service.run(createJob())).rejects.toBe(collision);
    expect(
      codingProcessService.persistAutocoderBatchPlan
    ).not.toHaveBeenCalled();
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
  });

  it('rolls back all plans when a later persistence fails', async () => {
    const databaseError = new Error('database failed in batch 2');
    const { service, codingProcessService, queryRunner } = createServices();
    codingProcessService.persistAutocoderBatchPlan
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(databaseError);

    await expect(service.run(createJob())).rejects.toBe(databaseError);
    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
  });

  it('rejects a preflight that exceeds the in-memory plan limit', async () => {
    const { service, codingProcessService, queryRunner } = createServices();
    const oversizedPlan = createPlan(1);
    oversizedPlan.codedResponses = new Array(250_001) as { id: number }[];
    codingProcessService.prepareAutocoderBatch.mockResolvedValueOnce(
      oversizedPlan
    );

    await expect(service.run(createJob())).rejects.toThrow(
      'exceeding the safe in-memory limit of 250000'
    );
    expect(codingProcessService.persistAutocoderBatchPlan).not.toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
  });

  it('retries cache finalization without retrying committed writes', async () => {
    const {
      service,
      codingProcessService,
      workspaceCodingService,
      queryRunner
    } = createServices();
    workspaceCodingService.finalizeAutocoderPersistence.mockRejectedValueOnce(
      new Error('cache unavailable')
    );
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await expect(service.run(createJob())).resolves.toEqual({
      totalResponses: 10,
      statusCounts: { CODED: 10 }
    });
    expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(
      codingProcessService.persistAutocoderBatchPlan
    ).toHaveBeenCalledTimes(2);
    expect(
      workspaceCodingService.finalizeAutocoderPersistence
    ).toHaveBeenCalledTimes(2);
  });

  it('keeps a committed job successful if finalization remains unavailable', async () => {
    const { service, workspaceCodingService, queryRunner } = createServices();
    workspaceCodingService.finalizeAutocoderPersistence.mockRejectedValue(
      new Error('cache unavailable')
    );
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    await expect(service.run(createJob())).resolves.toEqual({
      totalResponses: 10,
      statusCounts: { CODED: 10 },
      warnings: [
        'Autocoder cache finalization remained incomplete after 3 attempts: cache unavailable'
      ]
    });
    expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(
      workspaceCodingService.finalizeAutocoderPersistence
    ).toHaveBeenCalledTimes(3);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('finalization failed after 3 attempts'),
      expect.any(String)
    );
  });

  it('validates the run before opening a persistence session', async () => {
    const { service, codingProcessService } = createServices();
    const job = createJob();
    (job.data as { autoCoderRun?: number }).autoCoderRun = 3;

    await expect(service.run(job)).rejects.toThrow(
      'autoCoderRun must be 1 or 2'
    );
    expect(
      codingProcessService.beginAutocoderPersistenceSession
    ).not.toHaveBeenCalled();
  });
});
