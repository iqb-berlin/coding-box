import { WorkspaceCoderTrainingController } from './workspace-coder-training.controller';
import {
  CoderTrainingResultsApplyService,
  CoderTrainingService,
  CodingStatisticsService
} from '../../database/services/coding';

describe('WorkspaceCoderTrainingController', () => {
  let controller: WorkspaceCoderTrainingController;
  let coderTrainingService: {
    getTrainingCodingComparisonPage: jest.Mock;
    getWithinTrainingCodingComparisonPage: jest.Mock;
    getWithinTrainingCodingComparison: jest.Mock;
    getWithinTrainingComparisonFreshness: jest.Mock;
    transformToCoderPairs: jest.Mock;
    saveDiscussionResult: jest.Mock;
  };
  let codingStatisticsService: {
    calculateCohensKappa: jest.Mock;
    calculateKappaVariableSummary: jest.Mock;
  };
  let coderTrainingResultsApplyService: {
    previewTrainingDiscussionResults: jest.Mock;
    applyTrainingDiscussionResults: jest.Mock;
  };

  beforeEach(() => {
    coderTrainingService = {
      getTrainingCodingComparisonPage: jest.fn(),
      getWithinTrainingCodingComparisonPage: jest.fn(),
      getWithinTrainingCodingComparison: jest.fn(),
      getWithinTrainingComparisonFreshness: jest.fn(),
      transformToCoderPairs: jest.fn(),
      saveDiscussionResult: jest.fn()
    };
    codingStatisticsService = {
      calculateCohensKappa: jest.fn(),
      calculateKappaVariableSummary: jest.fn()
    };
    coderTrainingResultsApplyService = {
      previewTrainingDiscussionResults: jest.fn(),
      applyTrainingDiscussionResults: jest.fn()
    };

    controller = new WorkspaceCoderTrainingController(
      coderTrainingService as unknown as CoderTrainingService,
      codingStatisticsService as unknown as CodingStatisticsService,
      coderTrainingResultsApplyService as unknown as CoderTrainingResultsApplyService
    );
  });

  it('forwards between-training comparison paging, sorting, and filters to the service', async () => {
    const page = {
      data: [],
      total: 0,
      page: 2,
      limit: 25,
      totalPages: 0,
      summary: {
        visibleRows: 0,
        comparableRows: 0,
        matchingRows: 0,
        matchingPercentage: 0,
        incompleteRows: 0,
        notComparableRows: 0,
        deviationRows: 0,
        completionRate: 0
      },
      availableCoders: []
    };
    coderTrainingService.getTrainingCodingComparisonPage.mockResolvedValue(page);

    const result = await controller.compareTrainingCodingResults(
      12,
      '1,2',
      '2',
      '25',
      'personLogin',
      'desc',
      '1_101,2_201',
      'Unit',
      'VAR',
      'login',
      'group',
      'booklet',
      'differ',
      'with-notes',
      'true'
    );

    expect(result).toBe(page);
    expect(coderTrainingService.getTrainingCodingComparisonPage).toHaveBeenCalledWith(
      12,
      [1, 2],
      {
        page: 2,
        limit: 25,
        sortBy: 'personLogin',
        sortDirection: 'desc',
        selectedCoderKeys: ['1_101', '2_201'],
        filters: {
          unitName: 'Unit',
          variableId: 'VAR',
          personLogin: 'login',
          personGroup: 'group',
          bookletName: 'booklet',
          match: 'differ',
          notesMode: 'with-notes',
          regexSearch: true
        }
      }
    );
  });

  it('forwards within-training comparison paging and selected jobs to the service', async () => {
    const page = {
      data: [],
      total: 0,
      page: 1,
      limit: 50,
      totalPages: 0,
      summary: {
        visibleRows: 0,
        comparableRows: 0,
        matchingRows: 0,
        matchingPercentage: 0,
        incompleteRows: 0,
        notComparableRows: 0,
        deviationRows: 0,
        completionRate: 0
      },
      availableCoders: []
    };
    coderTrainingService.getWithinTrainingCodingComparisonPage.mockResolvedValue(page);

    const result = await controller.compareWithinTrainingCodingResults(
      12,
      '5',
      undefined,
      undefined,
      undefined,
      undefined,
      '11,12',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'match',
      'none',
      undefined
    );

    expect(result).toBe(page);
    expect(coderTrainingService.getWithinTrainingCodingComparisonPage).toHaveBeenCalledWith(
      12,
      5,
      {
        page: 1,
        limit: 50,
        sortBy: undefined,
        sortDirection: undefined,
        selectedJobIds: [11, 12],
        filters: {
          unitName: undefined,
          variableId: undefined,
          personLogin: undefined,
          personGroup: undefined,
          bookletName: undefined,
          match: 'match',
          notesMode: 'none',
          regexSearch: undefined
        }
      }
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

  it('forwards comparison freshness requests to the service', async () => {
    coderTrainingService.getWithinTrainingComparisonFreshness.mockResolvedValue({
      workspaceId: 12,
      trainingId: 5,
      version: 'fresh-1',
      jobCount: 2,
      unitCount: 4,
      responseCount: 3,
      discussionResultCount: 1,
      latestTrainingChange: '2026-07-01T10:00:00.000Z',
      latestJobChange: '2026-07-01T10:01:00.000Z',
      latestUnitChange: '2026-07-01T10:02:00.000Z',
      latestDiscussionChange: '2026-07-01T10:03:00.000Z'
    });

    const result = await controller.getTrainingComparisonFreshness(12, 5);

    expect(coderTrainingService.getWithinTrainingComparisonFreshness)
      .toHaveBeenCalledWith(12, 5);
    expect(result.version).toBe('fresh-1');
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

  it('forwards discussion apply preview requests to the service', async () => {
    coderTrainingResultsApplyService.previewTrainingDiscussionResults.mockResolvedValue({
      trainingId: 5,
      source: 'manual',
      totalTrainingResponses: 1,
      sourceResultsCount: 1,
      applicableResultsCount: 1,
      missingResultsCount: 0,
      missingScoreCount: 0,
      existingFinalResultsCount: 0,
      productiveJobConflictCount: 0,
      removableProductiveJobUnitCount: 0,
      blockingProductiveJobUnitCount: 0,
      approvedJobDefinitionConflictCount: 0,
      staleTrainingJobCount: 0,
      affectedJobIds: [],
      affectedJobDefinitionIds: [],
      canApply: true
    });

    const result = await controller.previewApplyDiscussionResults(12, 5, 'manual');

    expect(coderTrainingResultsApplyService.previewTrainingDiscussionResults)
      .toHaveBeenCalledWith(12, 5, 'manual');
    expect(result.applicableResultsCount).toBe(1);
  });

  it('forwards discussion apply requests to the service', async () => {
    coderTrainingResultsApplyService.applyTrainingDiscussionResults.mockResolvedValue({
      success: true,
      trainingId: 5,
      source: 'auto_agreement',
      totalTrainingResponses: 1,
      sourceResultsCount: 1,
      applicableResultsCount: 1,
      missingResultsCount: 0,
      missingScoreCount: 0,
      existingFinalResultsCount: 0,
      productiveJobConflictCount: 0,
      removableProductiveJobUnitCount: 0,
      blockingProductiveJobUnitCount: 0,
      approvedJobDefinitionConflictCount: 0,
      staleTrainingJobCount: 0,
      affectedJobIds: [],
      affectedJobDefinitionIds: [],
      canApply: true,
      updatedResponsesCount: 1,
      skippedExistingResultsCount: 0,
      overwrittenExistingResultsCount: 0,
      skippedJobConflictCount: 0,
      skippedMissingScoreCount: 0,
      removedJobUnitCount: 0,
      messageKey: 'coding.trainings.apply.success'
    });

    const body = {
      source: 'auto_agreement' as const,
      existingResultStrategy: 'skip' as const,
      jobConflictStrategy: 'removeFromJobs' as const
    };
    const result = await controller.applyDiscussionResults(12, 5, body);

    expect(coderTrainingResultsApplyService.applyTrainingDiscussionResults)
      .toHaveBeenCalledWith(12, 5, body);
    expect(result.updatedResponsesCount).toBe(1);
  });
});
