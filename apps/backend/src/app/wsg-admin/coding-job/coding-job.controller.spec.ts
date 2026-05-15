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
  };

  beforeEach(() => {
    codingJobService = {
      getCodingJob: jest.fn().mockResolvedValue({ codingJob: { id: 123 } }),
      getCodingJobUnits: jest.fn().mockResolvedValue([])
    };

    controller = new WsgCodingJobController(
      codingJobService as never,
      {} as never
    );
  });

  it('passes onlyOpen=true to the coding job service when requested', async () => {
    await controller.getCodingJobUnits(47, 123, 'true');

    expect(codingJobService.getCodingJob).toHaveBeenCalledWith(123, 47);
    expect(codingJobService.getCodingJobUnits).toHaveBeenCalledWith(123, true);
  });

  it('defaults onlyOpen to false', async () => {
    await controller.getCodingJobUnits(47, 123);

    expect(codingJobService.getCodingJobUnits).toHaveBeenCalledWith(123, false);
  });
});
