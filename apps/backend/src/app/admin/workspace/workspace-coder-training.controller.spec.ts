import { WorkspaceCoderTrainingController } from './workspace-coder-training.controller';
import { CoderTrainingService, CodingStatisticsService } from '../../database/services/coding';

describe('WorkspaceCoderTrainingController', () => {
  let controller: WorkspaceCoderTrainingController;
  let coderTrainingService: {
    getWithinTrainingCodingComparison: jest.Mock;
    transformToCoderPairs: jest.Mock;
    saveDiscussionResult: jest.Mock;
  };
  let codingStatisticsService: {
    calculateCohensKappa: jest.Mock;
    calculateKappaVariableSummary: jest.Mock;
  };

  beforeEach(() => {
    coderTrainingService = {
      getWithinTrainingCodingComparison: jest.fn(),
      transformToCoderPairs: jest.fn(),
      saveDiscussionResult: jest.fn()
    };
    codingStatisticsService = {
      calculateCohensKappa: jest.fn(),
      calculateKappaVariableSummary: jest.fn()
    };

    controller = new WorkspaceCoderTrainingController(
      coderTrainingService as unknown as CoderTrainingService,
      codingStatisticsService as unknown as CodingStatisticsService
    );
  });

  it('returns backend-calculated variable kappa summaries for coder trainings', async () => {
    coderTrainingService.getWithinTrainingCodingComparison.mockResolvedValue([
      {
        responseId: 1,
        unitName: 'U1',
        variableId: 'V1',
        coders: [
          { jobId: 1, code: '1', score: 1 },
          { jobId: 2, code: '1', score: 1 },
          { jobId: 3, code: '1', score: 1 }
        ]
      },
      {
        responseId: 2,
        unitName: 'U1',
        variableId: 'V1',
        coders: [
          { jobId: 1, code: '1', score: 1 },
          { jobId: 2, code: null, score: null },
          { jobId: 3, code: '2', score: 2 }
        ]
      },
      {
        responseId: 3,
        unitName: 'U2',
        variableId: 'V2',
        coders: [
          { jobId: 1, code: '1', score: 1 },
          { jobId: 2, code: null, score: null },
          { jobId: 3, code: null, score: null }
        ]
      }
    ]);
    coderTrainingService.transformToCoderPairs.mockReturnValue([
      {
        coder1Id: 1,
        coder1Name: 'Coder 1',
        coder2Id: 2,
        coder2Name: 'Coder 2',
        unitName: 'U1',
        variableId: 'V1',
        codes: []
      }
    ]);
    codingStatisticsService.calculateCohensKappa.mockReturnValue([
      {
        coder1Id: 1,
        coder1Name: 'Coder 1',
        coder2Id: 2,
        coder2Name: 'Coder 2',
        unitName: 'U1',
        variableId: 'V1',
        kappa: 0.5,
        agreement: 0.8,
        totalItems: 10,
        validPairs: 10,
        interpretation: 'kappa.moderate'
      },
      {
        coder1Id: 1,
        coder1Name: 'Coder 1',
        coder2Id: 3,
        coder2Name: 'Coder 3',
        unitName: 'U1',
        variableId: 'V1',
        kappa: 0.7,
        agreement: 0.9,
        totalItems: 5,
        validPairs: 5,
        interpretation: 'kappa.substantial'
      },
      {
        coder1Id: 2,
        coder1Name: 'Coder 2',
        coder2Id: 3,
        coder2Name: 'Coder 3',
        unitName: 'U2',
        variableId: 'V2',
        kappa: null,
        agreement: 0,
        totalItems: 4,
        validPairs: 0,
        interpretation: 'No valid coding pairs'
      }
    ]);
    codingStatisticsService.calculateKappaVariableSummary
      .mockReturnValueOnce({
        meanKappa: 0.6,
        meanAgreement: 0.85,
        validPairCount: 15,
        coderPairCount: 2
      })
      .mockReturnValueOnce({
        meanKappa: null,
        meanAgreement: null,
        validPairCount: 0,
        coderPairCount: 0
      });

    const result = await controller.getTrainingCohensKappa(12, 5, 'false', 'code');

    expect(result.variables).toEqual([
      expect.objectContaining({
        unitName: 'U1',
        variableId: 'V1',
        meanKappa: 0.6,
        meanAgreement: 0.85,
        caseCount: 2,
        validPairCount: 15,
        coderPairCount: 2
      }),
      expect.objectContaining({
        unitName: 'U2',
        variableId: 'V2',
        meanKappa: null,
        meanAgreement: null,
        caseCount: 0,
        validPairCount: 0,
        coderPairCount: 0
      })
    ]);
    expect(codingStatisticsService.calculateKappaVariableSummary).toHaveBeenCalledWith([
      expect.objectContaining({ unitName: 'U1', variableId: 'V1', kappa: 0.5 }),
      expect.objectContaining({ unitName: 'U1', variableId: 'V1', kappa: 0.7 })
    ]);
    expect(codingStatisticsService.calculateKappaVariableSummary).toHaveBeenCalledWith([
      expect.objectContaining({ unitName: 'U2', variableId: 'V2', kappa: null })
    ]);
    expect(result.workspaceSummary.weightingMethod).toBe('unweighted');
    expect(result.workspaceSummary.calculationLevel).toBe('code');
    expect(result.workspaceSummary.totalDoubleCodedResponses).toBe(2);
  });

  it('forwards discussion result notes to the service', async () => {
    coderTrainingService.saveDiscussionResult.mockResolvedValue({
      success: true,
      code: 7,
      score: 2,
      notes: 'Replay note',
      source: 'manual',
      managerUserId: 23,
      managerName: 'manager'
    });

    const result = await controller.saveDiscussionResult(
      12,
      5,
      {
        responseId: 101, code: 7, score: 2, notes: 'Replay note'
      },
      { user: { id: 23, username: 'manager' } } as never
    );

    expect(coderTrainingService.saveDiscussionResult).toHaveBeenCalledWith(
      12,
      5,
      101,
      23,
      'manager',
      7,
      'Replay note'
    );
    expect(result.notes).toBe('Replay note');
  });
});
