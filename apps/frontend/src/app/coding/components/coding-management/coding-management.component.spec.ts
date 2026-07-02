import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  ActivatedRoute, convertToParamMap, ParamMap, Router
} from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import {
  BehaviorSubject,
  of,
  Subject,
  throwError
} from 'rxjs';
import { PageEvent } from '@angular/material/paginator';
import { CodingManagementComponent } from './coding-management.component';
import { CodingManagementService } from '../../services/coding-management.service';
import { CodingManagementUiService } from './services/coding-management-ui.service';
import { AppService } from '../../../core/services/app.service';
import { WorkspaceSettingsService } from '../../../ws-admin/services/workspace-settings.service';
import {
  TestPersonCodingService,
  TestResultsChangedEvent
} from '../../services/test-person-coding.service';
import { SERVER_URL } from '../../../injection-tokens';
import { environment } from '../../../../environments/environment';
import { Success } from '../../models/success.model';
import { TestPersonCodingDialogComponent } from '../test-person-coding-dialog/test-person-coding-dialog.component';

describe('CodingManagementComponent', () => {
  let component: CodingManagementComponent;
  let fixture: ComponentFixture<CodingManagementComponent>;
  let mockCodingManagementService: jest.Mocked<Partial<CodingManagementService>>;
  let mockUiService: jest.Mocked<Partial<CodingManagementUiService>>;
  let mockDialog: jest.Mocked<Partial<MatDialog>>;
  let mockAppService: jest.Mocked<Partial<AppService>>;
  let mockWorkspaceSettingsService: jest.Mocked<Partial<WorkspaceSettingsService>>;
  let mockTestPersonCodingService: jest.Mocked<Partial<TestPersonCodingService>>;
  let mockRouter: jest.Mocked<Partial<Router>>;
  let mockSnackBar: jest.Mocked<Partial<MatSnackBar>>;
  let autoCodingCompletedSubject: Subject<{ jobId?: string }>;
  let testResultsChangedSubject: Subject<TestResultsChangedEvent>;
  let queryParamMapSubject: BehaviorSubject<ParamMap>;
  let fakeActivatedRoute: ActivatedRoute;

  beforeEach(async () => {
    // Mock window.open
    window.open = jest.fn();

    // Create mocks
    mockCodingManagementService = {
      codingStatistics$: of({ totalResponses: 100, statusCounts: { 200: 50, 300: 50 } }),
      referenceStatistics$: of(null),
      referenceVersion$: of(null),
      isLoadingStatistics$: of(false),
      resetProgress$: of(null) as never,
      downloadProgress$: new BehaviorSubject<number | null>(null),
      codingListDownloadProgress$: new BehaviorSubject<number | null>(null),
      fetchCodingStatistics: jest.fn(),
      fetchResponsesByStatus: jest.fn().mockReturnValue(of({ data: [], total: 0 })),
      searchResponses: jest.fn().mockReturnValue(of({ data: [], total: 0 })),
      resetCodingVersion: jest.fn().mockReturnValue(of({ message: 'Success' })),
      downloadCodingResults: jest.fn().mockReturnValue(Promise.resolve()),
      hasGeogebraResponses: jest.fn().mockReturnValue(of(false)),
      downloadCodingList: jest.fn(),
      checkActiveResetJob: jest.fn()
    };

    mockUiService = {
      openReplayForResponse: jest.fn().mockReturnValue(of('http://replay.url')),
      getCodingSchemeFromUnit: jest.fn().mockReturnValue(of('test-scheme')),
      showCodingSchemeDialog: jest.fn(),
      showUnitXmlDialog: jest.fn()
    };

    const mockDialogRef = {
      afterClosed: jest.fn().mockReturnValue(of(null)),
      close: jest.fn()
    };

    mockDialog = {
      open: jest.fn().mockReturnValue(mockDialogRef),
      openDialogs: [],
      afterOpened: new Subject(),
      afterAllClosed: new Subject()
    } as unknown as MatDialog;

    mockAppService = {
      selectedWorkspaceId: 1,
      loggedUser: { sub: 'test-user' }
    };

    mockWorkspaceSettingsService = {
      getAutoFetchCodingStatistics: jest.fn().mockReturnValue(of(false)),
      getEnableRegexSearch: jest.fn().mockReturnValue(of(false)),
      getAutoRefreshManualCodingJobs: jest.fn().mockReturnValue(of(true))
    };
    autoCodingCompletedSubject = new Subject<{ jobId?: string }>();
    testResultsChangedSubject = new Subject<TestResultsChangedEvent>();
    queryParamMapSubject = new BehaviorSubject<ParamMap>(convertToParamMap({}));
    fakeActivatedRoute = {
      snapshot: {
        data: {},
        queryParamMap: queryParamMapSubject.value
      },
      queryParamMap: queryParamMapSubject.asObservable()
    } as unknown as ActivatedRoute;

    mockTestPersonCodingService = {
      autoCodingCompleted$: autoCodingCompletedSubject.asObservable(),
      testResultsChanged$: testResultsChangedSubject.asObservable(),
      consumePendingStatisticsVersion: jest.fn().mockReturnValue(null),
      getCodingFreshness: jest.fn().mockReturnValue(of({
        workspaceId: 1,
        currentRevision: 0,
        items: []
      })),
      getAutocodingReadiness: jest.fn().mockReturnValue(of({
        workspaceId: 1,
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
      })),
      getCodingFreshnessScope: jest.fn().mockReturnValue(of({
        workspaceId: 1,
        currentRevision: 0,
        versions: ['v1', 'v2', 'v3'],
        states: ['PENDING', 'STALE', 'MANUAL_REVIEW_REQUIRED'],
        unitCount: 0,
        personCount: 0,
        groupCount: 0,
        affectedResponseCount: 0,
        unitIds: [],
        personIds: [],
        groupNames: [],
        groups: []
      })),
      getAppliedResultsOverview: jest.fn().mockReturnValue(of({
        totalIncompleteResponses: 0,
        appliedResponses: 0,
        remainingResponses: 0,
        completionPercentage: 0,
        rawTotalIncompleteResponses: 0,
        rawAppliedResponses: 0,
        rawCompletionPercentage: 0,
        aggregationActive: false,
        aggregationThreshold: null,
        aggregatedDuplicateCases: 0
      })),
      startFreshnessCoding: jest.fn().mockReturnValue(of({
        totalResponses: 0,
        statusCounts: {},
        unitCount: 0,
        personCount: 0,
        groupNames: []
      })),
      getJobStatus: jest.fn(),
      notifyAutoCodingCompleted: jest.fn()
    };

    mockRouter = {
      navigate: jest.fn()
    };

    mockSnackBar = {
      open: jest.fn()
    };

    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        {
          provide: SERVER_URL,
          useValue: environment.backendUrl
        },
        {
          provide: ActivatedRoute,
          useValue: fakeActivatedRoute
        },
        {
          provide: MatSnackBar,
          useValue: mockSnackBar
        },
        {
          provide: CodingManagementService,
          useValue: mockCodingManagementService
        },
        {
          provide: CodingManagementUiService,
          useValue: mockUiService
        },
        {
          provide: MatDialog,
          useValue: mockDialog
        },
        {
          provide: AppService,
          useValue: mockAppService
        },
        {
          provide: WorkspaceSettingsService,
          useValue: mockWorkspaceSettingsService
        },
        {
          provide: TestPersonCodingService,
          useValue: mockTestPersonCodingService
        },
        {
          provide: Router,
          useValue: mockRouter
        }
      ],
      imports: [
        TranslateModule.forRoot(),
        CodingManagementComponent,
        NoopAnimationsModule
      ]
    }).compileComponents();

    const translateService = TestBed.inject(TranslateService);
    translateService.setTranslation('de', {
      close: 'Schließen',
      'coding-management': {
        actions: {
          close: 'Schließen'
        },
        descriptions: {
          'no-results': 'Keine Ergebnisse für {{status}}'
        },
        statistics: {
          'uncoded-responses-title': 'Unkodierte Antworten'
        },
        readiness: {
          'title-load-failed': 'Auto-Coding-Prüfung nicht verfügbar',
          'title-blocked': 'Auto-Coding 1 nicht möglich',
          'title-not-started': 'Kodierung noch nicht gestartet',
          'title-manual-coding-open': 'Manuelle Kodierung abschließen',
          'title-not-checked': 'Kodierstand nicht automatisch geprüft',
          'manual-refresh-required': 'Die automatische Aktualisierung ist deaktiviert. Aktualisieren Sie den Status bei Bedarf manuell.',
          summary: '{{rawResponsesTotal}} Rohantworten vorhanden, {{rawResponsesWithRelevantStatus}} mit relevantem Antwortstatus, aber {{codeableResponses}} kodierbare Antworten.',
          'details-result-units': '{{count}} Ergebnis-Units',
          'details-unit-files': '{{count}} passende Unit-Dateien',
          'details-coding-schemes': '{{count}} passende Kodierschemata',
          'details-valid-responses': '{{count}} Antworten mit passender Kodier-Variable',
          'additional-items': '+{{count}} weitere',
          'second-autocoding-waits-summary': 'Auto-Coding 2 ist der nächste Schritt, sobald die manuelle Kodierung abgeschlossen ist. Schließen Sie zuerst die offenen manuellen Kodierfälle ab und übernehmen Sie die Ergebnisse.{{remaining}}',
          'second-autocoding-waits-remaining': ' Es sind noch {{count}} manuelle Kodierergebnisse offen.',
          'manual-results-overview-load-failed': 'Der Stand der manuellen Kodierung konnte nicht geprüft werden. Auto-Coding 2 bleibt gesperrt, bis die Prüfung erfolgreich aktualisiert wurde.',
          'second-autocoding-waits-help': 'Der Start von Auto-Coding 2 bleibt bis dahin gesperrt. {{taskResultHelp}}',
          'second-autocoding-waits-chip': '{{version}}: {{count}} wartet',
          'second-autocoding-waits-snackbar': 'Schließen Sie zuerst die manuelle Kodierung ab und übernehmen Sie die Ergebnisse.',
          'starting-freshness-coding': 'Auto-Coding wird gestartet...',
          'refresh-status': 'Status aktualisieren',
          'open-manual-review': 'Manuelle Kodierung öffnen'
        }
      }
    });
    translateService.use('de');

    fixture = TestBed.createComponent(CodingManagementComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Component Initialization', () => {
    it('should subscribe to coding statistics on init', () => {
      expect(component.codingStatistics).toEqual({
        totalResponses: 100,
        statusCounts: { 200: 50, 300: 50 }
      });
      expect(component.statisticsLoaded).toBe(true);
    });

    it('should check auto-fetch setting on init', () => {
      expect(mockWorkspaceSettingsService.getAutoFetchCodingStatistics).toHaveBeenCalledWith(1);
    });

    it('should check regex search setting on init', () => {
      expect(mockWorkspaceSettingsService.getEnableRegexSearch).toHaveBeenCalledWith(1);
    });

    it('should check manual coding auto-refresh setting on init', () => {
      expect(mockWorkspaceSettingsService.getAutoRefreshManualCodingJobs).toHaveBeenCalledWith(1);
    });

    it('should load autocoding readiness for the first autocoder run', () => {
      expect(mockTestPersonCodingService.getAutocodingReadiness).toHaveBeenCalledTimes(1);
      expect(mockTestPersonCodingService.getAutocodingReadiness).toHaveBeenCalledWith(1, 1, false);
    });

    it('should refresh coding status overview when requested by query param', () => {
      (mockCodingManagementService.fetchCodingStatistics as jest.Mock).mockClear();
      (mockTestPersonCodingService.getCodingFreshness as jest.Mock).mockClear();
      (mockTestPersonCodingService.getAppliedResultsOverview as jest.Mock).mockClear();
      (mockTestPersonCodingService.getAutocodingReadiness as jest.Mock).mockClear();

      queryParamMapSubject.next(convertToParamMap({
        refreshCodingFreshness: '1'
      }));

      expect(mockCodingManagementService.fetchCodingStatistics).toHaveBeenCalled();
      expect(mockTestPersonCodingService.getCodingFreshness).toHaveBeenCalledWith(1);
      expect(mockTestPersonCodingService.getAppliedResultsOverview).toHaveBeenCalledWith(1);
      expect(mockTestPersonCodingService.getAutocodingReadiness).toHaveBeenCalledWith(1, 1, true);
    });
  });

  describe('Autocoding Readiness', () => {
    it('should treat blocked readiness as coding attention with diagnostic text', () => {
      component.autocodingReadiness = {
        workspaceId: 1,
        autoCoderRun: 1,
        readiness: 'BLOCKED',
        blockers: ['NO_VALID_VARIABLE_MATCHES'],
        rawResponsesTotal: 18787,
        rawResponsesWithRelevantStatus: 18000,
        resultUnitsTotal: 33,
        resultUnitKeysTotal: 33,
        matchedUnitFiles: 6,
        missingUnitFiles: ['UNIT_A', 'UNIT_B', 'UNIT_C', 'UNIT_D', 'UNIT_E', 'UNIT_F'],
        matchedCodingSchemes: 2,
        missingCodingSchemes: ['SCHEME_A'],
        invalidCodingSchemes: ['SCHEME_B'],
        validVariablePairs: 0,
        validResponses: 0,
        codeableResponses: 0,
        invalidVariableSamples: [{
          unitName: 'UNIT_A',
          responseCount: 12,
          sampleVariableIds: ['VAR_A', 'VAR_B', 'VAR_C', 'VAR_D', 'VAR_E'],
          knownVariableIds: ['KNOWN_A']
        }]
      };

      expect(component.hasCodingFreshnessAttention).toBe(true);
      expect(component.codingFreshnessPanelTitle).toBe('Auto-Coding 1 nicht möglich');
      expect(component.autocodingReadinessSummaryText).toContain('18787 Rohantworten vorhanden');
      expect(component.autocodingReadinessDetailsText).toContain('0 Antworten mit passender Kodier-Variable');
      expect(component.autocodingReadinessMissingUnitPreview).toBe('UNIT_A, UNIT_B, UNIT_C, UNIT_D, UNIT_E +1');
      expect(component.autocodingReadinessInvalidCodingSchemePreview).toBe('SCHEME_B');
      expect(component.autocodingReadinessInvalidVariablePreview).toBe('UNIT_A: VAR_A, VAR_B, VAR_C, VAR_D +1');
    });

    it('should expose readiness load failures as attention', () => {
      (mockTestPersonCodingService.getAutocodingReadiness as jest.Mock)
        .mockReturnValueOnce(throwError(() => new Error('readiness failed')));

      component.loadAutocodingReadiness();

      expect(component.hasAutocodingReadinessLoadFailed).toBe(true);
      expect(component.hasCodingFreshnessAttention).toBe(true);
      expect(component.codingFreshnessPanelTitle).toBe('Auto-Coding-Prüfung nicht verfügbar');
    });

    it('should force-refresh autocoding readiness when requested', () => {
      component.refreshAutocodingReadiness();

      expect(mockTestPersonCodingService.getAutocodingReadiness).toHaveBeenLastCalledWith(1, 1, true);
    });
  });

  describe('Coding Freshness', () => {
    it('should show pending manual status refresh as an attention state', () => {
      component.autoRefreshManualCodingJobs = false;
      component.hasRequestedCodingStatusOverview = false;

      expect(component.isCodingStatusOverviewPendingManualRefresh).toBe(true);
      expect(component.hasCodingFreshnessAttention).toBe(true);
      expect(component.codingFreshnessPanelTitle).toBe('Kodierstand nicht automatisch geprüft');

      fixture.detectChanges();
      const freshnessPanel = fixture.nativeElement.querySelector(
        '.coding-freshness-panel'
      ) as HTMLElement;
      const stateIcon = freshnessPanel.querySelector('mat-icon') as HTMLElement;
      expect(freshnessPanel.classList.contains('is-current')).toBe(false);
      expect(stateIcon.textContent?.trim()).toBe('warning');
    });

    it('should keep second auto-coding waiting while manual coding results are still open', () => {
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
      component.manualAppliedResultsOverview = {
        totalIncompleteResponses: 671,
        appliedResponses: 210,
        remainingResponses: 461,
        completionPercentage: 31,
        rawTotalIncompleteResponses: 5098,
        rawAppliedResponses: 4637,
        rawCompletionPercentage: 91,
        aggregationActive: false,
        aggregationThreshold: null,
        aggregatedDuplicateCases: 0
      };

      expect(component.hasCodingFreshnessWarnings).toBe(true);
      expect(component.codingFreshnessPanelTitle).toBe('Manuelle Kodierung abschließen');
      expect(component.codingFreshnessSummaryText).toContain('Auto-Coding 2 ist der nächste Schritt');
      expect(component.codingFreshnessSummaryText).toContain('461 manuelle Kodierergebnisse offen');
      expect(component.hasFreshnessAutoCodingWork('v3')).toBe(false);
      expect(component.hasManualCodingFreshnessAction).toBe(true);
      expect(component.codingFreshnessChipWarnings).toHaveLength(1);
      expect(component.getFreshnessChipLabel(component.codingFreshnessChipWarnings[0])).toBe(
        'Auto-Coding 2: 671 Aufgabenbearbeitungen wartet'
      );

      fixture.detectChanges();
      const actionPanel = fixture.nativeElement.querySelector('.coding-freshness-actions') as HTMLElement | null;
      const manualActionButton = Array.from(actionPanel?.querySelectorAll('button') || [])
        .find(button => button.textContent?.includes('Manuelle Kodierung öffnen')) as HTMLButtonElement | undefined;
      expect(manualActionButton).toBeTruthy();

      manualActionButton?.click();

      expect(mockRouter.navigate).toHaveBeenCalledWith(
        ['/workspace-admin/1/coding/manual'],
        { queryParams: { focus: 'manual-freshness' } }
      );
    });

    it('should keep earlier coding freshness warnings visible while second auto-coding waits', () => {
      component.codingFreshnessSummary = {
        workspaceId: 1,
        currentRevision: 2,
        items: [
          {
            version: 'v1',
            state: 'PENDING',
            unitCount: 10,
            affectedResponseCount: 50
          },
          {
            version: 'v3',
            state: 'PENDING',
            unitCount: 671,
            affectedResponseCount: 5098
          }
        ]
      };
      component.manualAppliedResultsOverview = {
        totalIncompleteResponses: 671,
        appliedResponses: 210,
        remainingResponses: 461,
        completionPercentage: 31,
        rawTotalIncompleteResponses: 5098,
        rawAppliedResponses: 4637,
        rawCompletionPercentage: 91,
        aggregationActive: false,
        aggregationThreshold: null,
        aggregatedDuplicateCases: 0
      };

      expect(component.codingFreshnessPanelTitle).toBe('Auto-Coding starten');
      expect(component.codingFreshnessSummaryText).toBe(
        '10 Aufgabenbearbeitungen benötigen Auto-Coding 1. ' +
        'Dabei werden 50 Antwortwerte berücksichtigt.'
      );
      expect(component.hasFreshnessAutoCodingWork('v1')).toBe(true);
      expect(component.hasFreshnessAutoCodingWork('v3')).toBe(false);
      expect(component.codingFreshnessChipWarnings).toEqual([
        expect.objectContaining({ version: 'v1' })
      ]);
    });

    it('should expose second auto-coding work after manual coding results are complete', () => {
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
      component.manualAppliedResultsOverview = {
        totalIncompleteResponses: 671,
        appliedResponses: 671,
        remainingResponses: 0,
        completionPercentage: 100,
        rawTotalIncompleteResponses: 5098,
        rawAppliedResponses: 5098,
        rawCompletionPercentage: 100,
        aggregationActive: false,
        aggregationThreshold: null,
        aggregatedDuplicateCases: 0
      };

      expect(component.hasCodingFreshnessWarnings).toBe(true);
      expect(component.hasFreshnessAutoCodingWork('v3')).toBe(true);
      expect(component.codingFreshnessSummaryText).toBe(
        '671 Aufgabenbearbeitungen benötigen Auto-Coding 2. ' +
        'Dabei werden 5098 Antwortwerte berücksichtigt.'
      );
    });

    it('should keep second auto-coding blocked when manual result overview cannot be loaded', () => {
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
      (mockTestPersonCodingService.getAppliedResultsOverview as jest.Mock).mockReturnValueOnce(of(null));

      component.loadManualAppliedResultsOverview();

      expect(component.manualAppliedResultsOverview).toBeNull();
      expect(component.manualAppliedResultsOverviewLoadFailed).toBe(true);
      expect(component.hasFreshnessAutoCodingWork('v3')).toBe(false);
      expect(component.codingFreshnessSummaryText).toContain('konnte nicht geprüft werden');
    });

    it('should not start second auto-coding while manual coding results are still open', () => {
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
      component.manualAppliedResultsOverview = {
        totalIncompleteResponses: 671,
        appliedResponses: 210,
        remainingResponses: 461,
        completionPercentage: 31,
        rawTotalIncompleteResponses: 5098,
        rawAppliedResponses: 4637,
        rawCompletionPercentage: 91,
        aggregationActive: false,
        aggregationThreshold: null,
        aggregatedDuplicateCases: 0
      };
      (mockTestPersonCodingService.startFreshnessCoding as jest.Mock).mockClear();

      component.startFreshnessCoding('v3');

      expect(mockTestPersonCodingService.startFreshnessCoding).not.toHaveBeenCalled();
      expect(mockSnackBar.open).toHaveBeenCalledWith(
        'Schließen Sie zuerst die manuelle Kodierung ab und übernehmen Sie die Ergebnisse.',
        'Schließen',
        { duration: 6000 }
      );
    });

    it('should show a start indicator while the freshness coding request is pending', () => {
      const startRequest$ = new Subject<never>();
      (mockTestPersonCodingService.startFreshnessCoding as jest.Mock).mockReturnValueOnce(startRequest$);
      component.codingFreshnessSummary = {
        workspaceId: 1,
        currentRevision: 2,
        items: [
          {
            version: 'v1',
            state: 'PENDING',
            unitCount: 7,
            affectedResponseCount: 42
          }
        ]
      };

      component.startFreshnessCoding('v1');
      fixture.detectChanges();

      const status = fixture.nativeElement.querySelector('.coding-freshness-job') as HTMLElement | null;
      expect(status?.textContent).toContain('Auto-Coding wird gestartet...');
      expect(status?.querySelector('mat-spinner')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.coding-freshness-actions')).toBeNull();
    });

    it('should open the test person coding dialog with the started freshness job', () => {
      jest.useFakeTimers();
      try {
        (mockTestPersonCodingService.startFreshnessCoding as jest.Mock).mockReturnValueOnce(of({
          totalResponses: 42,
          statusCounts: {},
          jobId: 'freshness-job-1',
          message: 'Processing in background',
          unitCount: 7,
          personCount: 3,
          groupNames: ['TG1']
        }));

        component.startFreshnessCoding('v1');

        expect(mockDialog.open).toHaveBeenCalledWith(
          TestPersonCodingDialogComponent,
          expect.objectContaining({
            height: '90vh',
            maxWidth: '100vw',
            maxHeight: '100vh',
            data: {
              initialJobId: 'freshness-job-1',
              initialAutoCoderRun: 1
            }
          })
        );
      } finally {
        component.ngOnDestroy();
        jest.useRealTimers();
      }
    });

    it('should resume parent freshness polling only after the job dialog closes', () => {
      jest.useFakeTimers();
      const afterClosed$ = new Subject<void>();
      const dialogRef = {
        afterClosed: jest.fn().mockReturnValue(afterClosed$),
        close: jest.fn()
      };

      try {
        (mockDialog.open as jest.Mock).mockReturnValueOnce(dialogRef);
        (mockTestPersonCodingService.startFreshnessCoding as jest.Mock).mockReturnValueOnce(of({
          totalResponses: 42,
          statusCounts: {},
          jobId: 'freshness-job-1',
          message: 'Processing in background',
          unitCount: 7,
          personCount: 3,
          groupNames: ['TG1']
        }));

        component.startFreshnessCoding('v1');

        expect(jest.getTimerCount()).toBe(0);

        afterClosed$.next();
        afterClosed$.complete();

        expect(jest.getTimerCount()).toBe(1);
      } finally {
        component.ngOnDestroy();
        jest.useRealTimers();
      }
    });

    it('should not resume parent freshness polling when the dialog reports a terminal status for the started job', () => {
      jest.useFakeTimers();
      const afterClosed$ = new Subject<{ initialJobId: string; jobId: string; jobStatus: 'failed' }>();
      const dialogRef = {
        afterClosed: jest.fn().mockReturnValue(afterClosed$),
        close: jest.fn()
      };

      try {
        (mockDialog.open as jest.Mock).mockReturnValueOnce(dialogRef);
        (mockTestPersonCodingService.startFreshnessCoding as jest.Mock).mockReturnValueOnce(of({
          totalResponses: 42,
          statusCounts: {},
          jobId: 'freshness-job-1',
          message: 'Processing in background',
          unitCount: 7,
          personCount: 3,
          groupNames: ['TG1']
        }));

        component.startFreshnessCoding('v1');
        afterClosed$.next({
          initialJobId: 'freshness-job-1',
          jobId: 'freshness-job-1',
          jobStatus: 'failed'
        });
        afterClosed$.complete();

        expect(jest.getTimerCount()).toBe(0);
        expect(component.activeFreshnessJobId).toBeNull();
      } finally {
        component.ngOnDestroy();
        jest.useRealTimers();
      }
    });

    it('should resume parent freshness polling when the dialog reports a status for another job', () => {
      jest.useFakeTimers();
      const afterClosed$ = new Subject<{ initialJobId: string; jobId: string; jobStatus: 'failed' }>();
      const dialogRef = {
        afterClosed: jest.fn().mockReturnValue(afterClosed$),
        close: jest.fn()
      };

      try {
        (mockDialog.open as jest.Mock).mockReturnValueOnce(dialogRef);
        (mockTestPersonCodingService.startFreshnessCoding as jest.Mock).mockReturnValueOnce(of({
          totalResponses: 42,
          statusCounts: {},
          jobId: 'freshness-job-1',
          message: 'Processing in background',
          unitCount: 7,
          personCount: 3,
          groupNames: ['TG1']
        }));

        component.startFreshnessCoding('v1');
        afterClosed$.next({
          initialJobId: 'freshness-job-1',
          jobId: 'other-job',
          jobStatus: 'failed'
        });
        afterClosed$.complete();

        expect(jest.getTimerCount()).toBe(1);
      } finally {
        component.ngOnDestroy();
        jest.useRealTimers();
      }
    });

    it('should keep active freshness tracking when a different auto-coding job completes', () => {
      component.activeFreshnessJobId = 'freshness-job-1';
      component.activeFreshnessJobProgress = 42;

      autoCodingCompletedSubject.next({ jobId: 'other-job' });

      expect(component.activeFreshnessJobId).toBe('freshness-job-1');
      expect(component.activeFreshnessJobProgress).toBe(42);

      autoCodingCompletedSubject.next({ jobId: 'freshness-job-1' });

      expect(component.activeFreshnessJobId).toBeNull();
      expect(component.activeFreshnessJobProgress).toBeNull();
    });
  });

  describe('Statistics Card Integration', () => {
    it('should handle version change from statistics card', () => {
      component.onVersionChange('v2');

      expect(component.selectedStatisticsVersion).toBe('v2');
      expect(component.filterParams.version).toBe('v2');
      expect(component.data).toEqual([]);
      expect(component.currentStatusFilter).toBeNull();
      expect(component.totalRecords).toBe(0);
    });

    it('should fetch statistics when statistics card emits loadStatistics', () => {
      component.fetchCodingStatistics();

      expect(mockCodingManagementService.fetchCodingStatistics).toHaveBeenCalledWith('v1');
    });

    it('should switch to changed statistics version when test results change', () => {
      (mockCodingManagementService.fetchCodingStatistics as jest.Mock).mockClear();

      testResultsChangedSubject.next({ workspaceId: 1, statisticsVersion: 'v2' });

      expect(component.selectedStatisticsVersion).toBe('v2');
      expect(component.filterParams.version).toBe('v2');
      expect(mockCodingManagementService.fetchCodingStatistics).toHaveBeenCalledWith('v2');
    });

    it('should ignore changed test results from a different workspace', () => {
      (mockCodingManagementService.fetchCodingStatistics as jest.Mock).mockClear();

      testResultsChangedSubject.next({ workspaceId: 2, statisticsVersion: 'v2' });

      expect(component.selectedStatisticsVersion).toBe('v1');
      expect(component.filterParams.version).toBe('v1');
      expect(mockCodingManagementService.fetchCodingStatistics).not.toHaveBeenCalled();
    });

    it('should consume a pending statistics version when opened after results changed', () => {
      fixture.destroy();
      (mockCodingManagementService.fetchCodingStatistics as jest.Mock).mockClear();
      (mockTestPersonCodingService.consumePendingStatisticsVersion as jest.Mock).mockClear();
      (mockTestPersonCodingService.consumePendingStatisticsVersion as jest.Mock)
        .mockReturnValueOnce('v2');

      fixture = TestBed.createComponent(CodingManagementComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();

      expect(component.selectedStatisticsVersion).toBe('v2');
      expect(component.filterParams.version).toBe('v2');
      expect(mockTestPersonCodingService.consumePendingStatisticsVersion).toHaveBeenCalledWith(1);
      expect(mockCodingManagementService.fetchCodingStatistics).toHaveBeenCalledWith('v2');
    });

    it('should handle status click from statistics card through the normal table filter', () => {
      component.filterParams.group = 'ID26010601';

      component.onStatusClick('200');

      expect(component.currentStatusFilter).toBeNull();
      expect(component.filterParams).toEqual(expect.objectContaining({
        codedStatus: '200',
        group: 'ID26010601',
        responseSource: 'all',
        version: 'v1'
      }));
      expect(mockCodingManagementService.searchResponses).toHaveBeenCalledWith(
        expect.objectContaining({ ...component.filterParams, regexSearch: false }),
        1,
        100,
        undefined,
        undefined
      );
    });
  });

  describe('Response Filters Integration', () => {
    it('should handle filter change from filters component', () => {
      const filterParams = {
        unitName: 'test',
        codedStatus: '200',
        version: 'v1' as const,
        code: '',
        group: '',
        bookletName: '',
        variableId: '',
        geogebra: false,
        responseSource: 'all' as const,
        personLogin: ''
      };

      component.onFilterChange(filterParams);

      expect(component.filterParams).toEqual(filterParams);
    });

    it('should keep filter version aligned with selected statistics version', () => {
      component.selectedStatisticsVersion = 'v2';

      component.onFilterChange({
        unitName: 'test',
        codedStatus: '200',
        version: 'v1',
        code: '',
        group: '',
        bookletName: '',
        variableId: '',
        geogebra: false,
        responseSource: 'all',
        personLogin: ''
      });

      expect(component.filterParams.version).toBe('v2');
      expect(mockCodingManagementService.searchResponses).toHaveBeenCalledWith(
        expect.objectContaining({ ...component.filterParams, regexSearch: false }),
        1,
        100,
        undefined,
        undefined
      );
    });

    it('should normalize GeoGebra filter changes to base responses', () => {
      component.onFilterChange({
        unitName: '',
        codedStatus: '',
        version: 'v1',
        code: '',
        group: '',
        bookletName: '',
        variableId: '',
        geogebra: true,
        responseSource: 'all',
        personLogin: ''
      });

      expect(component.filterParams.responseSource).toBe('base');
      expect(mockCodingManagementService.searchResponses).toHaveBeenCalledWith(
        expect.objectContaining({ ...component.filterParams, regexSearch: false }),
        1,
        100,
        undefined,
        undefined
      );
    });

    it('should clear data when filter status is empty', () => {
      component.data = [{ id: 1 } as Success];
      component.totalRecords = 10;

      const filterParams = {
        unitName: '',
        codedStatus: '',
        version: 'v1' as const,
        code: '',
        group: '',
        bookletName: '',
        variableId: '',
        geogebra: false,
        responseSource: 'all' as const,
        personLogin: ''
      };

      component.onFilterChange(filterParams);

      expect(component.data).toEqual([]);
      expect(component.totalRecords).toBe(0);
      expect(component.currentStatusFilter).toBeNull();
      expect(mockCodingManagementService.searchResponses).not.toHaveBeenCalled();
    });

    it('should apply derived response source when derived statistics are clicked', () => {
      component.selectedStatisticsVersion = 'v2';

      component.onDerivedClick();

      expect(component.filterParams).toEqual({
        value: '',
        unitName: '',
        codedStatus: '',
        version: 'v2',
        code: '',
        codingCode: '',
        score: '',
        group: '',
        bookletName: '',
        variableId: '',
        geogebra: false,
        responseSource: 'derived',
        personLogin: ''
      });
      expect(component.currentStatusFilter).toBeNull();
      expect(component.pageIndex).toBe(0);
      expect(mockCodingManagementService.searchResponses).toHaveBeenCalledWith(
        expect.objectContaining({ ...component.filterParams, regexSearch: false }),
        1,
        100,
        undefined,
        undefined
      );
    });

    it('should handle clear filters event', () => {
      component.selectedStatisticsVersion = 'v3';
      component.filterParams = {
        ...component.filterParams,
        version: 'v3',
        unitName: 'test'
      };
      component.data = [{ id: 1 } as Success];

      component.onClearFilters();

      expect(component.filterParams.unitName).toBe('');
      expect(component.filterParams.version).toBe('v3');
      expect(component.filterParams.responseSource).toBe('all');
      expect(component.data).toEqual([]);
      expect(component.totalRecords).toBe(0);
    });
  });

  describe('Response Table Integration', () => {
    it('should handle page change from table component', () => {
      component.currentStatusFilter = '200';
      const event = { pageIndex: 1, pageSize: 200, length: 400 } as PageEvent;

      component.onPageChange(event);

      expect(component.pageSize).toBe(200);
      expect(component.pageIndex).toBe(1);
      expect(mockCodingManagementService.fetchResponsesByStatus).toHaveBeenCalledWith(
        '200',
        'v1',
        2, // pageIndex + 1
        200,
        undefined,
        undefined
      );
    });

    it('should reset to the first page and reload data when sorting changes', () => {
      component.filterParams = {
        ...component.filterParams,
        codedStatus: '200'
      };
      component.pageIndex = 2;

      component.onSortChange({ active: 'score', direction: 'desc' });

      expect(component.sortBy).toBe('score');
      expect(component.sortDirection).toBe('desc');
      expect(component.pageIndex).toBe(0);
      expect(mockCodingManagementService.searchResponses).toHaveBeenCalledWith(
        expect.objectContaining({ ...component.filterParams, regexSearch: false }),
        1,
        100,
        'score',
        'desc'
      );
    });

    it('should handle replay click from table component', () => {
      const response = { id: 123 } as Success;

      component.onReplayClick(response);

      expect(mockUiService.openReplayForResponse).toHaveBeenCalledWith(response);
    });

    it('should handle show coding scheme from table component', () => {
      component.onShowCodingScheme(456);

      expect(mockUiService.getCodingSchemeFromUnit).toHaveBeenCalledWith(456);
    });

    it('should handle show unit XML from table component', () => {
      component.onShowUnitXml(789);

      expect(mockUiService.showUnitXmlDialog).toHaveBeenCalledWith(789);
    });

    it('should load all filtered responses before opening the review dialog', () => {
      (mockDialog.open as jest.Mock).mockClear();
      component.filterParams = {
        ...component.filterParams,
        geogebra: true
      };
      component.data = [{ id: 1 } as Success];
      component.totalRecords = 2;
      mockCodingManagementService.searchResponses = jest.fn().mockReturnValue(of({
        total: 2,
        data: [
          {
            responseId: 1,
            unitId: 10,
            variableId: 'v1',
            value: 'UEsD',
            status: 'VALUE_CHANGED',
            unitName: 'Unit1',
            unitAlias: null,
            bookletId: 20,
            bookletName: 'Booklet1',
            personId: 30,
            personLogin: 'login1',
            personCode: 'code1',
            personGroup: 'group1'
          },
          {
            responseId: 2,
            unitId: 11,
            variableId: 'v2',
            value: 'UEsD',
            status: 'VALUE_CHANGED',
            unitName: 'Unit2',
            unitAlias: null,
            bookletId: 21,
            bookletName: 'Booklet2',
            personId: 31,
            personLogin: 'login2',
            personCode: 'code2',
            personGroup: 'group2'
          }
        ]
      }));

      component.onReviewClick();

      expect(mockCodingManagementService.searchResponses).toHaveBeenCalledWith(
        expect.objectContaining({ ...component.filterParams, regexSearch: false }),
        1,
        2,
        undefined,
        undefined
      );
      expect(mockDialog.open).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          data: expect.objectContaining({
            responses: expect.arrayContaining([
              expect.objectContaining({ id: 1, unitname: 'Unit1' }),
              expect.objectContaining({ id: 2, unitname: 'Unit2' })
            ])
          })
        })
      );
    });

    it('should load review responses in batches for large filtered result sets', () => {
      (mockDialog.open as jest.Mock).mockClear();
      component.filterParams = {
        ...component.filterParams,
        geogebra: true
      };
      component.data = [{ id: 1 } as Success];
      component.totalRecords = 1200;
      mockCodingManagementService.searchResponses = jest.fn().mockImplementation(
        (_params, page: number) => of({
          total: 1200,
          data: [{
            responseId: page,
            unitId: page,
            variableId: `v${page}`,
            value: 'UEsD',
            status: 'VALUE_CHANGED',
            unitName: `Unit${page}`,
            unitAlias: null,
            bookletId: page,
            bookletName: `Booklet${page}`,
            personId: page,
            personLogin: `login${page}`,
            personCode: `code${page}`,
            personGroup: `group${page}`
          }]
        })
      );

      component.onReviewClick();

      expect(mockCodingManagementService.searchResponses).toHaveBeenCalledTimes(3);
      expect(mockCodingManagementService.searchResponses).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ geogebra: true }),
        1,
        500,
        undefined,
        undefined
      );
      expect(mockCodingManagementService.searchResponses).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ geogebra: true }),
        2,
        500,
        undefined,
        undefined
      );
      expect(mockCodingManagementService.searchResponses).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({ geogebra: true }),
        3,
        500,
        undefined,
        undefined
      );
      expect(mockDialog.open).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          data: expect.objectContaining({
            responses: expect.arrayContaining([
              expect.objectContaining({ id: 1, unitname: 'Unit1' }),
              expect.objectContaining({ id: 2, unitname: 'Unit2' }),
              expect.objectContaining({ id: 3, unitname: 'Unit3' })
            ])
          })
        })
      );
    });

    it('should not start a review for result sets beyond the review limit', () => {
      (mockCodingManagementService.searchResponses as jest.Mock).mockClear();
      (mockSnackBar.open as jest.Mock).mockClear();
      (mockDialog.open as jest.Mock).mockClear();
      component.filterParams = {
        ...component.filterParams,
        geogebra: true
      };
      component.data = [{ id: 1 } as Success];
      component.totalRecords = 5001;

      component.onReviewClick();

      expect(mockCodingManagementService.searchResponses).not.toHaveBeenCalled();
      expect(mockDialog.open).not.toHaveBeenCalled();
      expect(mockSnackBar.open).toHaveBeenCalledWith(
        'coding-management.messages.review-too-many-results',
        'Schließen',
        { duration: 7000 }
      );
    });
  });

  describe('Dialog Methods', () => {
    it('should navigate to manual coding route', () => {
      component.openManualCoding();

      expect(mockRouter.navigate).toHaveBeenCalledWith(
        ['/workspace-admin/1/coding/manual'],
        undefined
      );
    });

    it('should navigate to focused manual coding route for freshness work', () => {
      component.openManualCoding(true);

      expect(mockRouter.navigate).toHaveBeenCalledWith(
        ['/workspace-admin/1/coding/manual'],
        { queryParams: { focus: 'manual-freshness' } }
      );
    });

    it('should navigate to test files route', () => {
      component.openTestFiles();

      expect(mockRouter.navigate).toHaveBeenCalledWith([
        '/workspace-admin/1/test-files'
      ]);
    });
  });

  describe('Data Fetching', () => {
    it('should get available statuses from coding statistics', () => {
      component.codingStatistics = {
        totalResponses: 103,
        statusCounts: {
          4: 3,
          200: 50,
          300: 50
        }
      };

      const statuses = component.getAvailableStatuses();

      expect(statuses).toEqual(['4', '200', '300']);
    });

    it('should use centralized status labels in empty result snackbars', () => {
      const componentWithPrivate = component as unknown as {
        fetchResponsesByStatus(status: string): void;
      };

      componentWithPrivate.fetchResponsesByStatus('4');

      expect(mockSnackBar.open).toHaveBeenCalledWith(
        'Keine Ergebnisse für DERIVE_ERROR',
        'Schließen',
        { duration: 5000 }
      );
    });
  });

  describe('Component Cleanup', () => {
    it('should unsubscribe on destroy', () => {
      const componentWithPrivate = component as unknown as { destroy$: Subject<void> };
      const destroySpy = jest.spyOn(componentWithPrivate.destroy$, 'next');
      const completeSpy = jest.spyOn(componentWithPrivate.destroy$, 'complete');

      component.ngOnDestroy();

      expect(destroySpy).toHaveBeenCalled();
      expect(completeSpy).toHaveBeenCalled();
    });
  });
});
