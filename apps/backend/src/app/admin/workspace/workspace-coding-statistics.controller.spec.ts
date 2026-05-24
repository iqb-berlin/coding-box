import { BadRequestException } from '@nestjs/common';
import { WorkspaceCodingStatisticsController } from './workspace-coding-statistics.controller';

describe('WorkspaceCodingStatisticsController', () => {
  let codingStatisticsService: { calculateCohensKappa: jest.Mock };
  let codingJobService: { createDistributedCodingJobs: jest.Mock };
  let codingReviewService: { getDoubleCodedVariablesForReview: jest.Mock };
  let codingReadinessService: { getReadiness: jest.Mock };
  let controller: WorkspaceCodingStatisticsController;

  beforeEach(() => {
    codingStatisticsService = {
      calculateCohensKappa: jest.fn()
    };
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
    codingReviewService = {
      getDoubleCodedVariablesForReview: jest.fn()
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
      codingStatisticsService as never,
      codingJobService as never,
      {} as never,
      {} as never,
      codingReviewService as never,
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

  it('adds weighted mean kappa per variable to detailed kappa statistics', async () => {
    codingReviewService.getDoubleCodedVariablesForReview.mockResolvedValue({
      total: 1,
      data: [{
        unitName: 'UNIT',
        variableId: 'VAR',
        personLogin: 'p1',
        personCode: 'P1',
        coderResults: [
          {
            coderId: 1,
            coderName: 'Coder 1',
            jobId: 11,
            code: 1,
            score: null,
            notes: null,
            codedAt: new Date()
          },
          {
            coderId: 2,
            coderName: 'Coder 2',
            jobId: 12,
            code: 1,
            score: null,
            notes: null,
            codedAt: new Date()
          },
          {
            coderId: 3,
            coderName: 'Coder 3',
            jobId: 13,
            code: 2,
            score: null,
            notes: null,
            codedAt: new Date()
          }
        ]
      }]
    });
    codingStatisticsService.calculateCohensKappa.mockReturnValue([
      {
        coder1Id: 1,
        coder1Name: 'Coder 1',
        coder2Id: 2,
        coder2Name: 'Coder 2',
        kappa: 0.5,
        agreement: 0.75,
        totalItems: 10,
        validPairs: 10,
        interpretation: 'kappa.moderate'
      },
      {
        coder1Id: 1,
        coder1Name: 'Coder 1',
        coder2Id: 3,
        coder2Name: 'Coder 3',
        kappa: 1,
        agreement: 1,
        totalItems: 5,
        validPairs: 5,
        interpretation: 'kappa.almost_perfect'
      },
      {
        coder1Id: 2,
        coder1Name: 'Coder 2',
        coder2Id: 3,
        coder2Name: 'Coder 3',
        kappa: null,
        agreement: 0,
        totalItems: 5,
        validPairs: 0,
        interpretation: 'No valid coding pairs'
      }
    ]);

    const result = await controller.getCohensKappaStatistics(
      5,
      'true',
      undefined,
      undefined,
      'false'
    );

    expect(result.variables[0].meanKappa).toBe(0.667);
    expect(result.workspaceSummary.averageKappa).toBe(0.667);
    expect(
      codingReviewService.getDoubleCodedVariablesForReview
    ).toHaveBeenCalledWith(5, 1, 1000, false, false);
  });

  it('adds unweighted mean kappa per variable to detailed kappa statistics', async () => {
    codingReviewService.getDoubleCodedVariablesForReview.mockResolvedValue({
      total: 1,
      data: [{
        unitName: 'UNIT',
        variableId: 'VAR',
        personLogin: 'p1',
        personCode: 'P1',
        coderResults: [
          {
            coderId: 1,
            coderName: 'Coder 1',
            jobId: 11,
            code: 1,
            score: null,
            notes: null,
            codedAt: new Date()
          },
          {
            coderId: 2,
            coderName: 'Coder 2',
            jobId: 12,
            code: 1,
            score: null,
            notes: null,
            codedAt: new Date()
          },
          {
            coderId: 3,
            coderName: 'Coder 3',
            jobId: 13,
            code: 2,
            score: null,
            notes: null,
            codedAt: new Date()
          }
        ]
      }]
    });
    codingStatisticsService.calculateCohensKappa.mockReturnValue([
      {
        coder1Id: 1,
        coder1Name: 'Coder 1',
        coder2Id: 2,
        coder2Name: 'Coder 2',
        kappa: 0.5,
        agreement: 0.75,
        totalItems: 10,
        validPairs: 10,
        interpretation: 'kappa.moderate'
      },
      {
        coder1Id: 1,
        coder1Name: 'Coder 1',
        coder2Id: 3,
        coder2Name: 'Coder 3',
        kappa: 1,
        agreement: 1,
        totalItems: 5,
        validPairs: 5,
        interpretation: 'kappa.almost_perfect'
      },
      {
        coder1Id: 2,
        coder1Name: 'Coder 2',
        coder2Id: 3,
        coder2Name: 'Coder 3',
        kappa: null,
        agreement: 0,
        totalItems: 5,
        validPairs: 0,
        interpretation: 'No valid coding pairs'
      }
    ]);

    const result = await controller.getCohensKappaStatistics(5, 'false');

    expect(result.variables[0].meanKappa).toBe(0.75);
    expect(result.workspaceSummary.averageKappa).toBe(0.75);
  });
});
