import { WorkspaceCoderTrainingController } from './workspace-coder-training.controller';
import {
  CoderTrainingResultsApplyService,
  CoderTrainingService
} from '../../database/services/coding';

describe('WorkspaceCoderTrainingController', () => {
  let controller: WorkspaceCoderTrainingController;
  let coderTrainingService: {
    getTrainingCodingComparisonPage: jest.Mock;
    getWithinTrainingCodingComparisonPage: jest.Mock;
    getWithinTrainingCodingComparison: jest.Mock;
    getWithinTrainingCohensKappa: jest.Mock;
    getWithinTrainingComparisonFreshness: jest.Mock;
    transformToCoderPairs: jest.Mock;
    saveDiscussionResult: jest.Mock;
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
      getWithinTrainingCohensKappa: jest.fn(),
      getWithinTrainingComparisonFreshness: jest.fn(),
      transformToCoderPairs: jest.fn(),
      saveDiscussionResult: jest.fn()
    };
    coderTrainingResultsApplyService = {
      previewTrainingDiscussionResults: jest.fn(),
      applyTrainingDiscussionResults: jest.fn()
    };

    controller = new WorkspaceCoderTrainingController(
      coderTrainingService as unknown as CoderTrainingService,
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

  it('forwards coder-training kappa requests to the service without loading comparison rows', async () => {
    const kappaStatistics = {
      variables: [{
        unitName: 'U1',
        variableId: 'V1',
        meanKappa: 0.6,
        meanAgreement: 0.85,
        caseCount: 2,
        validPairCount: 15,
        coderPairCount: 2,
        coderPairs: []
      }],
      workspaceSummary: {
        totalDoubleCodedResponses: 2,
        totalCoderPairs: 1,
        averageKappa: 0.6,
        variablesIncluded: 1,
        codersIncluded: 2,
        weightingMethod: 'unweighted' as const,
        calculationLevel: 'score' as const
      }
    };
    coderTrainingService.getWithinTrainingCohensKappa.mockResolvedValue(kappaStatistics);

    const result = await controller.getTrainingCohensKappa(12, 5, 'false', 'score', '11,12');

    expect(result).toBe(kappaStatistics);
    expect(coderTrainingService.getWithinTrainingCohensKappa).toHaveBeenCalledWith(12, 5, {
      weightedMean: false,
      level: 'score',
      selectedJobIds: [11, 12]
    });
    expect(coderTrainingService.getWithinTrainingCodingComparison).not.toHaveBeenCalled();
    expect(coderTrainingService.transformToCoderPairs).not.toHaveBeenCalled();
  });

  it('exports all training reliability metrics with calculation metadata', async () => {
    coderTrainingService.getWithinTrainingCohensKappa.mockResolvedValue({
      variables: [{
        unitName: 'U1',
        variableId: 'V1',
        meanKappa: 0.4,
        meanBrennanPredigerKappa: 0.5,
        fleissKappa: 0.495,
        fleissCaseCount: 6,
        fleissPossibleCaseCount: 8,
        meanAgreement: 0.75,
        caseCount: 8,
        validPairCount: 18,
        coderPairCount: 3,
        coderPairs: []
      }],
      workspaceSummary: {
        totalDoubleCodedResponses: 8,
        totalCoderPairs: 3,
        averageKappa: 0.4,
        averageBrennanPredigerKappa: 0.5,
        variablesIncluded: 1,
        codersIncluded: 3,
        weightingMethod: 'weighted',
        calculationLevel: 'code'
      }
    });
    const response = {
      setHeader: jest.fn(),
      send: jest.fn()
    };

    await controller.exportTrainingReliabilityAsCsv(
      12,
      5,
      'true',
      'code',
      '11,12,13',
      response as never
    );

    expect(coderTrainingService.getWithinTrainingCohensKappa).toHaveBeenCalledWith(12, 5, {
      weightedMean: true,
      level: 'code',
      selectedJobIds: [11, 12, 13]
    });
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    const csv = response.send.mock.calls[0][0] as string;
    expect(csv).toContain('Kennwert;Wert;Berechnungsebene;Gewichtungsmethode');
    expect(csv).toContain("Cohen's Kappa (Mittelwert);0.4;Code-Ebene");
    expect(csv).toContain('Brennan-Prediger-Kappa (Mittelwert);0.5;Code-Ebene');
    expect(csv).toContain("Fleiss' Kappa;0.495;Code-Ebene;Nicht anwendbar;Listwise-Ausschluss unvollstaendiger Faelle;6;8");
    expect(csv).toContain('irr::kappam.fleiss(exact=FALSE)');
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
