import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import {
  Observable, of, Subject, throwError
} from 'rxjs';
import { CodingManagementManualComponent } from './coding-management-manual.component';
import { SERVER_URL } from '../../../injection-tokens';
import { environment } from '../../../../environments/environment';
import { ResponseMatchingFlag } from '../../../ws-admin/services/workspace-settings.service';
import { CoderService } from '../../services/coder.service';
import {
  createReplayAuthTokenError,
  ExportJobService
} from '../../../shared/services/file/export-job.service';
import { CohensKappaStatisticsComponent } from '../cohens-kappa-statistics/cohens-kappa-statistics.component';
import { ManualCodingExportDialogComponent } from '../manual-coding-export-dialog/manual-coding-export-dialog.component';
import type {
  ManualCodeAvailabilityWarningDto
} from '../../../../../../../api-dto/coding/manual-code-availability.dto';
import type {
  DuplicateValueGroupDto
} from '../../../../../../../api-dto/coding/response-analysis.dto';
import { DoubleCodedReviewComponent } from '../double-coded-review/double-coded-review.component';

type VariableCoverageOverview = NonNullable<
CodingManagementManualComponent['variableCoverageOverview']
>;
type CaseCoverageOverview = NonNullable<
CodingManagementManualComponent['caseCoverageOverview']
>;
type CodingProgressOverview = NonNullable<
CodingManagementManualComponent['codingProgressOverview']
>;
type ManualAppliedResultsOverview = NonNullable<
CodingManagementManualComponent['appliedResultsOverview']
>;

const createManualCodeAvailabilityWarning = (
  unitName: string,
  variableId: string
): ManualCodeAvailabilityWarningDto => ({
  unitName,
  variableId,
  responseCount: 5,
  casesInJobs: 0,
  availableCases: 5,
  uniqueCasesAfterAggregation: 5,
  regularCodeCount: 2,
  selectableRegularCodeCount: 0,
  onlySpecialOptionsAvailable: true,
  message: 'Variable hat keine regulären Codes mit manueller Instruktion.'
});

const createDuplicateValueGroup = (
  occurrenceCount: number | undefined,
  previewCount: number
): DuplicateValueGroupDto => {
  const group: DuplicateValueGroupDto = {
    unitName: 'Unit A',
    unitAlias: null,
    variableId: 'VAR_A',
    normalizedValue: 'same-answer',
    originalValue: 'same-answer',
    occurrences: Array.from({ length: previewCount }, (_, index) => ({
      personLogin: `person-${index + 1}`,
      personCode: `code-${index + 1}`,
      bookletName: 'Booklet A',
      responseId: index + 1,
      value: 'same-answer'
    }))
  };
  return occurrenceCount === undefined ? group : { ...group, occurrenceCount };
};

