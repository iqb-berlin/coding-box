import { BadRequestException } from '@nestjs/common';
import { WsgCodingJobController } from './coding-job.controller';

jest.mock('../../database/services/coding', () => ({
  CodingJobService: jest.fn(),
  CodingReplayService: jest.fn()
}));

describe('WsgCodingJobController', () => {
  let controller: WsgCodingJobController;
  let codingJobService: {
    getCodingJob: jest.Mock;
    getCodingJobUnits: jest.Mock;
    createCodingJob: jest.Mock;
    updateCodingJob: jest.Mock;
    assertUserCanAccessCodingJob: jest.Mock;
  };
  const req = { user: { id: 5 }, protocol: 'http', get: jest.fn().mockReturnValue('localhost') } as never;

  beforeEach(() => {
    codingJobService = {
      getCodingJob: jest.fn().mockResolvedValue({ codingJob: { id: 123 } }),
      getCodingJobUnits: jest.fn().mockResolvedValue([]),
      createCodingJob: jest.fn().mockResolvedValue({ id: 124 }),
      updateCodingJob: jest.fn(),
      assertUserCanAccessCodingJob: jest.fn().mockResolvedValue(undefined)
    };

    controller = new WsgCodingJobController(
      codingJobService as never,
      {} as never
    );
  });

  it('passes onlyOpen=true to the coding job service when requested', async () => {
    await controller.getCodingJobUnits(47, 123, req, 'true');

    expect(codingJobService.assertUserCanAccessCodingJob).toHaveBeenCalledWith(123, 47, 5);
    expect(codingJobService.getCodingJob).toHaveBeenCalledWith(123, 47);
    expect(codingJobService.getCodingJobUnits).toHaveBeenCalledWith(123, true);
  });

  it('defaults onlyOpen to false', async () => {
    await controller.getCodingJobUnits(47, 123, req);

    expect(codingJobService.getCodingJobUnits).toHaveBeenCalledWith(123, false);
  });

  it('does not change completed jobs to active when opening them for review', async () => {
    codingJobService.getCodingJob.mockResolvedValue({ codingJob: { id: 123, status: 'completed' } });

    await controller.startCodingJob(47, 123, req);

    expect(codingJobService.updateCodingJob).not.toHaveBeenCalled();
  });

  it('rejects jobDefinitionId on direct coding job creates', async () => {
    await expect(controller.createCodingJob(47, {
      name: 'Direct job',
      jobDefinitionId: 9
    } as never)).rejects.toBeInstanceOf(BadRequestException);

    expect(codingJobService.createCodingJob).not.toHaveBeenCalled();
  });

  it('rejects direct coding job creates without a request body', async () => {
    await expect(controller.createCodingJob(47, undefined as never))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(codingJobService.createCodingJob).not.toHaveBeenCalled();
  });

  it('rejects bulk progress requests without job IDs', async () => {
    await expect(controller.getBulkCodingProgress(47, undefined as never, req))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(codingJobService.assertUserCanAccessCodingJob).not.toHaveBeenCalled();
  });
});
