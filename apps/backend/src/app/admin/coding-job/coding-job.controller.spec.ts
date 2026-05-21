import { BadRequestException } from '@nestjs/common';
import { CodingJobController } from './coding-job.controller';

describe('CodingJobController', () => {
  let controller: CodingJobController;
  let codingJobService: { createCodingJob: jest.Mock };

  beforeEach(() => {
    codingJobService = {
      createCodingJob: jest.fn().mockResolvedValue({ id: 124 })
    };

    controller = new CodingJobController(codingJobService as never);
  });

  it('rejects jobDefinitionId on direct admin coding job creates', async () => {
    await expect(controller.createCodingJob(47, {
      name: 'Direct job',
      jobDefinitionId: 9
    } as never)).rejects.toBeInstanceOf(BadRequestException);

    expect(codingJobService.createCodingJob).not.toHaveBeenCalled();
  });

  it('rejects direct admin coding job creates without a request body', async () => {
    await expect(controller.createCodingJob(47, undefined as never))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(codingJobService.createCodingJob).not.toHaveBeenCalled();
  });
});
