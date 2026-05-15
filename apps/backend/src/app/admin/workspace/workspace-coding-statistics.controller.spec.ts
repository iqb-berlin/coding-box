import { BadRequestException } from '@nestjs/common';
import { WorkspaceCodingStatisticsController } from './workspace-coding-statistics.controller';

describe('WorkspaceCodingStatisticsController', () => {
  let codingJobService: { createDistributedCodingJobs: jest.Mock };
  let controller: WorkspaceCodingStatisticsController;

  beforeEach(() => {
    codingJobService = {
      createDistributedCodingJobs: jest.fn().mockResolvedValue({
        success: true,
        jobsCreated: 0,
        message: 'ok',
        distribution: {},
        doubleCodingInfo: {},
        jobs: []
      })
    };

    controller = new WorkspaceCodingStatisticsController(
      {} as never,
      codingJobService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
  });

  it('rejects job definition ids on the generic distributed job endpoint', async () => {
    await expect(controller.createDistributedCodingJobs(5, {
      selectedVariables: [],
      selectedCoders: [],
      jobDefinitionId: 42
    } as never)).rejects.toBeInstanceOf(BadRequestException);

    expect(codingJobService.createDistributedCodingJobs).not.toHaveBeenCalled();
  });

  it('rejects generic distributed job requests without a request body', async () => {
    await expect(controller.createDistributedCodingJobs(5, undefined as never))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(codingJobService.createDistributedCodingJobs).not.toHaveBeenCalled();
  });

  it('delegates generic distributed job requests without job definition ids', async () => {
    const body = {
      selectedVariables: [{ unitName: 'UNIT', variableId: 'VAR' }],
      selectedCoders: [{ id: 1, name: 'Coder', username: 'coder' }]
    };

    await controller.createDistributedCodingJobs(5, body);

    expect(codingJobService.createDistributedCodingJobs).toHaveBeenCalledWith(5, body);
  });
});