describe('CodingManagementManualComponent', () => {
  let component: CodingManagementManualComponent;
  let fixture: ComponentFixture<CodingManagementManualComponent>;

  const fakeActivatedRoute = {
    snapshot: { data: {}, queryParamMap: convertToParamMap({}) }
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
          provide: MatDialog,
          useValue: { open: jest.fn().mockReturnValue({ afterClosed: () => of(undefined) }) }
        },
        {
          provide: CoderService,
          useValue: {
            getCoders: jest.fn().mockReturnValue(of([])),
            getCodersForExport: jest.fn().mockReturnValue(of([]))
          }
        },
        {
          provide: ExportJobService,
          useValue: {
            startJob: jest.fn().mockReturnValue(of({ jobId: 'export-1' })),
            estimateJob: jest.fn().mockReturnValue(of({
              exportType: 'by-variable',
              unitVariableCount: 12,
              worksheetLimit: 1000,
              exceedsWorksheetLimit: false
            }))
          }
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
        'coding-progress': {
          'info-tooltip':
            'Erklärung zur Berechnung der Fortschrittswerte anzeigen',
          'info-total-title': 'Gesamt zu kodierende Fälle',
          'info-total-desc': 'Zählt die Basisanzahl eindeutiger Antworten.',
          'info-completed-title': 'Abgeschlossene Fälle',
          'info-completed-desc':
            'Zählt die Anzahl der eindeutigen abgeschlossenen Fälle.',
          'info-aggregation-title': 'Antwortwert-Aggregation, falls aktiv',
          'info-aggregation-desc':
            'Wenn Antwortwert-Aggregation aktiv ist, werden gleiche Antwortwerte pro Aufgabe/Variable gruppiert. Pro Gruppe wird ein Repräsentant in den Kodierjob gegeben; die Kodierung gilt anschließend für die zugehörigen Rohantworten. Abgeleitete Variablen werden nicht aggregiert.',
          'aggregation-note':
            'Antwortwert-Aggregation ist aktiv: {{rawCases}} Rohantworten werden zu {{effectiveCases}} effektiven Kodierfällen zusammengefasst. Dadurch müssen bei Schwelle {{threshold}} {{collapsedCases}} gleichwertige Rohantworten nicht separat manuell kodiert werden.',
          'analysis-aggregation-note':
            'Antwort-Analyse: {{rawCases}} Rohantworten ergeben {{effectiveCases}} effektive Kodierfälle.',
          'analysis-aggregation-savings':
            '{{collapsedCases}} gleichwertige Rohantworten werden in dieser Analyse nicht separat als Kodierfälle gezählt.'
        },
        freshness: {
          'second-autocoding-ready-title': 'Auto-Coding 2 bereit',
          'second-autocoding-ready-summary':
            'Die manuelle Kodierung ist abgeschlossen. Auto-Coding 2 kann nun für {{taskResults}} gestartet oder aktualisiert werden. Das betrifft {{responses}}.',
          'second-autocoding-ready-help':
            'Starten Sie Auto-Coding 2 in der Kodierübersicht. {{taskResultHelp}}'
        },
        'completed-jobs': {
          'readonly-note': 'Nur lesbar'
        },
        'response-analysis': {
          'outdated-note':
            'Diese Antwort-Analyse basiert auf {{analysisRawCases}} Rohantworten. Der aktuelle manuelle Vorbereitungsbestand umfasst {{referenceRawCases}} Rohantworten. Bitte neu berechnen; deshalb kann die hier gezeigte Einsparung von den Fortschrittswerten abweichen.',
          'rest-scope-note':
            'Diese Antwort-Analyse basiert auf {{analysisRawCases}} vorbereiteten Rohantworten. Der aktuelle Restbestand umfasst {{currentRawManualResponses}} Rohantworten, weil bereits Ergebnisse angewendet wurden oder Fälle nicht mehr separat gezählt werden.'
        },
        errors: {
          'replay-auth-token-failed':
            'Replay-Links konnten nicht vorbereitet werden, weil kein Auth-Token erstellt werden konnte. Exportjob wurde nicht gestartet.'
        },
        buttons: {
          'show-more-manual-code-warnings': '+{{count}} weitere anzeigen',
          'show-fewer-manual-code-warnings': 'Weniger anzeigen'
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

  it('keeps response matching option changes local until aggregation is started', () => {
    const componentInternals = component as unknown as {
      appService: { selectedWorkspaceId: number };
      testPersonCodingService: {
        saveAggregationSettings: (...args: unknown[]) => Observable<unknown>;
      };
      codingJobBackendService: {
        triggerResponseAnalysis: (...args: unknown[]) => Observable<void>;
      };
    };
    const appService = componentInternals.appService;
    const testPersonCodingService = componentInternals.testPersonCodingService;
    const codingJobBackendService = componentInternals.codingJobBackendService;

    appService.selectedWorkspaceId = 5;
    component.responseMatchingFlags = [ResponseMatchingFlag.NO_AGGREGATION];

    const saveSpy = jest
      .spyOn(testPersonCodingService, 'saveAggregationSettings')
      .mockReturnValue(of({ success: true }));
    const triggerSpy = jest
      .spyOn(codingJobBackendService, 'triggerResponseAnalysis')
      .mockReturnValue(of(undefined));

    component.toggleMatchingFlag(ResponseMatchingFlag.IGNORE_CASE);
    component.toggleMatchingFlag(ResponseMatchingFlag.IGNORE_WHITESPACE);

    expect(component.responseMatchingFlags).toEqual([
      ResponseMatchingFlag.NO_AGGREGATION,
      ResponseMatchingFlag.IGNORE_CASE,
      ResponseMatchingFlag.IGNORE_WHITESPACE
    ]);
    expect(component.hasPendingAggregationOptionsWithoutAggregation()).toBe(true);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it('preserves pending response matching options when the aggregation threshold is saved', () => {
    jest.useFakeTimers();
    try {
      const componentInternals = component as unknown as {
        appService: { selectedWorkspaceId: number };
        persistedResponseMatchingFlags: ResponseMatchingFlag[];
        testPersonCodingService: {
          saveAggregationSettings: (...args: unknown[]) => Observable<unknown>;
        };
        refreshAggregationDependentViews: (
          includeResponseAnalysis?: boolean
        ) => void;
      };
      const appService = componentInternals.appService;
      const testPersonCodingService = componentInternals.testPersonCodingService;

      appService.selectedWorkspaceId = 5;
      component.duplicateAggregationThreshold = 2;
      component.responseMatchingFlags = [
        ResponseMatchingFlag.NO_AGGREGATION,
        ResponseMatchingFlag.IGNORE_CASE,
        ResponseMatchingFlag.IGNORE_WHITESPACE
      ];
      componentInternals.persistedResponseMatchingFlags = [
        ResponseMatchingFlag.NO_AGGREGATION
      ];

      const saveSpy = jest
        .spyOn(testPersonCodingService, 'saveAggregationSettings')
        .mockReturnValue(
          of({
            success: true,
            threshold: 3,
            flags: [ResponseMatchingFlag.NO_AGGREGATION],
            aggregationActive: false,
            revertedResponses: 0,
            message: 'saved'
          })
        );
      jest
        .spyOn(componentInternals, 'refreshAggregationDependentViews')
        .mockImplementation(() => undefined);

      component.onThresholdChanged(3);
      jest.advanceTimersByTime(1000);

      expect(saveSpy).toHaveBeenCalledWith(5, 3, [
        ResponseMatchingFlag.NO_AGGREGATION
      ]);
      expect(component.responseMatchingFlags).toEqual([
        ResponseMatchingFlag.NO_AGGREGATION,
        ResponseMatchingFlag.IGNORE_CASE,
        ResponseMatchingFlag.IGNORE_WHITESPACE
      ]);
      expect(componentInternals.persistedResponseMatchingFlags).toEqual([
        ResponseMatchingFlag.NO_AGGREGATION
      ]);
      expect(component.hasPendingAggregationOptionsWithoutAggregation()).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores response matching changes while aggregation settings are saving', () => {
    const componentInternals = component as unknown as {
      appService: { selectedWorkspaceId: number };
    };

    componentInternals.appService.selectedWorkspaceId = 5;
    component.responseMatchingFlags = [
      ResponseMatchingFlag.NO_AGGREGATION,
      ResponseMatchingFlag.IGNORE_CASE
    ];
    component.isApplyingDuplicateAggregation = true;

    component.toggleMatchingFlag(ResponseMatchingFlag.IGNORE_WHITESPACE);
    component.onAggregationModeChanged(true);

    expect(component.responseMatchingFlags).toEqual([
      ResponseMatchingFlag.NO_AGGREGATION,
      ResponseMatchingFlag.IGNORE_CASE
    ]);
  });

  it('starts aggregation once with selected response matching options', () => {
    const componentInternals = component as unknown as {
      appService: { selectedWorkspaceId: number };
      persistedResponseMatchingFlags: ResponseMatchingFlag[];
      testPersonCodingService: {
        saveAggregationSettings: (...args: unknown[]) => Observable<unknown>;
      };
      codingJobBackendService: {
        triggerResponseAnalysis: (...args: unknown[]) => Observable<void>;
      };
      refreshAggregationDependentViews: (
        includeResponseAnalysis?: boolean
      ) => void;
    };
    const appService = componentInternals.appService;
    const testPersonCodingService = componentInternals.testPersonCodingService;
    const codingJobBackendService = componentInternals.codingJobBackendService;

    appService.selectedWorkspaceId = 5;
    component.duplicateAggregationThreshold = 2;
    component.responseMatchingFlags = [
      ResponseMatchingFlag.NO_AGGREGATION,
      ResponseMatchingFlag.IGNORE_CASE,
      ResponseMatchingFlag.IGNORE_WHITESPACE
    ];
    componentInternals.persistedResponseMatchingFlags = [
      ResponseMatchingFlag.NO_AGGREGATION
    ];

    const saveSpy = jest
      .spyOn(testPersonCodingService, 'saveAggregationSettings')
      .mockReturnValue(
        of({
          success: true,
          threshold: 2,
          flags: [
            ResponseMatchingFlag.IGNORE_CASE,
            ResponseMatchingFlag.IGNORE_WHITESPACE
          ],
          aggregationActive: true,
          revertedResponses: 0,
          message: 'saved'
        })
      );
    const triggerSpy = jest
      .spyOn(codingJobBackendService, 'triggerResponseAnalysis')
      .mockReturnValue(of(undefined));
    const refreshSpy = jest
      .spyOn(componentInternals, 'refreshAggregationDependentViews')
      .mockImplementation(() => undefined);
    const loadSpy = jest
      .spyOn(component, 'loadResponseAnalysis')
      .mockImplementation(() => undefined);

    component.onAggregationModeChanged(true);

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith(5, 2, [
      ResponseMatchingFlag.IGNORE_CASE,
      ResponseMatchingFlag.IGNORE_WHITESPACE
    ]);
    expect(triggerSpy).toHaveBeenCalledTimes(1);
    expect(triggerSpy).toHaveBeenCalledWith(5, 2);
    expect(component.responseMatchingFlags).toEqual([
      ResponseMatchingFlag.IGNORE_CASE,
      ResponseMatchingFlag.IGNORE_WHITESPACE
    ]);
    expect(componentInternals.persistedResponseMatchingFlags).toEqual([
      ResponseMatchingFlag.IGNORE_CASE,
      ResponseMatchingFlag.IGNORE_WHITESPACE
    ]);
    expect(refreshSpy).toHaveBeenCalledWith(false);
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it('rolls response matching flags back when starting aggregation fails', () => {
    const componentInternals = component as unknown as {
      appService: { selectedWorkspaceId: number };
      persistedResponseMatchingFlags: ResponseMatchingFlag[];
      testPersonCodingService: {
        saveAggregationSettings: (...args: unknown[]) => Observable<unknown>;
      };
      codingJobBackendService: {
        triggerResponseAnalysis: (...args: unknown[]) => Observable<void>;
      };
    };
    const appService = componentInternals.appService;
    const testPersonCodingService = componentInternals.testPersonCodingService;
    const codingJobBackendService = componentInternals.codingJobBackendService;

    appService.selectedWorkspaceId = 5;
    component.responseMatchingFlags = [
      ResponseMatchingFlag.NO_AGGREGATION,
      ResponseMatchingFlag.IGNORE_CASE
    ];
    componentInternals.persistedResponseMatchingFlags = [
      ResponseMatchingFlag.NO_AGGREGATION
    ];

    jest
      .spyOn(testPersonCodingService, 'saveAggregationSettings')
      .mockReturnValue(throwError(() => new Error('save failed')));
    const triggerSpy = jest
      .spyOn(codingJobBackendService, 'triggerResponseAnalysis')
      .mockReturnValue(of(undefined));

    component.onAggregationModeChanged(true);

    expect(component.responseMatchingFlags).toEqual([
      ResponseMatchingFlag.NO_AGGREGATION,
      ResponseMatchingFlag.IGNORE_CASE
    ]);
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it('allows retrying aggregation start after a failed save', () => {
    const componentInternals = component as unknown as {
      appService: { selectedWorkspaceId: number };
      persistedResponseMatchingFlags: ResponseMatchingFlag[];
      testPersonCodingService: {
        saveAggregationSettings: (...args: unknown[]) => Observable<unknown>;
      };
      codingJobBackendService: {
        triggerResponseAnalysis: (...args: unknown[]) => Observable<void>;
      };
      refreshAggregationDependentViews: (
        includeResponseAnalysis?: boolean
      ) => void;
    };
    const appService = componentInternals.appService;
    const testPersonCodingService = componentInternals.testPersonCodingService;
    const codingJobBackendService = componentInternals.codingJobBackendService;

    appService.selectedWorkspaceId = 5;
    component.duplicateAggregationThreshold = 2;
    component.responseMatchingFlags = [
      ResponseMatchingFlag.NO_AGGREGATION,
      ResponseMatchingFlag.IGNORE_CASE
    ];
    componentInternals.persistedResponseMatchingFlags = [
      ResponseMatchingFlag.NO_AGGREGATION
    ];

    const saveSpy = jest
      .spyOn(testPersonCodingService, 'saveAggregationSettings')
      .mockReturnValueOnce(throwError(() => new Error('save failed')))
      .mockReturnValueOnce(
        of({
          success: true,
          threshold: 2,
          flags: [ResponseMatchingFlag.IGNORE_CASE],
          aggregationActive: true,
          revertedResponses: 0,
          message: 'saved'
        })
      );
    const triggerSpy = jest
      .spyOn(codingJobBackendService, 'triggerResponseAnalysis')
      .mockReturnValue(of(undefined));
    jest
      .spyOn(componentInternals, 'refreshAggregationDependentViews')
      .mockImplementation(() => undefined);
    jest
      .spyOn(component, 'loadResponseAnalysis')
      .mockImplementation(() => undefined);

    component.onAggregationModeChanged(true);

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(component.responseMatchingFlags).toEqual([
      ResponseMatchingFlag.NO_AGGREGATION,
      ResponseMatchingFlag.IGNORE_CASE
    ]);
    expect(triggerSpy).not.toHaveBeenCalled();

    component.onAggregationModeChanged(true);

    expect(saveSpy).toHaveBeenCalledTimes(2);
    expect(saveSpy).toHaveBeenLastCalledWith(5, 2, [
      ResponseMatchingFlag.IGNORE_CASE
    ]);
    expect(component.responseMatchingFlags).toEqual([
      ResponseMatchingFlag.IGNORE_CASE
    ]);
    expect(triggerSpy).toHaveBeenCalledTimes(1);
  });

  it('uses occurrenceCount for duplicate occurrence totals when only a preview is loaded', () => {
    const previewOnlyGroup = createDuplicateValueGroup(12, 5);
    const legacyFullGroup = createDuplicateValueGroup(undefined, 8);

    expect(component.getDuplicateOccurrenceCount(previewOnlyGroup)).toBe(12);
    expect(
      component.getRemainingDuplicateOccurrenceCount(previewOnlyGroup)
    ).toBe(7);
    expect(component.getDuplicateOccurrenceCount(legacyFullGroup)).toBe(8);
    expect(
      component.getRemainingDuplicateOccurrenceCount(legacyFullGroup)
    ).toBe(3);
  });

  it('uses occurrenceCount for duplicate aggregation threshold checks', () => {
    const dialog = {
      open: jest.fn().mockReturnValue({ afterClosed: () => of(false) })
    };
    const componentInternals = component as unknown as {
      appService: { selectedWorkspaceId: number };
      dialog: typeof dialog;
    };

    componentInternals.dialog = dialog;
    componentInternals.appService.selectedWorkspaceId = 5;
    component.duplicateAggregationThreshold = 10;
    component.responseAnalysis = {
      emptyResponses: { total: 0, totalUncoded: 0, items: [] },
      duplicateValues: {
        total: 1,
        totalResponses: 12,
        groups: [createDuplicateValueGroup(12, 5)],
        isAggregationApplied: false
      },
      aggregationSummary: {
        duplicateGroups: 1,
        duplicateResponses: 12,
        collapsedCases: 11,
        rawCases: 12,
        effectiveCases: 1,
        threshold: 10,
        aggregationActive: false
      },
      matchingFlags: [],
      analysisTimestamp: new Date().toISOString()
    };

    component.onApplyDuplicateAggregation();

    expect(dialog.open).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        data: {
          duplicateGroups: 1,
          totalResponses: 12,
          threshold: 10
        }
      })
    );
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

  it('should flag response analysis as outdated when the status pool count changed', () => {
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
    setCodingProgress(973, 8);
    component.codingProgressOverview!.statusTotalCasesToCode = 973;

    expect(component.getCurrentRawManualResponses()).toBe(973);
    expect(component.getResponseAnalysisReferenceRawCases()).toBe(973);
    expect(component.isResponseAnalysisOutdated()).toBe(true);
  });

  it('should not require preparation refresh when only the applied result rest scope is smaller', () => {
    component.responseAnalysis = {
      emptyResponses: { total: 0, totalUncoded: 0, items: [] },
      duplicateValues: {
        total: 840,
        totalResponses: 5840,
        groups: [],
        isAggregationApplied: true
      },
      aggregationSummary: {
        duplicateGroups: 840,
        duplicateResponses: 5840,
        collapsedCases: 5000,
        rawCases: 21606,
        effectiveCases: 16606,
        threshold: 2,
        aggregationActive: true
      },
      matchingFlags: [],
      analysisTimestamp: new Date().toISOString()
    };
    setCodingProgress(16606, 12000);
    component.codingProgressOverview!.rawTotalCasesToCode = 17705;
    component.codingProgressOverview!.statusTotalCasesToCode = 21606;
    setAppliedResults(17705, 3901, 13804);

    expect(component.getCurrentRawManualResponses()).toBe(17705);
    expect(component.getResponseAnalysisReferenceRawCases()).toBe(21606);
    expect(component.isResponseAnalysisOutdated()).toBe(false);
    expect(component.hasResponseAnalysisRestScopeDifference()).toBe(true);
    expect(component.hasPreparationWarnings()).toBe(false);
    expect(component.isPreparationReady()).toBe(true);

    fixture.detectChanges();
    const pageText = fixture.nativeElement.textContent as string;
    expect(pageText).toContain(
      'Der aktuelle Restbestand umfasst 17705 Rohantworten'
    );
    expect(pageText).not.toContain(
      'Der aktuelle manuelle Vorbereitungsbestand umfasst'
    );
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
    expect(
      component.getCodingJobResultSummary(
        component.completedJobsReadyForApply[0]
      )
    ).toBe('5/5 Ergebnisse kodiert');
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

  it('should explain bulk apply keeps coding issue reviews open', () => {
    const dialogOpen = jest.fn().mockReturnValue({
      afterClosed: () => of(undefined)
    });
    const componentInternals = component as unknown as {
      appService: { selectedWorkspaceId: number };
      dialog: { open: jest.Mock };
    };
    const staleBulkApplySkipMessage = [
      'Jobs mit Kodierungsproblemen',
      'werden übersprungen'
    ].join(' ');
    componentInternals.appService.selectedWorkspaceId = 5;
    componentInternals.dialog = { open: dialogOpen };
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
    jest.spyOn(component, 'canApplyCompletedJobResults').mockReturnValue(true);

    component.applyAllCompletedJobResults();

    expect(dialogOpen).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({
          message: expect.stringContaining('offenen Kodierungshinweisen')
        })
      })
    );
    expect(dialogOpen).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({
          message: expect.stringContaining(staleBulkApplySkipMessage)
        })
      })
    );
  });

  it('should keep completed and review jobs with review issues ready for bulk apply', () => {
    const jobs = [
      {
        id: 1,
        workspace_id: 5,
        name: 'Job mit Hinweis',
        status: 'completed',
        created_at: new Date(),
        updated_at: new Date(),
        assignedCoders: [],
        totalUnits: 5,
        codedUnits: 5
      },
      {
        id: 2,
        workspace_id: 5,
        name: 'Job ohne Hinweis',
        status: 'review',
        created_at: new Date(),
        updated_at: new Date(),
        assignedCoders: [],
        totalUnits: 3,
        codedUnits: 3
      }
    ];
    const componentInternals = component as unknown as {
      appService: { selectedWorkspaceId: number };
      codingJobBackendService: {
        getCodingJobs: jest.Mock;
        getBulkCodingProgress: jest.Mock;
      };
      loadCompletedJobsReadyForApply: () => void;
    };
    componentInternals.appService.selectedWorkspaceId = 5;
    componentInternals.codingJobBackendService = {
      getCodingJobs: jest.fn().mockReturnValue(of({ data: jobs })),
      getBulkCodingProgress: jest.fn().mockReturnValue(of({
        1: {
          'person@code@booklet::booklet::UNIT::VAR': {
            id: -2
          }
        },
        2: {
          'person@code@booklet::booklet::UNIT::VAR': {
            id: 1
          }
        }
      }))
    };

    componentInternals.loadCompletedJobsReadyForApply();

    expect(component.completedJobsReadyForApply).toHaveLength(2);
    expect(component.completedJobsReadyForApply.map(job => job.id)).toEqual([1, 2]);
    expect(component.completedJobsReadyForApply[0].hasIssues).toBe(true);
    expect(component.completedJobsBlockedForReview.map(job => job.id)).toEqual([1]);
    expect(component.getCompletionActionTitle()).toContain('1 mit offenen Hinweisen');
  });

  it('should use parent apply permission when the coding jobs table is not rendered', () => {
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
    component.codingJobsComponent = undefined;

    component.canApplyManualCodingResults = false;
    expect(component.canShowCompletedJobApplyActions()).toBe(false);

    component.canApplyManualCodingResults = true;
    expect(component.canShowCompletedJobApplyActions()).toBe(true);
  });

  it('should hide the completion tab without study-manager permission', () => {
    component.canApplyManualCodingResults = false;
    component.selectedManualTabIndex = 4;
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

    expect(component.visibleManualCodingTabs).not.toContain('completion');
    expect(component.activeManualTab).toBe('preparation');

    const row = fixture.nativeElement.querySelector(
      '.completed-job-apply-row'
    ) as HTMLElement | null;
    const pageText = fixture.nativeElement.textContent as string;

    expect(row).toBeNull();
    expect(pageText).not.toContain('Abschluss');
    expect(pageText).not.toContain('Job 1');
  });

  it('should keep the completion tab available with study-manager permission', () => {
    component.canApplyManualCodingResults = true;

    expect(component.visibleManualCodingTabs).toContain('completion');

    component.goToManualTab('completion');

    expect(component.activeManualTab).toBe('completion');
  });

  it('blocks transfer action without coding-manager permission', () => {
    const openTransferCodingCasesDialog = jest.fn();
    const snackBar = TestBed.inject(MatSnackBar);
    (snackBar.open as jest.Mock).mockClear();
    component.canApplyManualCodingResults = false;
    component.canManageManualCodingJobs = false;
    component.codingJobsComponent = {
      openTransferCodingCasesDialog
    } as unknown as CodingManagementManualComponent['codingJobsComponent'];

    component.openExecutionTransferCases();

    expect(openTransferCodingCasesDialog).not.toHaveBeenCalled();
    expect(snackBar.open).toHaveBeenCalledWith(
      'Keine Berechtigung zum Verwalten von Kodierjobs.',
      'Schließen',
      {
        duration: 5000,
        panelClass: ['error-snackbar']
      }
    );
  });

  it('hides the execution transfer button without coding-manager permission', () => {
    component.selectedManualTabIndex = 3;
    component.canManageManualCodingJobs = false;

    fixture.detectChanges();

    const actionLabels = Array.from(
      fixture.nativeElement.querySelectorAll('.manual-tab-actions button')
    ).map(button => (button as HTMLButtonElement).textContent?.trim() ?? '');

    expect(actionLabels.some(label => label.includes('Export'))).toBe(true);
    expect(
      actionLabels.some(label => label.includes('Fälle übertragen'))
    ).toBe(false);
  });

  it('allows transfer action for coding managers without study-manager apply permission', () => {
    const openTransferCodingCasesDialog = jest.fn();
    const snackBar = TestBed.inject(MatSnackBar);
    (snackBar.open as jest.Mock).mockClear();
    component.canManageManualCodingJobs = true;
    component.canApplyManualCodingResults = false;
    component.codingJobsComponent = {
      openTransferCodingCasesDialog
    } as unknown as CodingManagementManualComponent['codingJobsComponent'];

    component.openExecutionTransferCases();

    expect(openTransferCodingCasesDialog).toHaveBeenCalled();
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('should describe complete planning with open coding work as ready for execution', () => {
    setCompletePlanningState();
    setCodingProgress(10, 4);
    setAppliedResults(10, 0, 10);

    expect(component.getPlanningStatusClass()).toBe('status-ready');
    expect(component.getPlanningStatusIcon()).toBe('play_circle');
    expect(component.getPlanningStatusTitle()).toBe(
      'Bereit für die Durchführung'
    );
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
    expect(component.getPlanningStatusTitle()).toBe(
      'Kodierfortschritt nicht verfügbar'
    );
    expect(component.getPlanningStatusDescription()).toBe(
      'Die Planung ist vollständig, der aktuelle Kodierfortschritt konnte aber nicht ermittelt werden. Aktualisieren Sie die Ansicht oder prüfen Sie die Kodierjobs.'
    );
  });

  it('should describe completed coding with pending applied results as ready for completion', () => {
    component.canApplyManualCodingResults = true;
    setCompletePlanningState();
    setCodingProgress(582, 582);
    setAppliedResults(581, 0, 581);

    expect(component.getPlanningStatusClass()).toBe('status-attention');
    expect(component.getPlanningStatusIcon()).toBe('published_with_changes');
    expect(component.getPlanningStatusTitle()).toBe('Bereit für den Abschluss');
    expect(component.getPlanningStatusDescription()).toBe(
      'Alle Kodierfälle sind abgeschlossen. Übernehmen Sie nun die Kodierergebnisse in den Datenbestand.'
    );
    expect(component.getPlanningNextStepTitle()).toBe('Ergebnisse übernehmen');
    expect(component.getPlanningNextStepDescription()).toBe(
      'Alle Kodierfälle sind bearbeitet. Übernehmen Sie jetzt die abgeschlossenen Ergebnisse in den Datenbestand.'
    );
  });

  it('should describe completed coding as read-only for coding managers', () => {
    component.canApplyManualCodingResults = false;
    setCompletePlanningState();
    setCodingProgress(582, 582);
    setAppliedResults(581, 0, 581);

    expect(component.getPlanningStatusClass()).toBe('status-attention');
    expect(component.getPlanningStatusIcon()).toBe('published_with_changes');
    expect(component.getPlanningStatusTitle()).toBe('Kodierfälle abgeschlossen');
    expect(component.getPlanningStatusDescription()).toBe(
      'Alle Kodierfälle sind abgeschlossen. Die Übernahme der Ergebnisse in den Datenbestand bleibt Studienmanager:innen vorbehalten.'
    );
    expect(component.getPlanningNextStepTitle()).toBe('Kodierjobs prüfen');
    expect(component.getPlanningNextStepDescription()).toBe(
      'Alle Kodierfälle sind bearbeitet. Sie können die abgeschlossenen Kodierjobs in der Durchführung einsehen.'
    );
  });

  it('should not describe empty progress snapshots as ready for completion', () => {
    setEmptyPlanningSnapshots();

    expect(component.getPlanningStatusClass()).toBe('status-ready');
    expect(component.getPlanningStatusIcon()).toBe('route');
    expect(component.getPlanningStatusTitle()).toBe('Bereit für die Planung');
    expect(component.getPlanningStatusDescription()).toBe(
      'Prüfen Sie die Antwortanalyse und erstellen Sie danach passende Kodierjob-Definitionen.'
    );
    expect(component.getPlanningNextStepTitle()).toBe(
      'Jobdefinition erstellen'
    );
    expect(component.getPlanningNextStepTargetTab()).toBe('planning');

    component.appliedResultsOverview = {
      ...component.appliedResultsOverview!,
      completionPercentage: 100,
      rawCompletionPercentage: 100
    } satisfies ManualAppliedResultsOverview;

    expect(component.getPlanningStatusTitle()).toBe('Bereit für die Planung');
    expect(component.getPlanningStatusDescription()).toBe(
      'Prüfen Sie die Antwortanalyse und erstellen Sie danach passende Kodierjob-Definitionen.'
    );
  });

  it('should describe applied results as complete', () => {
    setCompletePlanningState();
    setCodingProgress(582, 582);
    setAppliedResults(581, 581, 0);

    expect(component.getPlanningStatusClass()).toBe('status-complete');
    expect(component.getPlanningStatusIcon()).toBe('check_circle');
    expect(component.getPlanningStatusTitle()).toBe(
      'Manuelle Kodierung abgeschlossen'
    );
  });

  it('should warn when manual variables have no regular selectable codes', () => {
    setCompletePlanningState();
    setCodingProgress(10, 4);
    setAppliedResults(10, 0, 10);
    component.manualCodeAvailabilityWarnings = [
      createManualCodeAvailabilityWarning('UNIT1', 'VAR1')
    ];

    expect(component.hasManualCodeAvailabilityWarnings).toBe(true);
    expect(component.hasPlanningWarnings()).toBe(true);
    expect(component.getPlanningStatusClass()).toBe('status-attention');
    expect(component.getPlanningStatusIcon()).toBe('warning');
    expect(component.getPlanningStatusTitle()).toBe(
      'Reguläre Codes für manuelle Kodierung prüfen'
    );
    expect(component.getPlanningNextStepTitle()).toBe('Reguläre Codes ergänzen');
    expect(component.getPlanningNextStepActionLabel()).toBe(
      'Betroffene Variablen ansehen'
    );
    expect(component.getPlanningNextStepTargetSection()).toBe(
      'manual-variable-coverage'
    );

    fixture.detectChanges();

    const removedDuplicateBanner = fixture.nativeElement.querySelector(
      '.manual-code-availability-banner'
    ) as HTMLElement | null;
    const statusBanner = fixture.nativeElement.querySelector(
      '.planning-status-banner'
    ) as HTMLElement | null;
    expect(removedDuplicateBanner).toBeNull();
    expect(statusBanner?.textContent).toContain('UNIT1 / VAR1');
    expect(statusBanner?.textContent).toContain(
      'Reguläre Codes für manuelle Kodierung prüfen'
    );
  });

  it('should expand all manual code availability warnings from the status banner', () => {
    setCompletePlanningState();
    component.manualCodeAvailabilityWarnings = [
      createManualCodeAvailabilityWarning('UNIT1', 'VAR1'),
      createManualCodeAvailabilityWarning('UNIT2', 'VAR2'),
      createManualCodeAvailabilityWarning('UNIT3', 'VAR3'),
      createManualCodeAvailabilityWarning('UNIT4', 'VAR4'),
      createManualCodeAvailabilityWarning('UNIT5', 'VAR5'),
      createManualCodeAvailabilityWarning('UNIT6', 'VAR6'),
      createManualCodeAvailabilityWarning('UNIT7', 'VAR7')
    ];

    fixture.detectChanges();

    const statusBanner = fixture.nativeElement.querySelector(
      '.planning-status-banner'
    ) as HTMLElement;
    const toggleButton = statusBanner.querySelector(
      '.manual-code-availability-toggle'
    ) as HTMLButtonElement;

    expect(statusBanner.textContent).toContain('UNIT1 / VAR1');
    expect(statusBanner.textContent).toContain('UNIT5 / VAR5');
    expect(statusBanner.textContent).not.toContain('UNIT6 / VAR6');
    expect(toggleButton.textContent).toContain('+2 weitere anzeigen');
    expect(toggleButton.getAttribute('aria-expanded')).toBe('false');

    toggleButton.click();
    fixture.detectChanges();

    expect(statusBanner.textContent).toContain('UNIT6 / VAR6');
    expect(statusBanner.textContent).toContain('UNIT7 / VAR7');
    expect(toggleButton.textContent).toContain('Weniger anzeigen');
    expect(toggleButton.getAttribute('aria-expanded')).toBe('true');
  });

  it('should keep the affected variables scroll target while coverage is loading', () => {
    component.selectedManualTabIndex = component.manualCodingTabs.indexOf('planning');
    component.variableCoverageOverview = null;
    component.manualCodeAvailabilityWarnings = [
      createManualCodeAvailabilityWarning('UNIT1', 'VAR1')
    ];

    fixture.detectChanges();

    expect(component.getPlanningNextStepTargetSection()).toBe(
      'manual-variable-coverage'
    );
    expect(
      fixture.nativeElement.querySelector('#manual-variable-coverage')
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('.variable-coverage-section')
    ).toBeNull();
  });

  it('should explain raw status responses versus effective manual cases', () => {
    setCompletePlanningState();
    setCodingProgress(145, 25);
    component.codingProgressOverview = {
      ...component.codingProgressOverview!,
      statusTotalCasesToCode: 193
    };

    expect(component.getManualCaseScopeSummaryText()).toContain(
      '193 Rohantworten im Statuspool -> 145 effektive Arbeitsfälle'
    );
    expect(component.getManualCaseScopeSummaryText()).toContain(
      'davon 120 offen'
    );
    expect(component.getManualCaseScopeSummaryText()).toContain(
      '48 Rohantworten'
    );
  });

  it('should keep conflicts visually stronger than manual code availability warnings', () => {
    setCompletePlanningState();
    component.variableCoverageOverview = {
      ...component.variableCoverageOverview!,
      conflictedVariables: 1,
      coverageByStatus: {
        ...component.variableCoverageOverview!.coverageByStatus,
        conflicted: [
          {
            variableKey: 'UNIT1:VAR1',
            conflictingDefinitions: [
              { id: 1, status: 'approved' },
              { id: 2, status: 'approved' }
            ]
          }
        ]
      }
    };
    component.manualCodeAvailabilityWarnings = [
      createManualCodeAvailabilityWarning('UNIT1', 'VAR1')
    ];

    expect(component.getPlanningStatusClass()).toBe('status-warning');
    expect(component.getPlanningStatusTitle()).toBe('Konflikte prüfen');
    expect(component.getPlanningStatusDescription()).toContain(
      '1 Variablenkonflikte'
    );
    expect(component.getPlanningNextStepTitle()).toBe(
      'Konflikte zuerst klären'
    );
    expect(component.getPlanningNextStepActionLabel()).toBe(
      'Zu den Jobdefinitionen'
    );
    expect(component.getPlanningNextStepTargetSection()).toBe(
      'manual-planning'
    );
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
    expect(component.manualCodingFreshnessPanelTitle).toBe(
      'Auto-Coding starten'
    );
    expect(component.manualCodingFreshnessSummaryText).toBe(
      '671 Aufgabenbearbeitungen benötigen Auto-Coding 1. ' +
        'Dabei werden 5098 Antwortwerte berücksichtigt.'
    );
    expect(component.codingFreshnessWarnings).toHaveLength(1);
    expect(
      component.getManualFreshnessChipLabel(
        component.codingFreshnessWarnings[0]
      )
    ).toBe('Auto-Coding 1: 671 Aufgabenbearbeitungen starten');
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
    expect(component.manualCodingFreshnessPanelTitle).toBe(
      'Kodierstand aktuell'
    );
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
    expect(component.manualCodingFreshnessPanelTitle).toBe(
      'Auto-Coding 2 bereit'
    );
    expect(component.manualCodingFreshnessSummaryText).toBe(
      'Die manuelle Kodierung ist abgeschlossen. ' +
        'Auto-Coding 2 kann nun für 671 Aufgabenbearbeitungen gestartet oder aktualisiert werden. ' +
        'Das betrifft 5098 Antwortwerte.'
    );
    expect(component.manualCodingFreshnessExplanationText).toContain(
      'Starten Sie Auto-Coding 2 in der Kodierübersicht.'
    );
    expect(
      component.getManualFreshnessChipLabel(
        component.codingFreshnessWarnings[0]
      )
    ).toBe('Auto-Coding 2: 671 Aufgabenbearbeitungen starten');
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
    expect(component.manualCodingFreshnessPanelTitle).toBe(
      'Kodierstand aktuell'
    );
  });

  it('should refresh coding freshness after applying coding results', () => {
    const componentInternals = component as unknown as {
      refreshAfterApplyingCodingResults(): void;
      loadCodingFreshness(): void;
      refreshAllStatistics(): void;
      loadResponseAnalysis(): void;
      reloadCodingJobsList(): void;
      appService: { selectedWorkspaceId: number };
      testPersonCodingService: {
        notifyTestResultsChanged: jest.Mock;
      };
    };
    componentInternals.appService.selectedWorkspaceId = 5;
    const notifyTestResultsChangedSpy = jest
      .spyOn(componentInternals.testPersonCodingService, 'notifyTestResultsChanged')
      .mockImplementation();
    const loadCodingFreshnessSpy = jest
      .spyOn(componentInternals, 'loadCodingFreshness')
      .mockImplementation();
    const refreshAllStatisticsSpy = jest
      .spyOn(componentInternals, 'refreshAllStatistics')
      .mockImplementation();
    const reloadCodingJobsListSpy = jest
      .spyOn(componentInternals, 'reloadCodingJobsList')
      .mockImplementation();
    const loadResponseAnalysisSpy = jest
      .spyOn(componentInternals, 'loadResponseAnalysis')
      .mockImplementation();

    componentInternals.refreshAfterApplyingCodingResults();

    expect(notifyTestResultsChangedSpy).toHaveBeenCalledWith({
      workspaceId: 5,
      statisticsVersion: 'v2'
    });
    expect(refreshAllStatisticsSpy).toHaveBeenCalled();
    expect(loadResponseAnalysisSpy).toHaveBeenCalled();
    expect(loadCodingFreshnessSpy).toHaveBeenCalled();
    expect(reloadCodingJobsListSpy).toHaveBeenCalled();
  });

  it('should load all planning metrics when the planning tab is opened', () => {
    const componentInternals = component as unknown as {
      loadManualTabData(tab: 'planning'): void;
      loadVariableCoverageOverview(): void;
      loadCaseCoverageOverview(): void;
      loadCodingProgressOverview(): void;
      loadCodingIncompleteVariables(): void;
      loadCodingFreshness(): void;
      loadResponseAnalysis(): void;
    };
    const variableCoverageSpy = jest
      .spyOn(componentInternals, 'loadVariableCoverageOverview')
      .mockImplementation();
    const caseCoverageSpy = jest
      .spyOn(componentInternals, 'loadCaseCoverageOverview')
      .mockImplementation();
    const codingProgressSpy = jest
      .spyOn(componentInternals, 'loadCodingProgressOverview')
      .mockImplementation();
    const incompleteVariablesSpy = jest
      .spyOn(componentInternals, 'loadCodingIncompleteVariables')
      .mockImplementation();
    const loadCodingFreshnessSpy = jest
      .spyOn(componentInternals, 'loadCodingFreshness')
      .mockImplementation();
    const loadResponseAnalysisSpy = jest
      .spyOn(componentInternals, 'loadResponseAnalysis')
      .mockImplementation();

    componentInternals.loadManualTabData('planning');

    expect(variableCoverageSpy).toHaveBeenCalled();
    expect(caseCoverageSpy).toHaveBeenCalled();
    expect(codingProgressSpy).toHaveBeenCalled();
    expect(incompleteVariablesSpy).toHaveBeenCalled();
    expect(loadCodingFreshnessSpy).toHaveBeenCalled();
    expect(loadResponseAnalysisSpy).toHaveBeenCalled();
  });

  it('should wait for the auto-refresh setting before loading initial coding freshness', () => {
    const manualRefreshSetting$ = new Subject<boolean>();
    const isolatedFixture = TestBed.createComponent(CodingManagementManualComponent);
    const isolatedComponent = isolatedFixture.componentInstance;
    const componentInternals = isolatedComponent as unknown as {
      appService: { selectedWorkspaceId: number };
      workspaceSettingsService: {
        getAutoRefreshManualCodingJobs: (workspaceId: number) => Observable<boolean>;
      };
      loadCodersForExport(): void;
      loadJobDefinitionsForExport(): void;
      loadInitialManualCodingState(): void;
      loadManualCodingApplyPermission(): void;
      loadCodingFreshness(): void;
    };
    const previousWorkspaceId = componentInternals.appService.selectedWorkspaceId;
    const getSettingSpy = jest
      .spyOn(componentInternals.workspaceSettingsService, 'getAutoRefreshManualCodingJobs')
      .mockReturnValue(manualRefreshSetting$.asObservable());
    jest.spyOn(componentInternals, 'loadCodersForExport').mockImplementation();
    jest.spyOn(componentInternals, 'loadJobDefinitionsForExport').mockImplementation();
    jest.spyOn(componentInternals, 'loadInitialManualCodingState').mockImplementation();
    jest.spyOn(componentInternals, 'loadManualCodingApplyPermission').mockImplementation();
    const loadCodingFreshnessSpy = jest
      .spyOn(componentInternals, 'loadCodingFreshness')
      .mockImplementation();

    try {
      componentInternals.appService.selectedWorkspaceId = 5;

      isolatedComponent.ngOnInit();

      expect(getSettingSpy).toHaveBeenCalledWith(5);
      expect(loadCodingFreshnessSpy).not.toHaveBeenCalled();

      manualRefreshSetting$.next(true);

      expect(loadCodingFreshnessSpy).toHaveBeenCalledTimes(1);
    } finally {
      isolatedFixture.destroy();
      componentInternals.appService.selectedWorkspaceId = previousWorkspaceId;
      getSettingSpy.mockRestore();
    }
  });

  it('should skip initial coding freshness when auto-refresh is disabled', () => {
    const manualRefreshSetting$ = new Subject<boolean>();
    const isolatedFixture = TestBed.createComponent(CodingManagementManualComponent);
    const isolatedComponent = isolatedFixture.componentInstance;
    const componentInternals = isolatedComponent as unknown as {
      appService: { selectedWorkspaceId: number };
      workspaceSettingsService: {
        getAutoRefreshManualCodingJobs: (workspaceId: number) => Observable<boolean>;
      };
      loadCodersForExport(): void;
      loadJobDefinitionsForExport(): void;
      loadInitialManualCodingState(): void;
      loadManualCodingApplyPermission(): void;
      loadCodingFreshness(): void;
    };
    const previousWorkspaceId = componentInternals.appService.selectedWorkspaceId;
    const getSettingSpy = jest
      .spyOn(componentInternals.workspaceSettingsService, 'getAutoRefreshManualCodingJobs')
      .mockReturnValue(manualRefreshSetting$.asObservable());
    jest.spyOn(componentInternals, 'loadCodersForExport').mockImplementation();
    jest.spyOn(componentInternals, 'loadJobDefinitionsForExport').mockImplementation();
    jest.spyOn(componentInternals, 'loadInitialManualCodingState').mockImplementation();
    jest.spyOn(componentInternals, 'loadManualCodingApplyPermission').mockImplementation();
    const loadCodingFreshnessSpy = jest
      .spyOn(componentInternals, 'loadCodingFreshness')
      .mockImplementation();

    try {
      componentInternals.appService.selectedWorkspaceId = 5;

      isolatedComponent.ngOnInit();
      manualRefreshSetting$.next(false);

      expect(getSettingSpy).toHaveBeenCalledWith(5);
      expect(loadCodingFreshnessSpy).not.toHaveBeenCalled();
      expect(isolatedComponent.autoRefreshManualCodingJobs).toBe(false);
    } finally {
      isolatedFixture.destroy();
      componentInternals.appService.selectedWorkspaceId = previousWorkspaceId;
      getSettingSpy.mockRestore();
    }
  });

  it('should ignore duplicate tab change events for the active manual tab', () => {
    component.selectedManualTabIndex = 1;
    const componentInternals = component as unknown as {
      loadManualTabData(tab: 'planning'): void;
    };
    const loadManualTabDataSpy = jest
      .spyOn(componentInternals, 'loadManualTabData')
      .mockImplementation();

    component.onManualTabChanged(1);

    expect(loadManualTabDataSpy).not.toHaveBeenCalled();
  });

  it('should refresh the active manual workflow tab without reloading jobs when the window regains focus', () => {
    component.selectedManualTabIndex = 1;
    const componentInternals = component as unknown as {
      loadManualTabData(tab: 'planning', options?: { reloadCodingJobs?: boolean }): void;
      loadCodingFreshness(): void;
      reloadCodingJobsList(): void;
    };
    const loadManualTabDataSpy = jest
      .spyOn(componentInternals, 'loadManualTabData')
      .mockImplementation();
    const loadCodingFreshnessSpy = jest
      .spyOn(componentInternals, 'loadCodingFreshness')
      .mockImplementation();
    const reloadCodingJobsListSpy = jest
      .spyOn(componentInternals, 'reloadCodingJobsList')
      .mockImplementation();

    window.dispatchEvent(new Event('focus'));

    expect(loadManualTabDataSpy).toHaveBeenCalledWith(
      'planning',
      { reloadCodingJobs: false }
    );
    expect(loadCodingFreshnessSpy).not.toHaveBeenCalled();
    expect(reloadCodingJobsListSpy).not.toHaveBeenCalled();
  });

  it('should not refresh manual workflow tabs on focus when auto-refresh is disabled', () => {
    component.selectedManualTabIndex = 1;
    component.autoRefreshManualCodingJobs = false;
    const componentInternals = component as unknown as {
      loadManualTabData(tab: 'planning', options?: { reloadCodingJobs?: boolean }): void;
      loadCodingFreshness(): void;
    };
    const loadManualTabDataSpy = jest
      .spyOn(componentInternals, 'loadManualTabData')
      .mockImplementation();
    const loadCodingFreshnessSpy = jest
      .spyOn(componentInternals, 'loadCodingFreshness')
      .mockImplementation();

    window.dispatchEvent(new Event('focus'));

    expect(loadManualTabDataSpy).not.toHaveBeenCalled();
    expect(loadCodingFreshnessSpy).not.toHaveBeenCalled();
  });

  it('should not reload coding jobs twice when execution regains focus', () => {
    component.selectedManualTabIndex = 3;
    const componentInternals = component as unknown as {
      loadCodingFreshness(): void;
      loadCodingProgressOverview(): void;
      loadCaseCoverageOverview(): void;
      loadWorkspaceKappaSummary(): void;
      reloadCodingJobsList(): void;
    };
    const loadCodingFreshnessSpy = jest
      .spyOn(componentInternals, 'loadCodingFreshness')
      .mockImplementation();
    jest
      .spyOn(componentInternals, 'loadCodingProgressOverview')
      .mockImplementation();
    jest
      .spyOn(componentInternals, 'loadCaseCoverageOverview')
      .mockImplementation();
    jest
      .spyOn(componentInternals, 'loadWorkspaceKappaSummary')
      .mockImplementation();
    const reloadCodingJobsListSpy = jest
      .spyOn(componentInternals, 'reloadCodingJobsList')
      .mockImplementation();

    window.dispatchEvent(new Event('focus'));

    expect(loadCodingFreshnessSpy).toHaveBeenCalled();
    expect(reloadCodingJobsListSpy).not.toHaveBeenCalled();
  });

  it('should not refresh preparation on window focus', () => {
    component.selectedManualTabIndex = 0;
    const componentInternals = component as unknown as {
      refreshManualStateAfterExternalChange(): void;
    };
    const refreshSpy = jest
      .spyOn(componentInternals, 'refreshManualStateAfterExternalChange')
      .mockImplementation();

    window.dispatchEvent(new Event('focus'));

    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it('should open training reliability with available coder trainings', () => {
    const dialog = { open: jest.fn() };
    (component as unknown as { dialog: typeof dialog }).dialog = dialog;
    const training = { id: 7 };
    component.coderTrainingsListComponent = {
      originalData: [training],
      coderTrainings: [],
      openResultsComparison: jest.fn()
    } as unknown as CodingManagementManualComponent['coderTrainingsListComponent'];

    component.openTrainingReliability();

    expect(dialog.open).toHaveBeenCalledWith(
      CohensKappaStatisticsComponent,
      expect.objectContaining({
        data: {
          excludeTrainings: false,
          availableCoderTrainings: [training]
        }
      })
    );
  });

  it('should open execution reliability with cached job definitions when planning tab is not rendered', () => {
    const dialog = { open: jest.fn() };
    const componentInternals = component as unknown as {
      dialog: typeof dialog;
      jobDefinitionsForExport: Array<{
        id: number;
        status: 'approved';
        assignedVariables: unknown[];
        assignedVariableBundles: unknown[];
      }>;
      jobDefinitionsForExportWorkspaceId: number;
      hasLoadedJobDefinitionsForExport: boolean;
      appService: { selectedWorkspaceId: number };
    };
    componentInternals.dialog = dialog;
    componentInternals.appService.selectedWorkspaceId = 5;
    componentInternals.jobDefinitionsForExport = [
      {
        id: 11,
        status: 'approved',
        assignedVariables: [],
        assignedVariableBundles: []
      }
    ];
    componentInternals.jobDefinitionsForExportWorkspaceId = 5;
    componentInternals.hasLoadedJobDefinitionsForExport = true;
    component.codingJobDefinitionsComponent = undefined;

    component.openExecutionReliability();

    expect(dialog.open).toHaveBeenCalledWith(
      CohensKappaStatisticsComponent,
      expect.objectContaining({
        data: {
          excludeTrainings: true,
          scope: { jobDefinitionIds: [11] }
        }
      })
    );
  });

  it('should start execution exports with cached job definition scope when the dialog keeps defaults', () => {
    const exportJobService = TestBed.inject(ExportJobService);
    const dialog = {
      open: jest.fn().mockReturnValue({
        afterClosed: () => of({ exportType: 'detailed', includeReplayUrl: true })
      })
    };
    const componentInternals = component as unknown as {
      dialog: typeof dialog;
      jobDefinitionsForExport: Array<{
        id: number;
        status: 'approved';
        assignedVariables: unknown[];
        assignedVariableBundles: unknown[];
      }>;
      jobDefinitionsForExportWorkspaceId: number;
      hasLoadedJobDefinitionsForExport: boolean;
      codersForExportWorkspaceId: number;
      hasLoadedCodersForExport: boolean;
      appService: {
        selectedWorkspaceId: number;
        updateAuthData(authData: unknown): void;
      };
    };
    componentInternals.dialog = dialog;
    componentInternals.appService.selectedWorkspaceId = 5;
    componentInternals.appService.updateAuthData({ userId: 9 });
    componentInternals.jobDefinitionsForExport = [
      {
        id: 11,
        status: 'approved',
        assignedVariables: [],
        assignedVariableBundles: []
      }
    ];
    componentInternals.jobDefinitionsForExportWorkspaceId = 5;
    componentInternals.hasLoadedJobDefinitionsForExport = true;
    componentInternals.codersForExportWorkspaceId = 5;
    componentInternals.hasLoadedCodersForExport = true;
    component.codingJobDefinitionsComponent = undefined;

    component.openExecutionExport();

    expect(dialog.open).toHaveBeenCalledWith(
      ManualCodingExportDialogComponent,
      expect.objectContaining({
        data: expect.objectContaining({
          defaultJobDefinitionIds: [11],
          jobDefinitions: [
            expect.objectContaining({
              id: 11
            })
          ]
        })
      })
    );
    expect(exportJobService.startJob).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        exportType: 'detailed',
        userId: 9,
        includeReplayUrl: true,
        excludeAutoCoded: true,
        jobDefinitionIds: [11]
      })
    );
  });

  it('should label manual review exports by their double-coding method', () => {
    const exportJobService = TestBed.inject(ExportJobService) as unknown as {
      startJob: jest.Mock;
      estimateJob: jest.Mock;
    };
    const componentInternals = component as unknown as {
      startManualCodingExport: (
        context: 'training' | 'execution',
        result: {
          exportType: 'aggregated';
          doubleCodingMethod?: 'most-frequent' | 'new-column-per-coder' | 'new-row-per-variable';
          jobDefinitionIds: number[];
        }
      ) => void;
      appService: {
        selectedWorkspaceId: number;
        updateAuthData(authData: unknown): void;
      };
    };
    componentInternals.appService.selectedWorkspaceId = 5;
    componentInternals.appService.updateAuthData({ userId: 9 });
    exportJobService.startJob.mockClear();

    [
      {
        method: 'most-frequent' as const,
        displayLabelKey: 'export-toast.types.manual-review-most-frequent',
        downloadFilePrefix: 'manual-review-most-frequent'
      },
      {
        method: 'new-column-per-coder' as const,
        displayLabelKey: 'export-toast.types.manual-review-new-column-per-coder',
        downloadFilePrefix: 'manual-review-new-column-per-coder'
      },
      {
        method: 'new-row-per-variable' as const,
        displayLabelKey: 'export-toast.types.manual-review-new-row-per-variable',
        downloadFilePrefix: 'manual-review-new-row-per-variable'
      }
    ].forEach(({ method }) => {
      componentInternals.startManualCodingExport('execution', {
        exportType: 'aggregated',
        doubleCodingMethod: method,
        jobDefinitionIds: [11]
      });
    });

    expect(exportJobService.startJob).toHaveBeenNthCalledWith(
      1,
      5,
      expect.objectContaining({
        exportType: 'aggregated',
        doubleCodingMethod: 'most-frequent',
        displayLabelKey: 'export-toast.types.manual-review-most-frequent',
        downloadFilePrefix: 'manual-review-most-frequent'
      })
    );
    expect(exportJobService.startJob).toHaveBeenNthCalledWith(
      2,
      5,
      expect.objectContaining({
        exportType: 'aggregated',
        doubleCodingMethod: 'new-column-per-coder',
        displayLabelKey: 'export-toast.types.manual-review-new-column-per-coder',
        downloadFilePrefix: 'manual-review-new-column-per-coder'
      })
    );

    expect(exportJobService.estimateJob).toHaveBeenCalledTimes(1);
    expect(exportJobService.estimateJob).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        exportType: 'by-variable',
        excludeAutoCoded: true,
        jobDefinitionIds: [11]
      })
    );
    expect(exportJobService.startJob).toHaveBeenNthCalledWith(
      3,
      5,
      expect.objectContaining({
        exportType: 'aggregated',
        doubleCodingMethod: 'new-row-per-variable',
        displayLabelKey: 'export-toast.types.manual-review-new-row-per-variable',
        downloadFilePrefix: 'manual-review-new-row-per-variable'
      })
    );
  });

  it('warns before starting oversized new-row-per-variable exports', () => {
    const exportJobService = TestBed.inject(ExportJobService) as unknown as {
      startJob: jest.Mock;
      estimateJob: jest.Mock;
    };
    const dialog = TestBed.inject(MatDialog) as unknown as { open: jest.Mock };
    const componentInternals = component as unknown as {
      dialog: typeof dialog;
      startManualCodingExport: (
        context: 'training' | 'execution',
        result: {
          exportType: 'aggregated';
          doubleCodingMethod: 'new-row-per-variable';
          jobDefinitionIds: number[];
        }
      ) => void;
      appService: {
        selectedWorkspaceId: number;
        updateAuthData(authData: unknown): void;
      };
    };
    componentInternals.dialog = dialog;
    componentInternals.appService.selectedWorkspaceId = 5;
    componentInternals.appService.updateAuthData({ userId: 9 });
    exportJobService.estimateJob.mockReturnValue(of({
      exportType: 'by-variable',
      unitVariableCount: 2791,
      worksheetLimit: 1000,
      exceedsWorksheetLimit: true
    }));
    dialog.open.mockReturnValue({ afterClosed: () => of(false) });
    exportJobService.startJob.mockClear();

    componentInternals.startManualCodingExport('execution', {
      exportType: 'aggregated',
      doubleCodingMethod: 'new-row-per-variable',
      jobDefinitionIds: [11]
    });

    expect(exportJobService.startJob).not.toHaveBeenCalled();
    expect(dialog.open).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        data: expect.objectContaining({
          alternativeButtonValue: 'compact'
        })
      })
    );
  });

  it('starts the compact by-variable export from the oversized export warning', () => {
    const exportJobService = TestBed.inject(ExportJobService) as unknown as {
      startJob: jest.Mock;
      estimateJob: jest.Mock;
    };
    const dialog = TestBed.inject(MatDialog) as unknown as { open: jest.Mock };
    const componentInternals = component as unknown as {
      dialog: typeof dialog;
      startManualCodingExport: (
        context: 'training' | 'execution',
        result: {
          exportType: 'aggregated';
          doubleCodingMethod: 'new-row-per-variable';
          jobDefinitionIds: number[];
        }
      ) => void;
      appService: {
        selectedWorkspaceId: number;
        updateAuthData(authData: unknown): void;
      };
    };
    componentInternals.dialog = dialog;
    componentInternals.appService.selectedWorkspaceId = 5;
    componentInternals.appService.updateAuthData({ userId: 9 });
    exportJobService.estimateJob.mockReturnValue(of({
      exportType: 'by-variable',
      unitVariableCount: 2791,
      worksheetLimit: 1000,
      exceedsWorksheetLimit: true
    }));
    dialog.open.mockReturnValue({ afterClosed: () => of('compact') });
    exportJobService.startJob.mockClear();

    componentInternals.startManualCodingExport('execution', {
      exportType: 'aggregated',
      doubleCodingMethod: 'new-row-per-variable',
      jobDefinitionIds: [11]
    });

    expect(exportJobService.startJob).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        exportType: 'by-variable-compact',
        displayLabelKey: 'export-toast.types.by-variable-compact',
        downloadFilePrefix: 'manual-review-by-variable-compact',
        excludeAutoCoded: true,
        jobDefinitionIds: [11]
      })
    );
  });

  it('should show a specific error when replay export auth token creation fails', () => {
    const exportJobService = TestBed.inject(ExportJobService) as unknown as {
      startJob: jest.Mock;
    };
    const snackBar = TestBed.inject(MatSnackBar) as unknown as {
      open: jest.Mock;
    };
    const componentInternals = component as unknown as {
      startManualCodingExport: (
        context: 'training' | 'execution',
        result: {
          exportType: 'detailed';
          includeReplayUrl: true;
          jobDefinitionIds: number[];
        }
      ) => void;
      appService: {
        selectedWorkspaceId: number;
        updateAuthData(authData: unknown): void;
      };
    };
    componentInternals.appService.selectedWorkspaceId = 5;
    componentInternals.appService.updateAuthData({ userId: 9 });
    exportJobService.startJob.mockReturnValue(
      throwError(() => createReplayAuthTokenError())
    );

    componentInternals.startManualCodingExport('execution', {
      exportType: 'detailed',
      includeReplayUrl: true,
      jobDefinitionIds: [11]
    });

    expect(snackBar.open).toHaveBeenCalledWith(
      'Replay-Links konnten nicht vorbereitet werden, weil kein Auth-Token erstellt werden konnte. Exportjob wurde nicht gestartet.',
      'Schließen',
      {
        duration: 5000,
        panelClass: ['error-snackbar']
      }
    );
  });

  it('should wait for coder scope before opening execution export dialog', () => {
    const dialog = { open: jest.fn() };
    const componentInternals = component as unknown as {
      dialog: typeof dialog;
      jobDefinitionsForExport: Array<{
        id: number;
        status: 'approved';
        assignedVariables: unknown[];
        assignedVariableBundles: unknown[];
      }>;
      jobDefinitionsForExportWorkspaceId: number;
      hasLoadedJobDefinitionsForExport: boolean;
      codersForExportWorkspaceId?: number;
      hasLoadedCodersForExport: boolean;
      isLoadingCodersForExport: boolean;
      appService: {
        selectedWorkspaceId: number;
      };
    };
    componentInternals.dialog = dialog;
    componentInternals.appService.selectedWorkspaceId = 5;
    componentInternals.jobDefinitionsForExport = [
      {
        id: 11,
        status: 'approved',
        assignedVariables: [],
        assignedVariableBundles: []
      }
    ];
    componentInternals.jobDefinitionsForExportWorkspaceId = 5;
    componentInternals.hasLoadedJobDefinitionsForExport = true;
    componentInternals.codersForExportWorkspaceId = 5;
    componentInternals.hasLoadedCodersForExport = false;
    componentInternals.isLoadingCodersForExport = false;
    component.codingJobDefinitionsComponent = undefined;

    component.openExecutionExport();

    expect(dialog.open).not.toHaveBeenCalled();
    expect(componentInternals.hasLoadedCodersForExport).toBe(true);
  });

  it('should open training discussion in within-training mode', () => {
    const openResultsComparison = jest.fn();
    component.coderTrainingsListComponent = {
      originalData: [],
      coderTrainings: [],
      openResultsComparison
    } as unknown as CodingManagementManualComponent['coderTrainingsListComponent'];

    component.openTrainingDiscussion();

    expect(openResultsComparison).toHaveBeenCalledWith(
      undefined,
      'within-training'
    );
  });

  it('should open training comparison in between-trainings mode', () => {
    const openResultsComparison = jest.fn();
    component.coderTrainingsListComponent = {
      openResultsComparison
    } as unknown as CodingManagementManualComponent['coderTrainingsListComponent'];

    component.openTrainingComparison();

    expect(openResultsComparison).toHaveBeenCalledWith(
      undefined,
      'between-trainings'
    );
  });

  it('should switch to the execution tab before scrolling to execution work', () => {
    jest.useFakeTimers();
    try {
      setCompletePlanningState();
      setCodingProgress(10, 4);
      setAppliedResults(10, 0, 10);
      component.selectedManualTabIndex = 1;

      const componentInternals = component as unknown as {
        loadManualTabData(tab: 'execution'): void;
      };
      const loadManualTabDataSpy = jest
        .spyOn(componentInternals, 'loadManualTabData')
        .mockImplementation();
      const scrollToSectionSpy = jest
        .spyOn(component, 'scrollToSection')
        .mockImplementation();

      component.performPlanningNextStep();

      expect(component.getPlanningNextStepTargetTab()).toBe('execution');
      expect(component.selectedManualTabIndex).toBe(3);
      expect(loadManualTabDataSpy).toHaveBeenCalledWith('execution');
      expect(scrollToSectionSpy).not.toHaveBeenCalled();

      jest.runOnlyPendingTimers();

      expect(scrollToSectionSpy).toHaveBeenCalledWith('manual-execution');
    } finally {
      jest.useRealTimers();
    }
  });

  it('should switch to the completion tab before scrolling to completion work', () => {
    jest.useFakeTimers();
    try {
      component.canApplyManualCodingResults = true;
      setCompletePlanningState();
      setCodingProgress(582, 582);
      setAppliedResults(581, 0, 581);
      component.selectedManualTabIndex = 1;

      const componentInternals = component as unknown as {
        loadManualTabData(tab: 'completion'): void;
      };
      const loadManualTabDataSpy = jest
        .spyOn(componentInternals, 'loadManualTabData')
        .mockImplementation();
      const scrollToSectionSpy = jest
        .spyOn(component, 'scrollToSection')
        .mockImplementation();

      component.performPlanningNextStep();

      expect(component.getPlanningNextStepTargetTab()).toBe('completion');
      expect(component.selectedManualTabIndex).toBe(4);
      expect(loadManualTabDataSpy).toHaveBeenCalledWith('completion');

      jest.runOnlyPendingTimers();

      expect(scrollToSectionSpy).toHaveBeenCalledWith('manual-completion');
    } finally {
      jest.useRealTimers();
    }
  });

  it('should focus manual freshness work on execution when open coding cases remain', () => {
    jest.useFakeTimers();
    try {
      setCompletePlanningState();
      setCodingProgress(10, 4);
      setAppliedResults(10, 0, 10);
      component.selectedManualTabIndex = 0;

      const componentInternals = component as unknown as {
        pendingManualFreshnessFocus: boolean;
        manualFreshnessPlanningRequested: boolean;
        requestManualFreshnessFocusIfNeeded(): void;
        loadManualTabData(tab: 'planning' | 'execution'): void;
      };
      componentInternals.pendingManualFreshnessFocus = true;
      componentInternals.manualFreshnessPlanningRequested = false;
      const loadManualTabDataSpy = jest
        .spyOn(componentInternals, 'loadManualTabData')
        .mockImplementation();
      const scrollToSectionSpy = jest
        .spyOn(component, 'scrollToSection')
        .mockImplementation();

      componentInternals.requestManualFreshnessFocusIfNeeded();

      expect(component.selectedManualTabIndex).toBe(3);
      expect(loadManualTabDataSpy).toHaveBeenNthCalledWith(1, 'planning');
      expect(loadManualTabDataSpy).toHaveBeenNthCalledWith(2, 'execution');

      jest.runOnlyPendingTimers();

      expect(scrollToSectionSpy).toHaveBeenCalledWith('manual-execution');
    } finally {
      jest.useRealTimers();
    }
  });

  it('should focus manual freshness work on completion when all cases are coded', () => {
    jest.useFakeTimers();
    try {
      component.canApplyManualCodingResults = true;
      setCompletePlanningState();
      setCodingProgress(10, 10);
      setAppliedResults(10, 0, 10);
      component.selectedManualTabIndex = 0;

      const componentInternals = component as unknown as {
        pendingManualFreshnessFocus: boolean;
        manualFreshnessPlanningRequested: boolean;
        requestManualFreshnessFocusIfNeeded(): void;
        loadManualTabData(tab: 'planning' | 'completion'): void;
      };
      componentInternals.pendingManualFreshnessFocus = true;
      componentInternals.manualFreshnessPlanningRequested = false;
      const loadManualTabDataSpy = jest
        .spyOn(componentInternals, 'loadManualTabData')
        .mockImplementation();
      const scrollToSectionSpy = jest
        .spyOn(component, 'scrollToSection')
        .mockImplementation();

      componentInternals.requestManualFreshnessFocusIfNeeded();

      expect(component.selectedManualTabIndex).toBe(4);
      expect(loadManualTabDataSpy).toHaveBeenNthCalledWith(1, 'planning');
      expect(loadManualTabDataSpy).toHaveBeenNthCalledWith(2, 'completion');

      jest.runOnlyPendingTimers();

      expect(scrollToSectionSpy).toHaveBeenCalledWith('manual-completion');
    } finally {
      jest.useRealTimers();
    }
  });

  it('should wait for applied results before focusing completed manual freshness work', () => {
    jest.useFakeTimers();
    try {
      component.canApplyManualCodingResults = true;
      setCompletePlanningState();
      setCodingProgress(10, 10);
      component.appliedResultsOverview = null;
      component.isLoadingAppliedResultsOverview = true;
      component.selectedManualTabIndex = 0;

      const componentInternals = component as unknown as {
        pendingManualFreshnessFocus: boolean;
        manualFreshnessPlanningRequested: boolean;
        requestManualFreshnessFocusIfNeeded(): void;
        focusManualFreshnessTargetIfReady(): void;
        loadManualTabData(tab: 'planning' | 'completion'): void;
      };
      componentInternals.pendingManualFreshnessFocus = true;
      componentInternals.manualFreshnessPlanningRequested = false;
      const loadManualTabDataSpy = jest
        .spyOn(componentInternals, 'loadManualTabData')
        .mockImplementation();
      const scrollToSectionSpy = jest
        .spyOn(component, 'scrollToSection')
        .mockImplementation();

      componentInternals.requestManualFreshnessFocusIfNeeded();

      expect(component.selectedManualTabIndex).toBe(1);
      expect(loadManualTabDataSpy).toHaveBeenCalledTimes(1);
      expect(loadManualTabDataSpy).toHaveBeenCalledWith('planning');
      expect(scrollToSectionSpy).not.toHaveBeenCalled();

      setAppliedResults(10, 0, 10);
      component.isLoadingAppliedResultsOverview = false;
      componentInternals.focusManualFreshnessTargetIfReady();

      expect(component.selectedManualTabIndex).toBe(4);
      expect(loadManualTabDataSpy).toHaveBeenNthCalledWith(2, 'completion');

      jest.runOnlyPendingTimers();

      expect(scrollToSectionSpy).toHaveBeenCalledWith('manual-completion');
    } finally {
      jest.useRealTimers();
    }
  });

  it('should wait for incomplete variables before focusing completed manual freshness work', () => {
    jest.useFakeTimers();
    try {
      component.canApplyManualCodingResults = true;
      setCompletePlanningState();
      setCodingProgress(10, 10);
      component.appliedResultsOverview = null;
      component.isLoadingCodingIncompleteVariables = true;
      component.isLoadingAppliedResultsOverview = false;
      component.selectedManualTabIndex = 0;

      const componentInternals = component as unknown as {
        pendingManualFreshnessFocus: boolean;
        manualFreshnessPlanningRequested: boolean;
        requestManualFreshnessFocusIfNeeded(): void;
        focusManualFreshnessTargetIfReady(): void;
        loadManualTabData(tab: 'planning' | 'completion'): void;
      };
      componentInternals.pendingManualFreshnessFocus = true;
      componentInternals.manualFreshnessPlanningRequested = false;
      const loadManualTabDataSpy = jest
        .spyOn(componentInternals, 'loadManualTabData')
        .mockImplementation();
      const scrollToSectionSpy = jest
        .spyOn(component, 'scrollToSection')
        .mockImplementation();

      componentInternals.requestManualFreshnessFocusIfNeeded();

      expect(component.selectedManualTabIndex).toBe(1);
      expect(loadManualTabDataSpy).toHaveBeenCalledTimes(1);
      expect(loadManualTabDataSpy).toHaveBeenCalledWith('planning');
      expect(scrollToSectionSpy).not.toHaveBeenCalled();

      component.isLoadingCodingIncompleteVariables = false;
      component.isLoadingAppliedResultsOverview = true;
      componentInternals.focusManualFreshnessTargetIfReady();

      expect(component.selectedManualTabIndex).toBe(1);
      expect(loadManualTabDataSpy).toHaveBeenCalledTimes(1);
      expect(scrollToSectionSpy).not.toHaveBeenCalled();

      setAppliedResults(10, 0, 10);
      component.isLoadingAppliedResultsOverview = false;
      componentInternals.focusManualFreshnessTargetIfReady();

      expect(component.selectedManualTabIndex).toBe(4);
      expect(loadManualTabDataSpy).toHaveBeenNthCalledWith(2, 'completion');

      jest.runOnlyPendingTimers();

      expect(scrollToSectionSpy).toHaveBeenCalledWith('manual-completion');
    } finally {
      jest.useRealTimers();
    }
  });

  it('should route manual freshness targets by the detailed priority order', () => {
    component.canApplyManualCodingResults = true;
    setCompletePlanningState();
    setCodingProgress(10, 10);
    setAppliedResults(10, 0, 10);
    setManualFreshnessJobSummary({
      activeTrainingJobs: 1,
      openProductiveJobs: 1,
      completedProductiveJobs: 1,
      staleSourceJobs: 1
    }, 3);
    component.responseAnalysis = {
      emptyResponses: { total: 0, totalUncoded: 0, items: [] },
      duplicateValues: {
        total: 1,
        totalResponses: 2,
        groups: [],
        isAggregationApplied: false
      },
      aggregationSummary: {
        duplicateGroups: 1,
        duplicateResponses: 2,
        collapsedCases: 0,
        rawCases: 10,
        effectiveCases: 10,
        threshold: 2,
        aggregationActive: false
      },
      matchingFlags: ['NO_AGGREGATION'],
      analysisTimestamp: new Date().toISOString()
    };

    expect(component.getPlanningNextStepTargetTab()).toBe('preparation');
    expect(component.getPlanningNextStepTargetSection()).toBe('manual-preparation');

    component.responseAnalysis = null;
    component.caseCoverageOverview = {
      ...component.caseCoverageOverview!,
      effectiveUnassignedCases: 2
    };

    expect(component.getPlanningNextStepTargetTab()).toBe('planning');
    expect(component.getPlanningNextStepTargetSection()).toBe('manual-planning');

    component.caseCoverageOverview = {
      ...component.caseCoverageOverview!,
      effectiveUnassignedCases: 0
    };

    expect(component.getPlanningNextStepTargetTab()).toBe('training');
    expect(component.getPlanningNextStepTargetSection()).toBe('manual-support');

    setManualFreshnessJobSummary({
      activeTrainingJobs: 0,
      openProductiveJobs: 1,
      completedProductiveJobs: 1,
      staleSourceJobs: 1
    }, 3);

    expect(component.getPlanningNextStepTargetTab()).toBe('execution');
    expect(component.getPlanningNextStepActionLabel()).toBe('Zu den Kodierjobs');

    setManualFreshnessJobSummary({
      activeTrainingJobs: 0,
      openProductiveJobs: 0,
      completedProductiveJobs: 1,
      staleSourceJobs: 1
    }, 3);

    expect(component.getPlanningNextStepTargetTab()).toBe('execution');
    expect(component.getPlanningNextStepActionLabel()).toBe(
      'Doppelkodierungsreview öffnen'
    );

    setManualFreshnessJobSummary({
      activeTrainingJobs: 0,
      openProductiveJobs: 0,
      completedProductiveJobs: 1,
      staleSourceJobs: 1
    }, 0);

    expect(component.getPlanningNextStepTargetTab()).toBe('execution');
    expect(component.getPlanningNextStepActionLabel()).toBe(
      'Veraltete Jobs prüfen'
    );

    setManualFreshnessJobSummary({
      activeTrainingJobs: 0,
      openProductiveJobs: 0,
      completedProductiveJobs: 1,
      staleSourceJobs: 0
    }, 0);

    expect(component.getPlanningNextStepTargetTab()).toBe('completion');
    expect(component.getPlanningNextStepTargetSection()).toBe('manual-completion');
  });

  it('should open the double-coding review dialog for the freshness target', () => {
    jest.useFakeTimers();
    try {
      component.canApplyManualCodingResults = true;
      setCompletePlanningState();
      setCodingProgress(10, 10);
      setAppliedResults(10, 0, 10);
      setManualFreshnessJobSummary({
        activeTrainingJobs: 0,
        openProductiveJobs: 0,
        completedProductiveJobs: 1,
        staleSourceJobs: 0
      }, 2);
      component.selectedManualTabIndex = component.manualCodingTabs.indexOf('planning');

      const dialog = {
        open: jest.fn().mockReturnValue({ afterClosed: () => of(undefined) })
      };
      (component as unknown as { dialog: typeof dialog }).dialog = dialog;
      const scrollToSectionSpy = jest
        .spyOn(component, 'scrollToSection')
        .mockImplementation();

      component.performPlanningNextStep();

      expect(component.selectedManualTabIndex).toBe(3);
      expect(scrollToSectionSpy).not.toHaveBeenCalled();

      jest.runOnlyPendingTimers();

      expect(scrollToSectionSpy).toHaveBeenCalledWith('manual-execution');
      expect(dialog.open).toHaveBeenCalledWith(
        DoubleCodedReviewComponent,
        expect.objectContaining({
          width: '98vw',
          height: '95vh'
        })
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('should wait for manual freshness job data before focusing the detailed target', () => {
    jest.useFakeTimers();
    try {
      setCompletePlanningState();
      setCodingProgress(10, 10);
      setAppliedResults(10, 0, 10);
      component.selectedManualTabIndex = 0;
      component.isLoadingManualFreshnessJobSummary = true;

      const componentInternals = component as unknown as {
        pendingManualFreshnessFocus: boolean;
        manualFreshnessPlanningRequested: boolean;
        requestManualFreshnessFocusIfNeeded(): void;
        focusManualFreshnessTargetIfReady(): void;
        loadManualTabData(tab: 'planning' | 'training'): void;
      };
      componentInternals.pendingManualFreshnessFocus = true;
      componentInternals.manualFreshnessPlanningRequested = false;
      const loadManualTabDataSpy = jest
        .spyOn(componentInternals, 'loadManualTabData')
        .mockImplementation();
      const scrollToSectionSpy = jest
        .spyOn(component, 'scrollToSection')
        .mockImplementation();

      componentInternals.requestManualFreshnessFocusIfNeeded();

      expect(component.selectedManualTabIndex).toBe(1);
      expect(loadManualTabDataSpy).toHaveBeenCalledTimes(1);
      expect(scrollToSectionSpy).not.toHaveBeenCalled();

      setManualFreshnessJobSummary({
        activeTrainingJobs: 1,
        openProductiveJobs: 0,
        completedProductiveJobs: 0,
        staleSourceJobs: 0
      }, 0);
      component.isLoadingManualFreshnessJobSummary = false;
      componentInternals.focusManualFreshnessTargetIfReady();

      expect(component.selectedManualTabIndex).toBe(2);
      expect(loadManualTabDataSpy).toHaveBeenNthCalledWith(2, 'training');

      jest.runOnlyPendingTimers();

      expect(scrollToSectionSpy).toHaveBeenCalledWith('manual-support');
    } finally {
      jest.useRealTimers();
    }
  });

  it('should skip double-coding summary while productive manual jobs are open', () => {
    const getDoubleCodedVariablesForReview = jest.fn().mockReturnValue(of({
      data: [],
      total: 5
    }));
    const componentInternals = component as unknown as {
      appService: { selectedWorkspaceId: number };
      codingJobBackendService: {
        getCodingJobs: jest.Mock;
      };
      testPersonCodingService: {
        getDoubleCodedVariablesForReview: jest.Mock;
      };
      openDoubleCodingConflictCount: number;
      loadManualFreshnessDecisionData(): void;
    };
    componentInternals.appService.selectedWorkspaceId = 5;
    componentInternals.codingJobBackendService = {
      getCodingJobs: jest.fn().mockReturnValue(of({
        data: [{
          id: 1,
          workspace_id: 5,
          name: 'Offener produktiver Job',
          status: 'open',
          created_at: new Date(),
          updated_at: new Date(),
          assignedCoders: [],
          totalUnits: 10,
          openUnits: 2,
          codedUnits: 8
        }]
      }))
    };
    componentInternals.testPersonCodingService = {
      getDoubleCodedVariablesForReview
    };
    component.isLoadingDoubleCodingConflictSummary = true;
    componentInternals.openDoubleCodingConflictCount = 4;

    componentInternals.loadManualFreshnessDecisionData();

    expect(getDoubleCodedVariablesForReview).not.toHaveBeenCalled();
    expect(component.isLoadingManualFreshnessJobSummary).toBe(false);
    expect(component.isLoadingDoubleCodingConflictSummary).toBe(false);
    expect(componentInternals.openDoubleCodingConflictCount).toBe(0);
  });

  it('should not keep response analysis loading during initial settings load', () => {
    const componentInternals = component as unknown as {
      appService: { selectedWorkspaceId: number };
      testPersonCodingService: {
        getAggregationSettings: jest.Mock;
      };
      loadInitialManualCodingState(): void;
      loadManualTabData(tab: 'preparation' | 'planning' | 'training' | 'execution' | 'completion'): void;
    };
    componentInternals.appService.selectedWorkspaceId = 5;
    componentInternals.testPersonCodingService = {
      getAggregationSettings: jest.fn().mockReturnValue(of({
        flags: [ResponseMatchingFlag.NO_AGGREGATION],
        threshold: 2
      }))
    };
    jest.spyOn(componentInternals, 'loadManualTabData').mockImplementation();

    component.isLoadingResponseAnalysis = false;
    componentInternals.loadInitialManualCodingState();

    expect(component.isLoadingMatchingMode).toBe(false);
    expect(component.isLoadingResponseAnalysis).toBe(false);
  });

  it('should count pending jobs with assigned units as active manual freshness jobs', () => {
    const buildManualFreshnessJobSummary = (
      component as unknown as {
        buildManualFreshnessJobSummary(jobs: Array<{
          status: string;
          totalUnits?: number;
          openUnits?: number;
          codedUnits?: number;
          training_id?: number;
        }>): {
          activeTrainingJobs: number;
          openProductiveJobs: number;
          completedProductiveJobs: number;
          staleSourceJobs: number;
        };
      }
    ).buildManualFreshnessJobSummary.bind(component);

    const summary = buildManualFreshnessJobSummary([
      {
        status: 'pending',
        totalUnits: 3,
        openUnits: 0,
        codedUnits: 0,
        training_id: 1
      },
      {
        status: 'pending',
        totalUnits: 4,
        openUnits: 0,
        codedUnits: 0
      },
      {
        status: 'results_applied',
        totalUnits: 5,
        openUnits: 0,
        codedUnits: 5
      }
    ]);

    expect(summary).toEqual({
      activeTrainingJobs: 1,
      openProductiveJobs: 1,
      completedProductiveJobs: 0,
      staleSourceJobs: 0
    });
  });

  it('should keep coding managers away from the hidden completion tab', () => {
    jest.useFakeTimers();
    try {
      component.canApplyManualCodingResults = false;
      setCompletePlanningState();
      setCodingProgress(582, 582);
      setAppliedResults(581, 0, 581);
      component.selectedManualTabIndex = 1;

      const componentInternals = component as unknown as {
        loadManualTabData(tab: 'execution'): void;
      };
      const loadManualTabDataSpy = jest
        .spyOn(componentInternals, 'loadManualTabData')
        .mockImplementation();
      const scrollToSectionSpy = jest
        .spyOn(component, 'scrollToSection')
        .mockImplementation();

      expect(component.visibleManualCodingTabs).not.toContain('completion');
      expect(component.getPlanningNextStepTargetTab()).toBe('execution');
      expect(component.getPlanningNextStepActionLabel()).toBe('Zu den Kodierjobs');

      component.performPlanningNextStep();

      expect(component.selectedManualTabIndex).toBe(3);
      expect(loadManualTabDataSpy).toHaveBeenCalledWith('execution');

      jest.runOnlyPendingTimers();

      expect(scrollToSectionSpy).toHaveBeenCalledWith('manual-execution');
    } finally {
      jest.useRealTimers();
    }
  });

  it('should switch from completion to execution when navigating to coding jobs', () => {
    jest.useFakeTimers();
    try {
      component.canApplyManualCodingResults = true;
      component.selectedManualTabIndex = 4;

      const componentInternals = component as unknown as {
        loadManualTabData(tab: 'execution'): void;
      };
      const loadManualTabDataSpy = jest
        .spyOn(componentInternals, 'loadManualTabData')
        .mockImplementation();
      const scrollToSectionSpy = jest
        .spyOn(component, 'scrollToSection')
        .mockImplementation();

      component.goToManualTab('execution', 'manual-execution');

      expect(component.selectedManualTabIndex).toBe(3);
      expect(loadManualTabDataSpy).toHaveBeenCalledWith('execution');

      jest.runOnlyPendingTimers();

      expect(scrollToSectionSpy).toHaveBeenCalledWith('manual-execution');
    } finally {
      jest.useRealTimers();
    }
  });

  it('should not treat stale-source coding jobs as ready to apply', () => {
    const isCodingJobReadyForApply = (
      component as unknown as {
        isCodingJobReadyForApply(job: {
          status: string;
          freshnessStatus?: string;
          training?: { id?: number };
          training_id?: number;
        }): boolean;
      }
    ).isCodingJobReadyForApply.bind(component);

    expect(
      isCodingJobReadyForApply({
        status: 'completed',
        freshnessStatus: 'review_required'
      })
    ).toBe(true);
    expect(
      isCodingJobReadyForApply({
        status: 'completed',
        freshnessStatus: 'stale_source'
      })
    ).toBe(false);
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

  it('explains aggregation savings as avoided separate manual coding', () => {
    component.selectedManualTabIndex = 3;
    setCompletePlanningState();
    setCodingProgress(16606, 12000);
    component.codingProgressOverview = {
      ...component.codingProgressOverview!,
      rawTotalCasesToCode: 21606,
      aggregationActive: true,
      aggregationThreshold: 2,
      aggregatedDuplicateCases: 5000
    };
    component.showProgressInfo = true;

    fixture.detectChanges();

    const pageText = fixture.nativeElement.textContent as string;
    expect(pageText).toContain(
      'Antwortwert-Aggregation ist aktiv: 21606 Rohantworten werden zu 16606 effektiven Kodierfällen zusammengefasst.'
    );
    expect(pageText).toContain(
      'Dadurch müssen bei Schwelle 2 5000 gleichwertige Rohantworten nicht separat manuell kodiert werden.'
    );
    expect(pageText).toContain(
      'Abgeleitete Variablen werden nicht aggregiert.'
    );
    expect(pageText).not.toContain('Kodierungen eingespart');
  });

  it('shows aggregation savings in the completion overview as a positive count', () => {
    component.canApplyManualCodingResults = true;
    component.selectedManualTabIndex = 4;
    setCompletePlanningState();
    setAppliedResults(543, 415, 128);
    component.appliedResultsOverview = {
      ...component.appliedResultsOverview!,
      rawTotalIncompleteResponses: 546,
      aggregationActive: true,
      aggregationThreshold: 4,
      aggregatedDuplicateCases: 3
    };

    fixture.detectChanges();

    const pageText = fixture.nativeElement.textContent as string;
    expect(pageText).toContain('3');
    expect(pageText).not.toContain('-3');
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

    expect(component.getPlanningNextStepTitle()).toBe(
      'Kodierfälle in Jobs verteilen'
    );
    expect(component.getPlanningNextStepActionLabel()).toBe(
      'Zu den Jobdefinitionen'
    );
    expect(component.getPlanningNextStepTargetSection()).toBe(
      'manual-planning'
    );
    expect(component.getPlanningNextStepDescription()).toContain(
      '3 Fälle sind noch nicht in Kodierjobs'
    );
    expect(component.getPlanningNextStepDescription()).toContain(
      '8 Fälle verfügbar'
    );
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

  function setManualFreshnessJobSummary(
    summary: {
      activeTrainingJobs?: number;
      openProductiveJobs?: number;
      completedProductiveJobs?: number;
      staleSourceJobs?: number;
    },
    openDoubleCodingConflictCount = 0
  ): void {
    const componentInternals = component as unknown as {
      manualFreshnessJobSummary: {
        activeTrainingJobs: number;
        openProductiveJobs: number;
        completedProductiveJobs: number;
        staleSourceJobs: number;
      };
      openDoubleCodingConflictCount: number;
    };

    componentInternals.manualFreshnessJobSummary = {
      activeTrainingJobs: summary.activeTrainingJobs ?? 0,
      openProductiveJobs: summary.openProductiveJobs ?? 0,
      completedProductiveJobs: summary.completedProductiveJobs ?? 0,
      staleSourceJobs: summary.staleSourceJobs ?? 0
    };
    componentInternals.openDoubleCodingConflictCount =
      openDoubleCodingConflictCount;
  }

  function setEmptyPlanningSnapshots(): void {
    component.variableCoverageOverview = {
      totalVariables: 0,
      coveredVariables: 0,
      coveredByDraft: 0,
      coveredByPendingReview: 0,
      coveredByApproved: 0,
      conflictedVariables: 0,
      missingVariables: 0,
      partiallyAbgedeckteVariablen: 0,
      fullyAbgedeckteVariablen: 0,
      coveragePercentage: 0,
      variableCaseCounts: [],
      coverageByStatus: {
        draft: [],
        pending_review: [],
        approved: [],
        conflicted: []
      }
    } satisfies VariableCoverageOverview;

    component.caseCoverageOverview = {
      totalCasesToCode: 0,
      effectiveTotalCasesToCode: 0,
      casesInJobs: 0,
      effectiveCasesInJobs: 0,
      doubleCodedCases: 0,
      singleCodedCases: 0,
      unassignedCases: 0,
      effectiveUnassignedCases: 0,
      coveragePercentage: 0,
      rawCoveragePercentage: 0,
      aggregationActive: false,
      aggregationThreshold: null,
      aggregatedDuplicateCases: 0
    } satisfies CaseCoverageOverview;

    component.codingProgressOverview = {
      totalCasesToCode: 0,
      completedCases: 0,
      completionPercentage: 0,
      rawTotalCasesToCode: 0,
      rawCompletedCases: 0,
      rawCompletionPercentage: 0,
      aggregationActive: false,
      aggregationThreshold: null,
      aggregatedDuplicateCases: 0
    } satisfies CodingProgressOverview;

    component.appliedResultsOverview = {
      totalIncompleteResponses: 0,
      appliedResponses: 0,
      remainingResponses: 0,
      completionPercentage: 0,
      rawTotalIncompleteResponses: 0,
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
    } satisfies ManualAppliedResultsOverview;
  }

  function setCodingProgress(totalCases: number, completedCases: number): void {
    const completionPercentage =
      totalCases > 0 ? (completedCases / totalCases) * 100 : 100;

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
    remainingResponses: number,
    deriveErrorResponses: {
      total: number;
      applied: number;
      remaining: number;
    } = { total: 0, applied: 0, remaining: 0 }
  ): void {
    const completionPercentage =
      totalResponses > 0 ? (appliedResponses / totalResponses) * 100 : 100;

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
      deriveErrorTotalResponses: deriveErrorResponses.total,
      deriveErrorAppliedResponses: deriveErrorResponses.applied,
      deriveErrorRemainingResponses: deriveErrorResponses.remaining,
      deriveErrorRawTotalResponses: deriveErrorResponses.total,
      deriveErrorRawAppliedResponses: deriveErrorResponses.applied,
      totalIncompleteVariables: 1,
      finalStatusBreakdown: {
        codingComplete: appliedResponses,
        invalid: 0,
        codingError: 0,
        other: 0
      }
    } satisfies ManualAppliedResultsOverview;
  }

  it('should expose DERIVE_ERROR additional manual progress separately', () => {
    setAppliedResults(5, 3, 2, { total: 2, applied: 1, remaining: 1 });

    expect(component.hasDeriveErrorManualCases).toBe(true);
    expect(component.deriveErrorManualCases).toBe(2);
    expect(component.deriveErrorAppliedCases).toBe(1);
    expect(component.deriveErrorRemainingCases).toBe(1);
    expect(component.isCompletionComplete()).toBe(false);
  });
});
