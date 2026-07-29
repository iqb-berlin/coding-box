import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { CodingFreshnessSummaryDto } from '../../../../../../api-dto/coding/coding-freshness.dto';
import { CodingStatusRevisionDto } from '../../../../../../api-dto/coding/coding-status-revision.dto';
import { ResponseAnalysisDto } from '../../../../../../api-dto/coding/response-analysis.dto';
import { AppService } from '../../core/services/app.service';
import { CodingJobBackendService } from './coding-job-backend.service';
import { CodingStatisticsService } from './coding-statistics.service';
import { CodingStatusSnapshotService } from './coding-status-snapshot.service';
import { ManualCodingStatusSnapshot } from './coding-status-snapshot.model';
import { DoubleCodedReviewApiService } from './double-coded-review-api.service';
import {
  ManualPlanningLoadOptions,
  ManualPlanningStatusFacade
} from './manual-planning-status.facade';
import { TestPersonCodingService } from './test-person-coding.service';

describe('ManualPlanningStatusFacade', () => {
  const workspaceId = 3;
  const userId = 7;
  const revision = (
    value: number,
    stable = true
  ): CodingStatusRevisionDto => ({
    workspaceId,
    revision: value,
    statusRevision: `${value}`,
    stable
  });
  const responseAnalysis: ResponseAnalysisDto = {
    emptyResponses: { total: 0, totalUncoded: 0, items: [] },
    duplicateValues: {
      total: 0,
      totalResponses: 0,
      groups: [],
      isAggregationApplied: true
    },
    aggregationSummary: {
      duplicateGroups: 0,
      duplicateResponses: 0,
      collapsedCases: 0,
      rawCases: 0,
      effectiveCases: 0,
      threshold: 2,
      aggregationActive: true
    },
    matchingFlags: [],
    analysisTimestamp: '2026-01-01T00:00:00.000Z'
  };
  const loadOptions: ManualPlanningLoadOptions = {
    workspaceId,
    userId,
    forceRefresh: false,
    aggregationThreshold: 2,
    emptyPage: 1,
    emptyLimit: 25,
    duplicatePage: 1,
    duplicateLimit: 25,
    currentResponseAnalysis: responseAnalysis,
    loadResponseAnalysis: false,
    canOpenCompletion: true
  };
  const snapshot = (): ManualCodingStatusSnapshot => ({
    schemaVersion: 1,
    userId,
    workspaceId,
    revision: 1,
    statusRevision: '1',
    checkedAt: '2026-01-01T00:00:00.000Z',
    surface: 'manual',
    planningStatus: 'planning-ready',
    displayParameters: {
      variableConflicts: 0,
      missingVariables: 0,
      unassignedCases: 0,
      activeTrainingJobs: 0,
      staleSourceJobs: 0,
      openDoubleCodingConflicts: 0,
      manualCodeAvailabilityWarnings: 0
    },
    freshness: { workspaceId, currentRevision: 1, items: [] },
    nextTarget: {
      tab: 'planning',
      sectionId: 'manual-planning',
      action: 'navigate'
    },
    fullyChecked: true
  });

  let facade: ManualPlanningStatusFacade;
  let appService: {
    authData: { userId: number };
    selectedWorkspaceId: number;
  };
  let testPersonCodingService: {
    invalidateCodingStatusCache: jest.Mock;
    getVariableCoverageOverview: jest.Mock;
    getCaseCoverageOverview: jest.Mock;
    getCodingProgressOverview: jest.Mock;
    getAppliedResultsOverview: jest.Mock;
    getCodingFreshness: jest.Mock;
    getResponseAnalysis: jest.Mock;
    setResponseAnalysisGuardRunning: jest.Mock;
    trackResponseAnalysisGuardUntilComplete: jest.Mock;
  };
  let codingJobBackendService: {
    getCodingIncompleteVariables: jest.Mock;
    getManualCodingScopeSummary: jest.Mock;
    getManualCodeAvailabilityWarnings: jest.Mock;
    getCodingJobs: jest.Mock;
  };
  let doubleCodedReviewApi: {
    getDoubleCodedVariablesForReview: jest.Mock;
  };
  let statisticsService: { getCodingStatistics: jest.Mock };
  let snapshotService: {
    restoreManual: jest.Mock;
    saveManual: jest.Mock;
    getRevision: jest.Mock;
  };

  beforeEach(() => {
    appService = {
      authData: { userId },
      selectedWorkspaceId: workspaceId
    };
    testPersonCodingService = {
      invalidateCodingStatusCache: jest.fn(),
      getVariableCoverageOverview: jest.fn().mockReturnValue(of({
        totalVariables: 0,
        coveredVariables: 0,
        coveredByDraft: 0,
        coveredByPendingReview: 0,
        coveredByApproved: 0,
        conflictedVariables: 0,
        missingVariables: 0,
        coveragePercentage: 100,
        variableCaseCounts: [],
        coverageByStatus: {
          draft: [],
          pending_review: [],
          approved: [],
          conflicted: []
        }
      })),
      getCaseCoverageOverview: jest.fn().mockReturnValue(of({
        totalCasesToCode: 0,
        effectiveTotalCasesToCode: 0,
        casesInJobs: 0,
        effectiveCasesInJobs: 0,
        doubleCodedCases: 0,
        singleCodedCases: 0,
        unassignedCases: 0,
        effectiveUnassignedCases: 0,
        coveragePercentage: 100,
        rawCoveragePercentage: 100,
        aggregationActive: true,
        aggregationThreshold: 2,
        aggregatedDuplicateCases: 0,
        responseAnalysisRawCases: 0
      })),
      getCodingProgressOverview: jest.fn().mockReturnValue(of(null)),
      getAppliedResultsOverview: jest.fn().mockReturnValue(of(null)),
      getCodingFreshness: jest.fn().mockReturnValue(of({
        workspaceId,
        currentRevision: 1,
        items: []
      })),
      getResponseAnalysis: jest.fn().mockReturnValue(of(responseAnalysis)),
      setResponseAnalysisGuardRunning: jest.fn(),
      trackResponseAnalysisGuardUntilComplete: jest.fn()
    };
    codingJobBackendService = {
      getCodingIncompleteVariables: jest.fn().mockReturnValue(of([])),
      getManualCodingScopeSummary: jest.fn().mockReturnValue(of({
        manualVariableCount: 0,
        manualResponseCount: 0,
        coveredSourceVariableCount: 0,
        coveredSourceResponseCount: 0,
        coveredSourceVariables: []
      })),
      getManualCodeAvailabilityWarnings: jest.fn().mockReturnValue(of({
        warnings: []
      })),
      getCodingJobs: jest.fn().mockReturnValue(of({ data: [] }))
    };
    doubleCodedReviewApi = {
      getDoubleCodedVariablesForReview: jest.fn().mockReturnValue(of({
        data: [],
        total: 0,
        page: 1,
        limit: 1
      }))
    };
    statisticsService = {
      getCodingStatistics: jest.fn().mockReturnValue(of({
        totalResponses: 0,
        statusCounts: {}
      }))
    };
    snapshotService = {
      restoreManual: jest.fn().mockReturnValue(of(null)),
      saveManual: jest.fn(),
      getRevision: jest.fn().mockReturnValue(of(revision(1)))
    };

    TestBed.configureTestingModule({
      providers: [
        ManualPlanningStatusFacade,
        { provide: AppService, useValue: appService },
        {
          provide: TestPersonCodingService,
          useValue: testPersonCodingService
        },
        { provide: CodingJobBackendService, useValue: codingJobBackendService },
        { provide: DoubleCodedReviewApiService, useValue: doubleCodedReviewApi },
        { provide: CodingStatisticsService, useValue: statisticsService },
        { provide: CodingStatusSnapshotService, useValue: snapshotService }
      ]
    });
    facade = TestBed.inject(ManualPlanningStatusFacade);
  });

  it('publishes loaded only after the complete request workflow finishes', () => {
    const freshness$ = new Subject<CodingFreshnessSummaryDto>();
    testPersonCodingService.getCodingFreshness.mockReturnValue(freshness$);

    expect(facade.viewState.loadState).toBe('notLoaded');
    facade.load(loadOptions);

    expect(facade.viewState.loadState).toBe('loading');
    expect(snapshotService.getRevision).toHaveBeenCalledTimes(1);
    expect(snapshotService.saveManual).not.toHaveBeenCalled();

    freshness$.next({ workspaceId, currentRevision: 1, items: [] });
    freshness$.complete();

    expect(snapshotService.getRevision).toHaveBeenCalledTimes(2);
    expect(facade.viewState.loadState).toBe('loaded');
    expect(facade.viewState.data?.responseAnalysis).toBe(responseAnalysis);
    expect(facade.viewState.presentation?.planningStatus)
      .toBe('progress-unavailable');
    expect(snapshotService.saveManual).toHaveBeenCalledTimes(1);
  });

  it('retries once when the revision changes during loading', () => {
    snapshotService.getRevision
      .mockReturnValueOnce(of(revision(1)))
      .mockReturnValueOnce(of(revision(2)))
      .mockReturnValueOnce(of(revision(2)))
      .mockReturnValueOnce(of(revision(2)));
    testPersonCodingService.getCodingFreshness.mockReturnValue(of({
      workspaceId,
      currentRevision: 2,
      items: []
    }));

    facade.load(loadOptions);

    expect(facade.viewState.loadState).toBe('loaded');
    expect(testPersonCodingService.invalidateCodingStatusCache)
      .toHaveBeenCalledWith(workspaceId);
    expect(snapshotService.saveManual).toHaveBeenCalledTimes(1);
    expect(snapshotService.saveManual.mock.calls[0][0].revision).toBe(2);
  });

  it('invalidates cached status after the revision retry is exhausted', () => {
    snapshotService.getRevision
      .mockReturnValueOnce(of(revision(1)))
      .mockReturnValueOnce(of(revision(2)))
      .mockReturnValueOnce(of(revision(2)))
      .mockReturnValueOnce(of(revision(3)));

    facade.load(loadOptions);

    expect(facade.viewState.loadState).toBe('stale');
    expect(testPersonCodingService.invalidateCodingStatusCache)
      .toHaveBeenCalledTimes(2);
    expect(testPersonCodingService.invalidateCodingStatusCache)
      .toHaveBeenLastCalledWith(workspaceId);
    expect(snapshotService.saveManual).not.toHaveBeenCalled();
  });

  it('marks failed workflows as stale', () => {
    testPersonCodingService.getVariableCoverageOverview.mockReturnValue(
      throwError(() => new Error('request failed'))
    );

    facade.load(loadOptions);

    expect(facade.viewState.loadState).toBe('stale');
    expect(snapshotService.saveManual).not.toHaveBeenCalled();
  });

  it('marks the workflow stale when strict statistics loading fails', () => {
    statisticsService.getCodingStatistics.mockReturnValue(
      throwError(() => new Error('statistics failed'))
    );

    facade.load(loadOptions);

    expect(statisticsService.getCodingStatistics).toHaveBeenCalledWith(
      workspaceId,
      'v2',
      { failOnError: true }
    );
    expect(facade.viewState.loadState).toBe('stale');
    expect(snapshotService.saveManual).not.toHaveBeenCalled();
  });

  it('does not save results after the active user changes', () => {
    const freshness$ = new Subject<CodingFreshnessSummaryDto>();
    testPersonCodingService.getCodingFreshness.mockReturnValue(freshness$);
    facade.load(loadOptions);

    appService.authData = { userId: 99 };
    freshness$.next({ workspaceId, currentRevision: 1, items: [] });
    freshness$.complete();

    expect(facade.viewState.loadState).toBe('stale');
    expect(snapshotService.saveManual).not.toHaveBeenCalled();
  });

  it('restores a snapshot into the typed view state', () => {
    const restoredSnapshot = snapshot();
    snapshotService.restoreManual.mockReturnValue(of(restoredSnapshot));

    facade.restore(userId, workspaceId, true).subscribe();

    expect(facade.viewState.restoredSnapshot).toEqual(restoredSnapshot);
    expect(facade.viewState.presentation).toEqual({
      planningStatus: 'planning-ready',
      displayParameters: restoredSnapshot.displayParameters,
      nextTarget: restoredSnapshot.nextTarget
    });
    expect(facade.viewState.loadState).toBe('notLoaded');
  });

  it('discards a pending snapshot restore after invalidation', () => {
    const restoredSnapshot$ = new Subject<ManualCodingStatusSnapshot | null>();
    snapshotService.restoreManual.mockReturnValue(restoredSnapshot$);
    facade.restore(userId, workspaceId, true).subscribe();

    facade.invalidate();
    restoredSnapshot$.next(snapshot());
    restoredSnapshot$.complete();

    expect(facade.viewState.loadState).toBe('stale');
    expect(facade.viewState.restoredSnapshot).toBeNull();
    expect(facade.viewState.presentation).toBeNull();
  });

  it('derives execution and completion from progress before job data is available', () => {
    facade.load(loadOptions);
    const baseData = facade.viewState.data!;
    const progress = {
      totalCasesToCode: 10,
      completedCases: 4,
      completionPercentage: 40,
      rawTotalCasesToCode: 10,
      rawCompletedCases: 4,
      rawCompletionPercentage: 40,
      aggregationActive: false,
      aggregationThreshold: null,
      aggregatedDuplicateCases: 0
    };

    expect(facade.derivePresentation({
      ...baseData,
      codingProgressOverview: progress,
      manualFreshnessJobSummary: null
    }, true).planningStatus).toBe('execution-ready');

    expect(facade.derivePresentation({
      ...baseData,
      codingProgressOverview: {
        ...progress,
        completedCases: 10,
        completionPercentage: 100,
        rawCompletedCases: 10,
        rawCompletionPercentage: 100
      },
      appliedResultsOverview: {
        totalIncompleteResponses: 10,
        appliedResponses: 0,
        remainingResponses: 10,
        completionPercentage: 0,
        rawTotalIncompleteResponses: 10,
        rawAppliedResponses: 0,
        rawCompletionPercentage: 0,
        aggregationActive: false,
        aggregationThreshold: null,
        aggregatedDuplicateCases: 0,
        totalIncompleteVariables: 0,
        finalStatusBreakdown: {
          codingComplete: 0,
          invalid: 0,
          codingError: 0,
          other: 0
        }
      },
      manualFreshnessJobSummary: null
    }, true).planningStatus).toBe('completion-ready');
  });
});
