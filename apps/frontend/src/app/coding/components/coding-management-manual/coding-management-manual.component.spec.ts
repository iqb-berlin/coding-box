import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ActivatedRoute, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, of, throwError } from 'rxjs';
import { CodingManagementManualComponent } from './coding-management-manual.component';
import { SERVER_URL } from '../../../injection-tokens';
import { environment } from '../../../../environments/environment';
import { ResponseMatchingFlag } from '../../../ws-admin/services/workspace-settings.service';

type VariableCoverageOverview = NonNullable<CodingManagementManualComponent['variableCoverageOverview']>;
type CaseCoverageOverview = NonNullable<CodingManagementManualComponent['caseCoverageOverview']>;
type CodingProgressOverview = NonNullable<CodingManagementManualComponent['codingProgressOverview']>;
type ManualAppliedResultsOverview = NonNullable<CodingManagementManualComponent['appliedResultsOverview']>;

describe('CodingManagementManualComponent', () => {
  let component: CodingManagementManualComponent;
  let fixture: ComponentFixture<CodingManagementManualComponent>;

  const fakeActivatedRoute = {
    snapshot: { data: {} }
  } as ActivatedRoute;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        {
          provide: ActivatedRoute,
          useValue: fakeActivatedRoute
        },
        {
          provide: SERVER_URL,
          useValue: environment.backendUrl
        },
        {
          provide: MatSnackBar,
          useValue: { open: jest.fn() }
        },
        {
          provide: Router,
          useValue: { navigate: jest.fn() }
        },
        provideHttpClient()
      ],
      imports: [CodingManagementManualComponent, TranslateModule.forRoot()]
    }).compileComponents();

    const translateService = TestBed.inject(TranslateService);
    translateService.setTranslation('de', {
      'coding-management-manual': {
        freshness: {
          'second-autocoding-ready-title': 'Auto-Coding 2 bereit',
          'second-autocoding-ready-summary': 'Die manuelle Kodierung ist abgeschlossen. Auto-Coding 2 kann nun für {{taskResults}} gestartet oder aktualisiert werden. Das betrifft {{responses}}.',
          'second-autocoding-ready-help': 'Starten Sie Auto-Coding 2 in der Kodierübersicht. {{taskResultHelp}}'
        },
        'completed-jobs': {
          'readonly-note': 'Nur lesbar'
        }
      }
    });
    translateService.use('de');

    fixture = TestBed.createComponent(CodingManagementManualComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should flag duplicate findings as diagnostic when aggregation is disabled', () => {
    component.responseAnalysis = {
      emptyResponses: { total: 0, totalUncoded: 0, items: [] },
      duplicateValues: {
        total: 2,
        totalResponses: 5,
        groups: [],
        isAggregationApplied: false
      },
      aggregationSummary: {
        duplicateGroups: 2,
        duplicateResponses: 5,
        collapsedCases: 0,
        rawCases: 10,
        effectiveCases: 10,
        threshold: 2,
        aggregationActive: false
      },
      matchingFlags: ['NO_AGGREGATION'],
      analysisTimestamp: new Date().toISOString()
    };

    expect(component.hasDuplicateFindingsWithoutAggregation).toBe(true);
    expect(component.hasPreparationWarnings()).toBe(true);
  });

  it('debounces response matching changes into one analysis restart', () => {
    jest.useFakeTimers();
    const componentInternals = component as unknown as {
      appService: { selectedWorkspaceId: number };
      testPersonCodingService: {
        saveAggregationSettings: (...args: unknown[]) => Observable<unknown>;
      };
    };
    const appService = componentInternals.appService;
    const testPersonCodingService = componentInternals.testPersonCodingService;

    appService.selectedWorkspaceId = 5;
    component.duplicateAggregationThreshold = 2;

    const saveSpy = jest.spyOn(testPersonCodingService, 'saveAggregationSettings')
      .mockReturnValue(of({
        success: true,
        threshold: 2,
        flags: [
          ResponseMatchingFlag.IGNORE_CASE,
          ResponseMatchingFlag.IGNORE_WHITESPACE
        ],
        aggregationActive: true,
        revertedResponses: 0,
        message: 'saved'
      }));
    const restartSpy = jest.spyOn(component, 'restartAnalysis')
      .mockImplementation(() => undefined);
    const refreshSpy = jest.spyOn(component as unknown as { refreshAggregationDependentViews: (includeResponseAnalysis?: boolean) => void }, 'refreshAggregationDependentViews')
      .mockImplementation(() => undefined);

    component.toggleMatchingFlag(ResponseMatchingFlag.IGNORE_CASE);
    component.toggleMatchingFlag(ResponseMatchingFlag.IGNORE_WHITESPACE);

    expect(saveSpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(500);

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith(5, 2, [
      ResponseMatchingFlag.IGNORE_CASE,
      ResponseMatchingFlag.IGNORE_WHITESPACE
    ]);
    expect(restartSpy).toHaveBeenCalledTimes(1);
    expect(refreshSpy).toHaveBeenCalledWith(false);

    jest.useRealTimers();
  });

  it('rolls response matching flags back when saving fails', () => {
    jest.useFakeTimers();
    try {
      const componentInternals = component as unknown as {
        appService: { selectedWorkspaceId: number };
        persistedResponseMatchingFlags: ResponseMatchingFlag[];
        testPersonCodingService: {
          saveAggregationSettings: (...args: unknown[]) => Observable<unknown>;
        };
      };
      const appService = componentInternals.appService;
      const testPersonCodingService = componentInternals.testPersonCodingService;

      appService.selectedWorkspaceId = 5;
      component.responseMatchingFlags = [ResponseMatchingFlag.NO_AGGREGATION];
      componentInternals.persistedResponseMatchingFlags = [ResponseMatchingFlag.NO_AGGREGATION];

      jest.spyOn(testPersonCodingService, 'saveAggregationSettings')
        .mockReturnValue(throwError(() => new Error('save failed')));

      component.toggleMatchingFlag(ResponseMatchingFlag.IGNORE_CASE);

      expect(component.responseMatchingFlags).toEqual([ResponseMatchingFlag.IGNORE_CASE]);

      jest.advanceTimersByTime(500);

      expect(component.responseMatchingFlags).toEqual([ResponseMatchingFlag.NO_AGGREGATION]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('allows retrying the same response matching flags after a failed save', () => {
    jest.useFakeTimers();
    try {
      const componentInternals = component as unknown as {
        appService: { selectedWorkspaceId: number };
        persistedResponseMatchingFlags: ResponseMatchingFlag[];
        testPersonCodingService: {
          saveAggregationSettings: (...args: unknown[]) => Observable<unknown>;
        };
      };
      const appService = componentInternals.appService;
      const testPersonCodingService = componentInternals.testPersonCodingService;

      appService.selectedWorkspaceId = 5;
      component.duplicateAggregationThreshold = 2;
      component.responseMatchingFlags = [ResponseMatchingFlag.NO_AGGREGATION];
      componentInternals.persistedResponseMatchingFlags = [ResponseMatchingFlag.NO_AGGREGATION];

      const saveSpy = jest.spyOn(testPersonCodingService, 'saveAggregationSettings')
        .mockReturnValueOnce(throwError(() => new Error('save failed')))
        .mockReturnValueOnce(of({
          success: true,
          threshold: 2,
          flags: [ResponseMatchingFlag.IGNORE_CASE],
          aggregationActive: true,
          revertedResponses: 0,
          message: 'saved'
        }));
      const restartSpy = jest.spyOn(component, 'restartAnalysis')
        .mockImplementation(() => undefined);

      component.toggleMatchingFlag(ResponseMatchingFlag.IGNORE_CASE);
      jest.advanceTimersByTime(500);

      expect(saveSpy).toHaveBeenCalledTimes(1);
      expect(component.responseMatchingFlags).toEqual([ResponseMatchingFlag.NO_AGGREGATION]);

      component.toggleMatchingFlag(ResponseMatchingFlag.IGNORE_CASE);
      jest.advanceTimersByTime(500);

      expect(saveSpy).toHaveBeenCalledTimes(2);
      expect(saveSpy).toHaveBeenLastCalledWith(5, 2, [ResponseMatchingFlag.IGNORE_CASE]);
      expect(component.responseMatchingFlags).toEqual([ResponseMatchingFlag.IGNORE_CASE]);
      expect(restartSpy).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('should not block preparation for duplicates when aggregation is active', () => {
    component.responseAnalysis = {
      emptyResponses: { total: 0, totalUncoded: 0, items: [] },
      duplicateValues: {
        total: 2,
        totalResponses: 5,
        groups: [],
        isAggregationApplied: true
      },
      aggregationSummary: {
        duplicateGroups: 2,
        duplicateResponses: 5,
        collapsedCases: 3,
        rawCases: 10,
        effectiveCases: 7,
        threshold: 2,
        aggregationActive: true
      },
      matchingFlags: [],
      analysisTimestamp: new Date().toISOString()
    };

    expect(component.hasDuplicateFindingsWithoutAggregation).toBe(false);
    expect(component.hasPreparationWarnings()).toBe(false);
    expect(component.isPreparationReady()).toBe(true);
  });

  it('should flag response analysis as outdated when raw manual counts changed', () => {
    component.responseAnalysis = {
      emptyResponses: { total: 0, totalUncoded: 0, items: [] },
      duplicateValues: {
        total: 16,
        totalResponses: 49,
        groups: [],
        isAggregationApplied: false
      },
      aggregationSummary: {
        duplicateGroups: 16,
        duplicateResponses: 49,
        collapsedCases: 33,
        rawCases: 628,
        effectiveCases: 595,
        threshold: 2,
        aggregationActive: true
      },
      matchingFlags: [],
      analysisTimestamp: new Date().toISOString()
    };
    setAppliedResults(897, 8, 889);
    component.appliedResultsOverview!.rawTotalIncompleteResponses = 973;

    expect(component.getCurrentRawManualResponses()).toBe(973);
    expect(component.isResponseAnalysisOutdated()).toBe(true);
  });

  it('should describe completed coding jobs as ready to apply', () => {
    component.completedJobsReadyForApply = [
      {
        id: 1,
        workspace_id: 1,
        name: 'Job 1',
        status: 'completed',
        created_at: new Date(),
        updated_at: new Date(),
        assignedCoders: [],
        totalUnits: 5,
        codedUnits: 5
      }
    ];

    expect(component.hasCompletedJobsReadyForApply()).toBe(true);
    expect(component.getCompletionActionTitle()).toContain('1 abgeschlossene');
    expect(component.getCodingJobResultSummary(component.completedJobsReadyForApply[0])).toBe('5/5 Ergebnisse kodiert');
  });

  it('should hide completed job apply actions without study-manager permission', () => {
    component.completedJobsReadyForApply = [
      {
        id: 1,
        workspace_id: 1,
        name: 'Job 1',
        status: 'completed',
        created_at: new Date(),
        updated_at: new Date(),
        assignedCoders: [],
        totalUnits: 5,
        codedUnits: 5
      }
    ];
    component.codingJobsComponent = {
      canApplyResults: false
    } as unknown as CodingManagementManualComponent['codingJobsComponent'];

    expect(component.canShowCompletedJobApplyActions()).toBe(false);

    component.codingJobsComponent = {
      canApplyResults: true
    } as unknown as CodingManagementManualComponent['codingJobsComponent'];

    expect(component.canShowCompletedJobApplyActions()).toBe(true);
  });

  it('should keep completed jobs visible as read-only without study-manager permission', () => {
    setAppliedResults(5, 0, 5);
    component.completedJobsReadyForApply = [
      {
        id: 1,
        workspace_id: 1,
        name: 'Job 1',
        status: 'completed',
        created_at: new Date(),
        updated_at: new Date(),
        assignedCoders: [],
        totalUnits: 5,
        codedUnits: 5
      }
    ];
    jest.spyOn(component, 'canApplyCompletedJobResults').mockReturnValue(false);

    fixture.detectChanges();

    const row = fixture.nativeElement.querySelector('.completed-job-apply-row') as HTMLElement | null;
    const applyButtons = Array.from(
      fixture.nativeElement.querySelectorAll('.completed-job-apply-row button')
    ) as HTMLButtonElement[];
    const readonlyNote = fixture.nativeElement.querySelector('.completed-job-readonly-note') as HTMLElement | null;

    expect(row?.textContent).toContain('Job 1');
    expect(row?.textContent).toContain('5/5 Ergebnisse kodiert');
    expect(applyButtons.some(button => button.textContent?.includes('Ergebnisse anwenden'))).toBe(false);
    expect(readonlyNote?.textContent).toContain('Nur lesbar');
  });

  it('should describe complete planning with open coding work as ready for execution', () => {
    setCompletePlanningState();
    setCodingProgress(10, 4);
    setAppliedResults(10, 0, 10);

    expect(component.getPlanningStatusClass()).toBe('status-ready');
    expect(component.getPlanningStatusIcon()).toBe('play_circle');
    expect(component.getPlanningStatusTitle()).toBe('Bereit für die Durchführung');
    expect(component.getPlanningStatusDescription()).toBe(
      'Die Planung ist vollständig. Bearbeiten Sie nun die offenen Kodierfälle im Abschnitt Durchführung.'
    );
  });

  it('should describe loading planning data as an updating status', () => {
    setCompletePlanningState();
    setCodingProgress(10, 4);
    component.isLoadingCodingProgress = true;

    expect(component.getPlanningStatusClass()).toBe('status-ready');
    expect(component.getPlanningStatusIcon()).toBe('sync');
    expect(component.getPlanningStatusTitle()).toBe('Status wird aktualisiert');
    expect(component.getPlanningStatusDescription()).toBe(
      'Die Planungs- und Kodierfortschritte werden geladen.'
    );
  });

  it('should not describe remaining applied results as open execution work without coding progress', () => {
    setCompletePlanningState();
    setAppliedResults(10, 0, 10);

    expect(component.getPlanningStatusClass()).toBe('status-attention');
    expect(component.getPlanningStatusIcon()).toBe('sync_problem');
    expect(component.getPlanningStatusTitle()).toBe('Kodierfortschritt nicht verfügbar');
    expect(component.getPlanningStatusDescription()).toBe(
      'Die Planung ist vollständig, der aktuelle Kodierfortschritt konnte aber nicht ermittelt werden. Aktualisieren Sie die Ansicht oder prüfen Sie die Kodierjobs.'
    );
  });

  it('should describe completed coding with pending applied results as ready for completion', () => {
    setCompletePlanningState();
    setCodingProgress(582, 582);
    setAppliedResults(581, 0, 581);

    expect(component.getPlanningStatusClass()).toBe('status-attention');
    expect(component.getPlanningStatusIcon()).toBe('published_with_changes');
    expect(component.getPlanningStatusTitle()).toBe('Bereit für den Abschluss');
    expect(component.getPlanningStatusDescription()).toBe(
      'Alle Kodierfälle sind abgeschlossen. Übernehmen Sie nun die Kodierergebnisse in den Datenbestand.'
    );
  });

  it('should describe applied results as complete', () => {
    setCompletePlanningState();
    setCodingProgress(582, 582);
    setAppliedResults(581, 581, 0);

    expect(component.getPlanningStatusClass()).toBe('status-complete');
    expect(component.getPlanningStatusIcon()).toBe('check_circle');
    expect(component.getPlanningStatusTitle()).toBe('Manuelle Kodierung abgeschlossen');
  });

  it('should hide second auto-coding work while manual coding is still open', () => {
    component.codingFreshnessSummary = {
      workspaceId: 1,
      currentRevision: 2,
      items: [
        {
          version: 'v1',
          state: 'PENDING',
          unitCount: 671,
          affectedResponseCount: 5098
        },
        {
          version: 'v3',
          state: 'PENDING',
          unitCount: 671,
          affectedResponseCount: 5098
        }
      ]
    };

    expect(component.hasCodingFreshnessWarnings).toBe(true);
    expect(component.manualCodingFreshnessPanelTitle).toBe('Auto-Coding starten');
    expect(component.manualCodingFreshnessSummaryText).toBe(
      '671 Aufgabenbearbeitungen benötigen Auto-Coding 1. ' +
      'Dabei werden 5098 Antwortwerte berücksichtigt.'
    );
    expect(component.codingFreshnessWarnings).toHaveLength(1);
    expect(component.getManualFreshnessChipLabel(component.codingFreshnessWarnings[0])).toBe(
      'Auto-Coding 1: 671 Aufgabenbearbeitungen starten'
    );
  });

  it('should not show second auto-coding as a manual planning warning before completion', () => {
    component.codingFreshnessSummary = {
      workspaceId: 1,
      currentRevision: 2,
      items: [
        {
          version: 'v3',
          state: 'PENDING',
          unitCount: 671,
          affectedResponseCount: 5098
        }
      ]
    };

    expect(component.hasCodingFreshnessWarnings).toBe(false);
    expect(component.manualCodingFreshnessPanelTitle).toBe('Kodierstand aktuell');
  });

  it('should show second auto-coding as the next step after manual coding is complete', () => {
    setCompletePlanningState();
    setCodingProgress(671, 671);
    setAppliedResults(5098, 5098, 0);
    component.codingFreshnessSummary = {
      workspaceId: 1,
      currentRevision: 2,
      items: [
        {
          version: 'v3',
          state: 'PENDING',
          unitCount: 671,
          affectedResponseCount: 5098
        }
      ]
    };

    expect(component.hasCodingFreshnessWarnings).toBe(true);
    expect(component.manualCodingFreshnessPanelTitle).toBe('Auto-Coding 2 bereit');
    expect(component.manualCodingFreshnessSummaryText).toBe(
      'Die manuelle Kodierung ist abgeschlossen. ' +
      'Auto-Coding 2 kann nun für 671 Aufgabenbearbeitungen gestartet oder aktualisiert werden. ' +
      'Das betrifft 5098 Antwortwerte.'
    );
    expect(component.manualCodingFreshnessExplanationText).toContain(
      'Starten Sie Auto-Coding 2 in der Kodierübersicht.'
    );
    expect(component.getManualFreshnessChipLabel(component.codingFreshnessWarnings[0])).toBe(
      'Auto-Coding 2: 671 Aufgabenbearbeitungen starten'
    );
  });

  it('should ignore zero-count freshness warnings in the manual banner', () => {
    component.codingFreshnessSummary = {
      workspaceId: 1,
      currentRevision: 2,
      items: [
        {
          version: 'v1',
          state: 'PENDING',
          unitCount: 0,
          affectedResponseCount: 0
        }
      ]
    };

    expect(component.hasCodingFreshnessWarnings).toBe(false);
    expect(component.manualCodingFreshnessPanelTitle).toBe('Kodierstand aktuell');
  });

  it('should refresh coding freshness after applying coding results', () => {
    const componentInternals = component as unknown as {
      refreshAfterApplyingCodingResults(): void;
      loadCodingFreshness(): void;
      refreshAllStatistics(): void;
      reloadCodingJobsList(): void;
    };
    const loadCodingFreshnessSpy = jest
      .spyOn(componentInternals, 'loadCodingFreshness')
      .mockImplementation();
    const refreshAllStatisticsSpy = jest
      .spyOn(componentInternals, 'refreshAllStatistics')
      .mockImplementation();
    const reloadCodingJobsListSpy = jest
      .spyOn(componentInternals, 'reloadCodingJobsList')
      .mockImplementation();

    componentInternals.refreshAfterApplyingCodingResults();

    expect(refreshAllStatisticsSpy).toHaveBeenCalled();
    expect(loadCodingFreshnessSpy).toHaveBeenCalled();
    expect(reloadCodingJobsListSpy).toHaveBeenCalled();
  });

  it('should not treat stale-source coding jobs as ready to apply', () => {
    const isCodingJobReadyForApply = (component as unknown as {
      isCodingJobReadyForApply(job: {
        status: string;
        freshnessStatus?: string;
        training?: { id?: number };
        training_id?: number;
      }): boolean;
    }).isCodingJobReadyForApply.bind(component);

    expect(isCodingJobReadyForApply({
      status: 'completed',
      freshnessStatus: 'review_required'
    })).toBe(true);
    expect(isCodingJobReadyForApply({
      status: 'completed',
      freshnessStatus: 'stale_source'
    })).toBe(false);
  });

  it('should calculate cases available for new job definitions separately from effective open cases', () => {
    component.codingIncompleteVariables = [
      {
        unitName: 'Unit 1',
        variableId: 'Var 1',
        responseCount: 100,
        uniqueCasesAfterAggregation: 80,
        availableCases: 78
      },
      {
        unitName: 'Unit 2',
        variableId: 'Var 2',
        responseCount: 5,
        uniqueCasesAfterAggregation: 5,
        availableCases: 0
      }
    ];

    expect(component.getAvailableCasesForNewJobs()).toBe(78);
    expect(component.getUnavailableCasesForNewJobs()).toBe(7);
  });

  it('should not show cached available cases when all effective cases are already assigned', () => {
    setCompletePlanningState();
    component.codingIncompleteVariables = [
      {
        unitName: 'Unit 1',
        variableId: 'Var 1',
        responseCount: 1215,
        uniqueCasesAfterAggregation: 1106,
        availableCases: 511
      }
    ];

    expect(component.caseCoverageOverview?.effectiveUnassignedCases).toBe(0);
    expect(component.getAvailableCasesForNewJobs()).toBe(0);
  });

  it('should guide users from incomplete planning to job definitions with available-case context', () => {
    setCompletePlanningState();
    component.caseCoverageOverview = {
      ...component.caseCoverageOverview!,
      effectiveCasesInJobs: 7,
      effectiveUnassignedCases: 3,
      coveragePercentage: 70
    };
    component.codingIncompleteVariables = [
      {
        unitName: 'Unit 1',
        variableId: 'Var 1',
        responseCount: 10,
        uniqueCasesAfterAggregation: 10,
        availableCases: 8
      }
    ];

    expect(component.getPlanningNextStepTitle()).toBe('Kodierfälle in Jobs verteilen');
    expect(component.getPlanningNextStepActionLabel()).toBe('Zu den Jobdefinitionen');
    expect(component.getPlanningNextStepTargetSection()).toBe('manual-planning');
    expect(component.getPlanningNextStepDescription()).toContain('3 Fälle sind noch nicht in Kodierjobs');
    expect(component.getPlanningNextStepDescription()).toContain('8 Fälle verfügbar');
    expect(component.getPlanningNextStepDescription()).toContain(
      '2 Fälle sind bereits in Jobs verteilt oder durch andere Definitionen reserviert'
    );
  });

  function setCompletePlanningState(): void {
    component.variableCoverageOverview = {
      totalVariables: 2,
      coveredVariables: 2,
      coveredByDraft: 0,
      coveredByPendingReview: 0,
      coveredByApproved: 2,
      conflictedVariables: 0,
      missingVariables: 0,
      partiallyAbgedeckteVariablen: 0,
      fullyAbgedeckteVariablen: 2,
      coveragePercentage: 100,
      variableCaseCounts: [],
      coverageByStatus: {
        draft: [],
        pending_review: [],
        approved: ['unit:variable'],
        conflicted: []
      }
    } satisfies VariableCoverageOverview;

    component.caseCoverageOverview = {
      totalCasesToCode: 10,
      effectiveTotalCasesToCode: 10,
      casesInJobs: 10,
      effectiveCasesInJobs: 10,
      doubleCodedCases: 0,
      singleCodedCases: 10,
      unassignedCases: 0,
      effectiveUnassignedCases: 0,
      coveragePercentage: 100,
      rawCoveragePercentage: 100,
      aggregationActive: false,
      aggregationThreshold: null,
      aggregatedDuplicateCases: 0
    } satisfies CaseCoverageOverview;
  }

  function setCodingProgress(totalCases: number, completedCases: number): void {
    const completionPercentage = totalCases > 0 ?
      (completedCases / totalCases) * 100 :
      100;

    component.codingProgressOverview = {
      totalCasesToCode: totalCases,
      completedCases,
      completionPercentage,
      rawTotalCasesToCode: totalCases,
      rawCompletedCases: completedCases,
      rawCompletionPercentage: completionPercentage,
      aggregationActive: false,
      aggregationThreshold: null,
      aggregatedDuplicateCases: 0
    } satisfies CodingProgressOverview;
  }

  function setAppliedResults(
    totalResponses: number,
    appliedResponses: number,
    remainingResponses: number
  ): void {
    const completionPercentage = totalResponses > 0 ?
      (appliedResponses / totalResponses) * 100 :
      100;

    component.appliedResultsOverview = {
      totalIncompleteResponses: totalResponses,
      appliedResponses,
      remainingResponses,
      completionPercentage,
      rawTotalIncompleteResponses: totalResponses,
      rawAppliedResponses: appliedResponses,
      rawCompletionPercentage: completionPercentage,
      aggregationActive: false,
      aggregationThreshold: null,
      aggregatedDuplicateCases: 0,
      totalIncompleteVariables: 1,
      finalStatusBreakdown: {
        codingComplete: appliedResponses,
        invalid: 0,
        codingError: 0,
        other: 0
      }
    } satisfies ManualAppliedResultsOverview;
  }
});
