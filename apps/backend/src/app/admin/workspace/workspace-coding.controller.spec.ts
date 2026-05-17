import { BadRequestException } from '@nestjs/common';
import { WorkspaceCodingController } from './workspace-coding.controller';

describe('WorkspaceCodingController', () => {
  const codingProcessService = {
    codeTestPersons: jest.fn().mockResolvedValue({ totalResponses: 0, statusCounts: {} })
  };
  const codingFreshnessService = {
    assertAutoCodingRunCanStart: jest.fn().mockResolvedValue(undefined)
  };
  const jobQueueService = {
    assertNoDependencyConflicts: jest.fn().mockResolvedValue(undefined)
  };

  const createController = () => new WorkspaceCodingController(
    codingProcessService as never,
    {} as never,
    {} as never,
    {} as never,
    codingFreshnessService as never,
    jobQueueService as never
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects unsupported autocoder run values before queue checks', async () => {
    const controller = createController();

    await expect(controller.codeTestPersons('1,2', 7, '3'))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(jobQueueService.assertNoDependencyConflicts).not.toHaveBeenCalled();
    expect(codingFreshnessService.assertAutoCodingRunCanStart).not.toHaveBeenCalled();
    expect(codingProcessService.codeTestPersons).not.toHaveBeenCalled();
  });

  it('defaults missing autocoder run to the first run', async () => {
    const controller = createController();

    await controller.codeTestPersons('1,2', 7, undefined as unknown as string);

    expect(codingFreshnessService.assertAutoCodingRunCanStart)
      .toHaveBeenCalledWith(7, 1);
    expect(codingProcessService.codeTestPersons).toHaveBeenCalledWith(7, '1,2', 1);
  });

  it('accepts a single autocoder run query value from an array', async () => {
    const controller = createController();

    await controller.codeTestPersons('1,2', 7, ['2']);

    expect(codingFreshnessService.assertAutoCodingRunCanStart)
      .toHaveBeenCalledWith(7, 2);
    expect(codingProcessService.codeTestPersons).toHaveBeenCalledWith(7, '1,2', 2);
  });

  it('rejects repeated autocoder run query values before queue checks', async () => {
    const controller = createController();

    await expect(controller.codeTestPersons('1,2', 7, ['1', '2']))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(jobQueueService.assertNoDependencyConflicts).not.toHaveBeenCalled();
    expect(codingFreshnessService.assertAutoCodingRunCanStart).not.toHaveBeenCalled();
    expect(codingProcessService.codeTestPersons).not.toHaveBeenCalled();
  });
});
