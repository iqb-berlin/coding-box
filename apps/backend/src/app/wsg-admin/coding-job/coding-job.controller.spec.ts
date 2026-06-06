import { BadRequestException } from '@nestjs/common';
import { WsgCodingJobController } from './coding-job.controller';

jest.mock('../../database/services/coding', () => ({
  CodingJobService: jest.fn(),
  CodingReplayService: jest.fn()
}));

describe('WsgCodingJobController', () => {
  let controller: WsgCodingJobController;
  let codingJobService: {
    getCodingJobs: jest.Mock;
    getCodingJob: jest.Mock;
    getCodingJobUnits: jest.Mock;
    getBulkCodingProgress: jest.Mock;
    createCodingJob: jest.Mock;
    updateCodingJob: jest.Mock;
    saveCodingProgress: jest.Mock;
    saveCodingNotes: jest.Mock;
    assertUserCanAccessCodingJob: jest.Mock;
    assertUserCanCodeCodingJob: jest.Mock;
  };
  let codingReplayService: {
    generateReplayUrlsForItemsBulk: jest.Mock;
  };
  const req = {
    user: { id: 5 },
    protocol: 'http',
    get: jest.fn().mockReturnValue('localhost')
  } as never;

  beforeEach(() => {
    codingJobService = {
      getCodingJobs: jest.fn().mockResolvedValue({
        data: [],
        total: 0,
        totalOpenUnits: 0,
        page: 1,
        limit: undefined
      }),
      getCodingJob: jest.fn().mockResolvedValue({ codingJob: { id: 123 } }),
      getCodingJobUnits: jest.fn().mockResolvedValue([]),
      getBulkCodingProgress: jest.fn().mockResolvedValue({}),
      createCodingJob: jest.fn().mockResolvedValue({ id: 124 }),
      updateCodingJob: jest.fn(),
      saveCodingProgress: jest.fn().mockResolvedValue({ id: 123 }),
      saveCodingNotes: jest.fn().mockResolvedValue({ id: 123 }),
      assertUserCanAccessCodingJob: jest.fn().mockResolvedValue(undefined),
      assertUserCanCodeCodingJob: jest.fn().mockResolvedValue(undefined)
    };
    codingReplayService = {
      generateReplayUrlsForItemsBulk: jest
        .fn()
        .mockResolvedValue([{ replayUrl: 'http://localhost/#/replay/p/u/0/v' }])
    };

    controller = new WsgCodingJobController(
      codingJobService as never,
      codingReplayService as never
    );
  });

  it('passes onlyOpen=true to the coding job service when requested', async () => {
    await controller.getCodingJobUnits(47, 123, req, 'true');

    expect(codingJobService.assertUserCanAccessCodingJob).toHaveBeenCalledWith(
      123,
      47,
      5
    );
    expect(codingJobService.getCodingJob).toHaveBeenCalledWith(123, 47);
    expect(codingJobService.getCodingJobUnits).toHaveBeenCalledWith(123, true);
  });

  it('defaults onlyOpen to false', async () => {
    await controller.getCodingJobUnits(47, 123, req);

    expect(codingJobService.getCodingJobUnits).toHaveBeenCalledWith(123, false);
  });

  it('does not change completed jobs to active when opening them for review', async () => {
    codingJobService.getCodingJob.mockResolvedValue({
      codingJob: { id: 123, status: 'completed' }
    });

    await controller.startCodingJob(47, 123, req);

    expect(codingJobService.assertUserCanCodeCodingJob).toHaveBeenCalledWith(
      123,
      47,
      5
    );
    expect(
      codingJobService.assertUserCanAccessCodingJob
    ).not.toHaveBeenCalled();
    expect(codingJobService.updateCodingJob).not.toHaveBeenCalled();
  });

  it('prepares read-only reviews with management access and without changing job state', async () => {
    codingJobService.getCodingJobUnits.mockResolvedValue([
      {
        unitName: 'UNIT',
        variableId: 'VAR'
      }
    ]);

    await expect(
      controller.prepareCodingJobReview(47, 123, req)
    ).resolves.toEqual({
      total: 1,
      firstReplayUrl: 'http://localhost/#/replay/p/u/0/v'
    });

    expect(codingJobService.assertUserCanAccessCodingJob).toHaveBeenCalledWith(
      123,
      47,
      5
    );
    expect(codingJobService.assertUserCanCodeCodingJob).not.toHaveBeenCalled();
    expect(codingJobService.updateCodingJob).not.toHaveBeenCalled();
    expect(codingJobService.getCodingJobUnits).toHaveBeenCalledWith(123, false);
    expect(
      codingReplayService.generateReplayUrlsForItemsBulk
    ).toHaveBeenCalledWith(
      47,
      [{ unitName: 'UNIT', variableId: 'VAR' }],
      'http://localhost'
    );
  });

  it('uses coding access for saving coding progress', async () => {
    await controller.saveCodingProgress(
      47,
      123,
      {
        testPerson: 'p@c@b',
        unitId: 'u',
        variableId: 'v'
      } as never,
      req
    );

    expect(codingJobService.assertUserCanCodeCodingJob).toHaveBeenCalledWith(
      123,
      47,
      5
    );
    expect(
      codingJobService.assertUserCanAccessCodingJob
    ).not.toHaveBeenCalled();
    expect(codingJobService.saveCodingProgress).toHaveBeenCalled();
  });

  it('uses coding access for saving coding notes', async () => {
    await controller.saveCodingNotes(
      47,
      123,
      {
        testPerson: 'p@c@b',
        unitId: 'u',
        variableId: 'v',
        notes: 'note'
      } as never,
      req
    );

    expect(codingJobService.assertUserCanCodeCodingJob).toHaveBeenCalledWith(
      123,
      47,
      5
    );
    expect(
      codingJobService.assertUserCanAccessCodingJob
    ).not.toHaveBeenCalled();
    expect(codingJobService.saveCodingNotes).toHaveBeenCalled();
  });

  it('rejects jobDefinitionId on direct coding job creates', async () => {
    await expect(
      controller.createCodingJob(47, {
        name: 'Direct job',
        jobDefinitionId: 9
      } as never)
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(codingJobService.createCodingJob).not.toHaveBeenCalled();
  });

  it('rejects direct coding job creates without a request body', async () => {
    await expect(
      controller.createCodingJob(47, undefined as never)
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(codingJobService.createCodingJob).not.toHaveBeenCalled();
  });

  it('rejects bulk progress requests without job IDs', async () => {
    await expect(
      controller.getBulkCodingProgress(47, undefined as never, req)
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(
      codingJobService.assertUserCanAccessCodingJob
    ).not.toHaveBeenCalled();
  });

  it('passes the authenticated user id for assignedTo=me job lists', async () => {
    await controller.getCodingJobs(
      47,
      1,
      undefined,
      'me',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      req
    );

    expect(codingJobService.getCodingJobs).toHaveBeenCalledWith(
      47,
      1,
      undefined,
      5,
      expect.objectContaining({
        includeIssueSummary: false
      })
    );
  });

  it('passes coding job list filters to the service', async () => {
    await controller.getCodingJobs(
      47,
      2,
      25,
      undefined,
      'productive',
      'completed',
      undefined,
      '7',
      'Job 1',
      'updatedAt',
      'asc',
      'none',
      'true',
      req
    );

    expect(codingJobService.getCodingJobs).toHaveBeenCalledWith(
      47,
      2,
      25,
      undefined,
      {
        scope: 'productive',
        status: 'completed',
        excludeStatus: undefined,
        coderId: 7,
        jobName: 'Job 1',
        trainingId: 'none',
        includeIssueSummary: true,
        sortBy: 'updatedAt',
        sortDirection: 'asc'
      }
    );
  });

  it('passes excludeStatus to the service when status is not set', async () => {
    await controller.getCodingJobs(
      47,
      1,
      25,
      undefined,
      undefined,
      undefined,
      'review',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      req
    );

    expect(codingJobService.getCodingJobs).toHaveBeenCalledWith(
      47,
      1,
      25,
      undefined,
      expect.objectContaining({
        status: undefined,
        excludeStatus: 'review'
      })
    );
  });

  it('rejects unsupported assignedTo values', async () => {
    await expect(
      controller.getCodingJobs(
        47,
        1,
        undefined,
        '7',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        req
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(codingJobService.getCodingJobs).not.toHaveBeenCalled();
  });
});
