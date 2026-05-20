import { BadRequestException } from '@nestjs/common';
import { WorkspaceCodingStatisticsController } from './workspace-coding-statistics.controller';

describe('WorkspaceCodingStatisticsController', () => {
  let codingJobService: { createDistributedCodingJobs: jest.Mock };
  let codingReadinessService: { getReadiness: jest.Mock };
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
    codingReadinessService = {
      getReadiness: jest.fn().mockResolvedValue({
        workspaceId: 5,
        autoCoderRun: 1,
        readiness: 'READY',
        blockers: [],
        rawResponsesTotal: 0,
        rawResponsesWithRelevantStatus: 0,
        resultUnitsTotal: 0,
        resultUnitKeysTotal: 0,
        matchedUnitFiles: 0,
        missingUnitFiles: [],
        matchedCodingSchemes: 0,
        missingCodingSchemes: [],
        invalidCodingSchemes: [],
        validVariablePairs: 0,
        validResponses: 0,
        codeableResponses: 0,
        invalidVariableSamples: []
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
      codingReadinessService as never,
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

  it('delegates autocoding readiness requests with parsed options', async () => {
    await controller.getAutocodingReadiness(5, '2', 'true');

    expect(codingReadinessService.getReadiness).toHaveBeenCalledWith(5, {
      autoCoderRun: 2,
      forceRefresh: true
    });
  });
});
