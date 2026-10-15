// eslint-disable-next-line max-classes-per-file
import { computed, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { provideHttpClient } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { TestResultsComponent } from './test-results.component';
import { TestCenterImportComponent } from '../test-center-import/test-center-import.component';
import { TestResultsImportProgressDialogComponent } from './test-results-import-progress-dialog.component';
import { TestResultsUploadResultDialogComponent } from './test-results-upload-result-dialog.component';
import { SERVER_URL } from '../../../injection-tokens';
import { TestResultBackendService } from '../../../shared/services/test-result/test-result-backend.service';
import { ValidationService } from '../../../shared/services/validation/validation.service';
import { UnitNoteService } from '../../../shared/services/unit/unit-note.service';
import { FileService } from '../../../shared/services/file/file.service';
import { ResponseService } from '../../../shared/services/response/response.service';
import { UnitService } from '../../../shared/services/unit/unit.service';
import { CodingStatisticsService } from '../../../coding/services/coding-statistics.service';
import { TestPersonCodingService } from '../../../coding/services/test-person-coding.service';
import { VariableAnalysisService } from '../../../shared/services/response/variable-analysis.service';
import { AppService } from '../../../core/services/app.service';
import { TestResultService } from '../../../shared/services/test-result/test-result.service';
import { ValidationTaskStateService } from '../../../shared/services/validation/validation-task-state.service';
import { UnitsReplayService } from '../../../replay/services/units-replay.service';
import { WorkspaceSettingsService } from '../../services/workspace-settings.service';
import { TestResultsUploadStateService } from '../../services/test-results-upload-state.service';

describe('TestResultsComponent', () => {
  let component: TestResultsComponent;
  let fixture: ComponentFixture<TestResultsComponent>;
  let unitsReplayService: { getUnitsFromFileUpload: jest.Mock };
  let appService: { selectedWorkspaceId: number; selectedWorkspaceId$: Subject<number>; loggedUser: { sub: string }; createOwnToken: jest.Mock };

  it('keeps the latest person and cancels notes belonging to an earlier selection', async () => {
    const oldPerson = new Subject<unknown[]>();
    const secondPerson = new Subject<unknown[]>();
    const latestPerson = new Subject<unknown[]>();
    const oldNotes = new Subject<unknown>();
    const results = TestBed.inject(TestResultService);
    results.getPersonTestResults = jest.fn().mockReturnValueOnce(oldPerson)
      .mockReturnValueOnce(secondPerson).mockReturnValueOnce(latestPerson);
    TestBed.inject(UnitNoteService).getNotesForMultipleUnits = jest.fn(() => oldNotes) as never;
    const row = (id: number) => ({
      id, code: String(id), group: 'g', login: 'l', uploaded_at: new Date()
    });
    component.onRowClick(row(1));
    component.onRowClick(row(2));
    expect(oldPerson.observed).toBe(false);
    oldPerson.next([{ id: 1, name: 'OLD', units: [] }]);
    secondPerson.next([{ id: 2, name: 'SECOND', units: [{ id: 20 }] }]);
    secondPerson.complete();
    expect(oldNotes.observed).toBe(true);
    component.onRowClick(row(3));
    expect(oldNotes.observed).toBe(false);
    oldNotes.next({ 20: [{ note: 'OLD NOTE' }] });
    latestPerson.next([]);
    latestPerson.complete();
    await fixture.whenStable();
    expect(component.testPerson()?.id).toBe(3);
    expect(component.booklets()).toEqual([]);
    expect(component.unitNotesMap().size).toBe(0);
    expect(component.isLoadingBooklets()).toBe(false);
  });

  it('cancels a pending person read across a workspace change and return', async () => {
    const response = new Subject<unknown[]>();
    TestBed.inject(TestResultService).getPersonTestResults = jest.fn(() => response) as never;
    component.onRowClick({
      id: 1, code: 'p', group: 'g', login: 'l', uploaded_at: new Date()
    });
    appService.selectedWorkspaceId = 2;
    appService.selectedWorkspaceId$.next(2);
    appService.selectedWorkspaceId = 1;
    appService.selectedWorkspaceId$.next(1);
    expect(response.observed).toBe(false);
    response.next([{ id: 1, name: 'OLD', units: [] }]);
    await fixture.whenStable();
    expect(component.booklets()).toEqual([]);
    expect(component.testPerson()).toBeNull();
  });

  it('ignores an import choice from a dialog opened before a workspace change', () => {
    const closed = new Subject<{ type: string }>();
    jest.mocked(TestBed.inject(MatDialog).open).mockReturnValue({ afterClosed: () => closed } as never);
    const startImport = jest.spyOn(component, 'testCenterImport').mockResolvedValue();
    component.openImportDialog();
    appService.selectedWorkspaceId = 2;
    appService.selectedWorkspaceId$.next(2);
    appService.selectedWorkspaceId = 1;
    appService.selectedWorkspaceId$.next(1);
    expect(closed.observed).toBe(false);
    closed.next({ type: 'testcenter' });
    expect(startImport).not.toHaveBeenCalled();
  });

  it('hands accepted chunked upload jobs to the root tracker after its view closes', () => {
    const acceptedJobs = new Subject<unknown[]>();
    TestBed.inject(FileService).uploadTestResultsChunked = jest.fn(() => acceptedJobs) as never;
    const optionsClosed = new Subject<unknown>();
    const progressRef = { close: jest.fn() };
    jest.mocked(TestBed.inject(MatDialog).open)
      .mockReturnValueOnce({ afterClosed: () => optionsClosed } as never)
      .mockReturnValueOnce(progressRef as never);
    const registerBatch = jest.spyOn(TestBed.inject(TestResultsUploadStateService), 'registerBatch')
      .mockImplementation(() => undefined);
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [new File(['data'], 'results.csv')] });
    component.onFileSelected(input, 'responses');
    optionsClosed.next({ overwriteMode: 'skip', scope: 'person' });
    optionsClosed.complete();
    fixture.destroy();
    appService.selectedWorkspaceId = 2;
    appService.selectedWorkspaceId$.next(2);
    expect(acceptedJobs.observed).toBe(true);
    acceptedJobs.next([{ jobId: 'accepted-job' }]);
    acceptedJobs.complete();
    expect(registerBatch).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 1, jobIds: ['accepted-job'] }),
      expect.objectContaining({ dialogRef: progressRef })
    );
  });

  it('cleans up a failed background upload even after the starting view closes', () => {
    const acceptedJobs = new Subject<unknown[]>();
    TestBed.inject(FileService).uploadTestResultsChunked = jest.fn(() => acceptedJobs) as never;
    const progressRef = { close: jest.fn() };
    const dialog = TestBed.inject(MatDialog);
    jest.mocked(dialog.open)
      .mockReturnValueOnce({ afterClosed: () => of({ overwriteMode: 'skip', scope: 'person' }) } as never)
      .mockReturnValueOnce(progressRef as never);
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [new File(['data'], 'results.csv')] });
    component.onFileSelected(input, 'responses');
    const progressState = (jest.mocked(dialog.open).mock.calls[1][1]?.data as {
      state$: Subject<unknown>;
    }).state$;
    fixture.destroy();
    acceptedJobs.error(new Error('Upload failed'));
    expect(progressRef.close).toHaveBeenCalled();
    expect(progressState.isStopped).toBe(true);
    expect(TestBed.inject(MatSnackBar).open).toHaveBeenCalledWith(
      'Fehler beim Upload-Start: Upload failed', 'Fehler', { duration: 5000 }
    );
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        MatCheckboxModule,
        MatTooltipModule,
        MatIconModule,
        MatTableModule,
        TranslateModule.forRoot()
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideRouter([]),
        {
          provide: SERVER_URL,
          useValue: environment.backendUrl
        },
        {
          provide: MatSnackBar,
          useValue: { open: jest.fn().mockReturnValue({ dismiss: jest.fn() }) }
        },
        {
          provide: MatDialog,
          useValue: { open: jest.fn(), closeAll: jest.fn() }
        },
        {
          provide: TestResultBackendService,
          useValue: {
            getTestResults: jest.fn().mockReturnValue(of([])),
            getTestResultsOverview: jest.fn().mockReturnValue(of({})),
            getExportTestResultsJobs: jest.fn().mockReturnValue(of([]))
          }
        },
        {
          provide: ValidationService,
          useValue: {
            getValidationStatus: jest.fn().mockReturnValue(of({})),
            getValidationTask: jest.fn(),
            getValidationResults: jest.fn()
          }
        },
        {
          provide: UnitNoteService,
          useValue: { getUnitNotes: jest.fn().mockReturnValue(of([])) }
        },
        {
          provide: FileService,
          useValue: { getBookletInfo: jest.fn(), getUnitInfo: jest.fn(), getFilesList: jest.fn().mockReturnValue(of({ data: [] })) }
        },
        {
          provide: ResponseService,
          useValue: {
            getResponses: jest.fn().mockReturnValue(of([])),
            deleteResponse: jest.fn().mockReturnValue(of({
              success: true,
              report: { deletedResponse: 1, warnings: [] }
            }))
          }
        },
        {
          provide: UnitService,
          useValue: {
            getUnits: jest.fn().mockReturnValue(of([])),
            deleteUnit: jest.fn().mockReturnValue(of({
              success: true,
              report: { deletedUnit: 1, warnings: [] }
            }))
          }
        },
        {
          provide: CodingStatisticsService,
          useValue: {
            getCodingStatistics: jest.fn().mockReturnValue(of({})),
            getCodingFreshness: jest.fn().mockReturnValue(of({
              workspaceId: 1,
              currentRevision: 0,
              items: []
            }))
          }
        },
        {
          provide: TestPersonCodingService,
          useValue: {
            notifyTestResultsChanged: jest.fn(),
            invalidateCodingStatusCache: jest.fn(),
            getAppliedResultsOverview: jest.fn().mockReturnValue(of({
              totalIncompleteResponses: 0,
              appliedResponses: 0,
              remainingResponses: 0,
              completionPercentage: 100,
              rawTotalIncompleteResponses: 0,
              rawAppliedResponses: 0,
              rawCompletionPercentage: 100,
              aggregationActive: false,
              aggregationThreshold: null,
              aggregatedDuplicateCases: 0
            }))
          }
        },
        {
          provide: VariableAnalysisService,
          useValue: { getVariableAnalysis: jest.fn().mockReturnValue(of([])) }
        },
        {
          provide: AppService,
          useValue: {
            selectedWorkspaceId: 1,
            selectedWorkspaceId$: new Subject<number>(),
            loggedUser: { sub: 'user' },
            createOwnToken: jest.fn().mockReturnValue(of('token'))
          }
        },
        {
          provide: WorkspaceSettingsService,
          useValue: {
            getShowTestResultsLogAnomalies: jest.fn().mockReturnValue(of(false)),
            getEnableRegexSearch: jest.fn().mockReturnValue(of(true)),
            getAutoRefreshManualCodingJobs: jest.fn().mockReturnValue(of(true))
          }
        },
        {
          provide: TestResultService,
          useValue: {
            getTestResults: jest.fn().mockReturnValue(of({
              data: [],
              total: 0
            })),
            getWorkspaceOverview: jest.fn().mockReturnValue(of({})),
            getLogAnomalySummary: jest.fn().mockReturnValue(of({
              totalBooklets: 0,
              affectedBooklets: 0,
              criticalBooklets: 0,
              warningBooklets: 0,
              infoBooklets: 0,
              totalAnomalyRules: 0,
              totalAnomalyEvents: 0,
              byCode: {}
            })),
            getLogAnomalyDetails: jest.fn().mockReturnValue(of({
              total: 0,
              data: []
            })),
            invalidateCache: jest.fn(),
            flatResponseFilterRequests$: of(),
            previewDeleteTestResults: jest.fn().mockReturnValue(of(null)),
            createDeleteTestResultsJob: jest.fn(),
            previewDeleteTestLogs: jest.fn().mockReturnValue(of(null)),
            createDeleteTestLogsJob: jest.fn()
          }
        },
        {
          provide: ValidationTaskStateService,
          useValue: {
            getValidationStatus: jest.fn().mockReturnValue(of({})),
            getAllTaskIds: jest.fn().mockReturnValue({}),
            getAllValidationResults: jest.fn().mockReturnValue({}),
            observeTaskIds: jest.fn().mockReturnValue(of({})),
            observeValidationResults: jest.fn().mockReturnValue(of({})),
            observeBatchState: jest.fn().mockReturnValue(of({ status: 'idle' }))
          }
        },
        {
          provide: UnitsReplayService,
          useValue: { getUnitsFromFileUpload: jest.fn().mockReturnValue(of(null)) }
        }
      ]
    }).compileComponents();

    const translateService = TestBed.inject(TranslateService);
    translateService.setTranslation('de', {
      'coding-management': {
        readiness: {
          'title-manual-coding-open': 'Manuelle Kodierung abschließen',
          'second-autocoding-waits-summary': 'Auto-Coding 2 ist der nächste Schritt, sobald die manuelle Kodierung abgeschlossen ist. Schließen Sie zuerst die offenen manuellen Kodierfälle ab und übernehmen Sie die Ergebnisse.{{remaining}}',
          'second-autocoding-waits-remaining': ' Es sind noch {{count}} manuelle Kodierergebnisse offen.',
          'manual-results-overview-load-failed': 'Der Stand der manuellen Kodierung konnte nicht geprüft werden. Auto-Coding 2 bleibt gesperrt, bis die Prüfung erfolgreich aktualisiert wurde.',
          'second-autocoding-waits-help': 'Der Start von Auto-Coding 2 bleibt bis dahin gesperrt. {{taskResultHelp}}',
          'second-autocoding-waits-chip': '{{version}}: {{count}} wartet'
        }
      },
      'response-status': {
        tooltips: {
          DERIVE_ERROR: 'DERIVE_ERROR bedeutet: Ableitung/Solver fehlgeschlagen, z. B. Typkonflikt im Kodierschema. Keine inhaltlich falsche Antwort.'
        }
      },
      'test-results-page': {
        'coding-status': {
          'manual-title': 'Kodierstatus wird manuell aktualisiert',
          'manual-text': 'Automatische Statusprüfungen sind für diesen Arbeitsbereich deaktiviert. Aktualisieren Sie den Kodierstatus nur bei Bedarf.',
          refresh: 'Kodierstatus aktualisieren'
        }
      }
    });
    translateService.use('de');

    fixture = TestBed.createComponent(TestResultsComponent);
    component = fixture.componentInstance;
    unitsReplayService = TestBed.inject(UnitsReplayService) as unknown as { getUnitsFromFileUpload: jest.Mock };
    appService = TestBed.inject(AppService) as unknown as { selectedWorkspaceId: number; loggedUser: { sub: string }; createOwnToken: jest.Mock };
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should not load log anomaly summary automatically on init', () => {
    const testResultService = TestBed.inject(TestResultService) as unknown as {
      getLogAnomalySummary: jest.Mock;
    };

    expect(testResultService.getLogAnomalySummary).not.toHaveBeenCalled();
    expect(component.logAnomalySummaryRequested()).toBe(false);
  });

  it('should load the workspace regex setting for the flat table', () => {
    expect(component.enableRegexSearch()).toBe(true);
  });

  it('should not show manual coding status controls on the test results page', () => {
    (component as unknown as {
      setAutoRefreshCodingStatus: (enabled: boolean) => void;
    }).setAutoRefreshCodingStatus(false);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain(
      'Kodierstatus wird manuell aktualisiert'
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      'test-results-page.coding-status.manual-title'
    );
  });

  it('should hide log quality when disabled by workspace setting', () => {
    expect(component.showTestResultsLogAnomalies()).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('Log-Qualität');
  });

  it('should use centralized DERIVE_ERROR tooltip text', () => {
    expect(component.getResponseStatusTooltip('DERIVE_ERROR'))
      .toBe('DERIVE_ERROR bedeutet: Ableitung/Solver fehlgeschlagen, z. B. Typkonflikt im Kodierschema. Keine inhaltlich falsche Antwort.');
  });

  it('should show clearer overview labels and formatted counts without translating technical statuses', () => {
    component.overview.set({
      testPersons: 135,
      testGroups: 6,
      uniqueBooklets: 48,
      uniqueUnits: 338,
      uniqueResponses: 63653,
      responseStatusCounts: {
        DISPLAYED: 40962,
        VALUE_CHANGED: 16681,
        NOT_REACHED: 3726,
        UNSET: 2284
      },
      sessionBrowserCounts: {},
      sessionOsCounts: {},
      sessionScreenCounts: {}
    });

    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Testergebnis-Übersicht');
    expect(text).toContain('Verschiedene Aufgaben');
    expect(text).toContain('Verschiedene Testhefte');
    expect(text).toContain('Antwortwerte gesamt');
    expect(text).toMatch(/63[.,]653/);
    expect(text).toContain('DISPLAYED');
    expect(text).toMatch(/64[.,]4%/);
    expect(text).not.toContain('Angezeigt');
  });

  it('should open the flat table filtered by the selected technical response status', () => {
    component.overview.set({
      testPersons: 135,
      testGroups: 6,
      uniqueBooklets: 48,
      uniqueUnits: 338,
      uniqueResponses: 63653,
      responseStatusCounts: {
        DISPLAYED: 40962
      },
      sessionBrowserCounts: {},
      sessionOsCounts: {},
      sessionScreenCounts: {}
    });
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const statusButton = Array.from(
      root.querySelectorAll('.status-chip') as NodeListOf<HTMLButtonElement>
    ).find(button => button.textContent?.includes('DISPLAYED')) as HTMLButtonElement;

    statusButton.click();

    expect(component.quickSearchTableFilters()).toEqual({ responseStatus: 'DISPLAYED' });
    expect(component.forceShowLogAnomalyTableColumn()).toBe(false);
    expect(component.isTableView()).toBe(true);
  });

  it('should show log quality when enabled by workspace setting', () => {
    component.showTestResultsLogAnomalies.set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Log-Qualität');
  });

  it('should reload workspace overview after deleting a unit', () => {
    const dialog = TestBed.inject(MatDialog) as unknown as { open: jest.Mock };
    const unitService = TestBed.inject(UnitService) as unknown as {
      deleteUnit: jest.Mock;
    };
    const testResultService = TestBed.inject(TestResultService) as unknown as {
      getWorkspaceOverview: jest.Mock;
    };
    const testPersonCodingService = TestBed.inject(TestPersonCodingService) as unknown as {
      notifyTestResultsChanged: jest.Mock;
    };
    const unit = { id: 7, alias: 'Unit 7', name: 'Unit 7' };
    const booklet = { units: [unit] };

    testResultService.getWorkspaceOverview.mockClear();
    dialog.open.mockReturnValue({ afterClosed: () => of(true) });
    unitService.deleteUnit.mockReturnValue(of({
      success: true,
      report: { deletedUnit: 7, warnings: [] }
    }));

    component.deleteUnit(unit as never, booklet as never);

    expect(testResultService.getWorkspaceOverview).toHaveBeenCalledWith(1);
    expect(testPersonCodingService.notifyTestResultsChanged).toHaveBeenCalled();
  });

  it('updates derived unit order without mutating booklet snapshots', () => {
    const units = [
      { id: 7, alias: 'Z', name: 'Unit 7' },
      { id: 8, alias: '', name: 'A' }
    ];
    component.booklets.set([{ id: 1, name: 'Booklet', units }] as never);
    const originalBooklets = component.booklets();
    const unitOrder = computed(() => component.booklets().map(
      booklet => booklet.units.map(unit => unit.id)
    ));
    expect(unitOrder()).toEqual([[7, 8]]);

    component.sortBookletUnits();

    expect(unitOrder()).toEqual([[8, 7]]);
    expect(originalBooklets[0].units.map(unit => unit.id)).toEqual([7, 8]);
    expect(component.booklets()[0]).not.toBe(originalBooklets[0]);
    expect(component.booklets()[0].units).not.toBe(originalBooklets[0].units);
  });

  it('updates derived units after delayed deletion without mutating booklet snapshots', async () => {
    const dialog = TestBed.inject(MatDialog) as unknown as { open: jest.Mock };
    const unitService = TestBed.inject(UnitService) as unknown as { deleteUnit: jest.Mock };
    const deleteResponse = new Subject<{
      success: boolean;
      report: { deletedUnit: number; warnings: string[] };
    }>();
    const unit = { id: 7, alias: 'Unit 7', name: 'Unit 7' };
    const booklet = { id: 1, name: 'Booklet 1', units: [unit, { id: 8, alias: 'Unit 8', name: 'Unit 8' }] };
    const otherBooklet = { id: 2, name: 'Booklet 2', units: [{ id: 9, alias: 'Unit 9', name: 'Unit 9' }] };
    component.booklets.set([booklet, otherBooklet] as never);
    const originalBooklets = component.booklets();
    const unitIds = computed(() => component.booklets().map(
      current => current.units.map(currentUnit => currentUnit.id)
    ));
    expect(unitIds()).toEqual([[7, 8], [9]]);
    dialog.open.mockReturnValue({ afterClosed: () => of(true) });
    unitService.deleteUnit.mockReturnValue(deleteResponse.asObservable());

    component.deleteUnit(unit as never, booklet as never);
    await fixture.whenStable();
    expect(unitIds()).toEqual([[7, 8], [9]]);

    deleteResponse.next({ success: true, report: { deletedUnit: 7, warnings: [] } });
    deleteResponse.complete();
    await fixture.whenStable();

    expect(unitIds()).toEqual([[8], [9]]);
    expect(originalBooklets[0].units.map(current => current.id)).toEqual([7, 8]);
    expect(component.booklets()[0]).not.toBe(originalBooklets[0]);
    expect(component.booklets()[1]).toBe(originalBooklets[1]);
  });

  it('updates derived expanded responses without mutating response snapshots', () => {
    component.responses.set([
      { id: 13, variableid: 'VAR_1', expanded: false },
      { id: 14, variableid: 'VAR_2', expanded: false }
    ] as never);
    const originalResponses = component.responses();
    const expandedIds = computed(() => component.responses()
      .filter(response => response.expanded).map(response => response.id));
    expect(expandedIds()).toEqual([]);

    component.toggleResponseExpansion(13);
    const expandedResponses = component.responses();
    expect(expandedIds()).toEqual([13]);
    expect(originalResponses[0].expanded).toBe(false);
    expect(expandedResponses[1]).toBe(originalResponses[1]);

    component.toggleResponseExpansion(13);
    expect(expandedIds()).toEqual([]);
    expect(expandedResponses[0].expanded).toBe(true);
  });

  it('should reload workspace overview after deleting a response', () => {
    const dialog = TestBed.inject(MatDialog) as unknown as { open: jest.Mock };
    const responseService = TestBed.inject(ResponseService) as unknown as {
      deleteResponse: jest.Mock;
    };
    const testResultService = TestBed.inject(TestResultService) as unknown as {
      getWorkspaceOverview: jest.Mock;
    };
    const testPersonCodingService = TestBed.inject(TestPersonCodingService) as unknown as {
      notifyTestResultsChanged: jest.Mock;
    };
    const response = { id: 13, variableid: 'VAR_1' };

    component.responses.set([response] as never);
    testResultService.getWorkspaceOverview.mockClear();
    dialog.open.mockReturnValue({ afterClosed: () => of(true) });
    responseService.deleteResponse.mockReturnValue(of({
      success: true,
      report: { deletedResponse: 13, warnings: [] }
    }));

    component.deleteResponse(response as never);

    expect(testResultService.getWorkspaceOverview).toHaveBeenCalledWith(1);
    expect(testPersonCodingService.notifyTestResultsChanged).toHaveBeenCalled();
  });

  it('should refresh overview and coding state after flat-table response deletion', () => {
    const testResultService = TestBed.inject(TestResultService) as unknown as {
      getWorkspaceOverview: jest.Mock;
      invalidateCache: jest.Mock;
    };
    const testPersonCodingService = TestBed.inject(TestPersonCodingService) as unknown as {
      notifyTestResultsChanged: jest.Mock;
    };

    testResultService.getWorkspaceOverview.mockClear();
    component.onFlatTableResponseDeleted();

    expect(testResultService.invalidateCache).toHaveBeenCalledWith(1);
    expect(testResultService.getWorkspaceOverview).toHaveBeenCalledWith(1);
    expect(testPersonCodingService.notifyTestResultsChanged).toHaveBeenCalled();
  });

  it('should not refresh coding state after flat-table deletion when auto refresh is disabled', () => {
    const testResultService = TestBed.inject(TestResultService) as unknown as {
      getWorkspaceOverview: jest.Mock;
      invalidateCache: jest.Mock;
    };
    const codingStatisticsService = TestBed.inject(CodingStatisticsService) as unknown as {
      getCodingFreshness: jest.Mock;
    };
    const testPersonCodingService = TestBed.inject(TestPersonCodingService) as unknown as {
      getAppliedResultsOverview: jest.Mock;
      notifyTestResultsChanged: jest.Mock;
    };

    codingStatisticsService.getCodingFreshness.mockClear();
    testPersonCodingService.getAppliedResultsOverview.mockClear();
    (component as unknown as {
      setAutoRefreshCodingStatus: (enabled: boolean) => void;
    }).setAutoRefreshCodingStatus(false);

    component.onFlatTableResponseDeleted();

    expect(testResultService.invalidateCache).toHaveBeenCalledWith(1);
    expect(testResultService.getWorkspaceOverview).toHaveBeenCalledWith(1);
    expect(codingStatisticsService.getCodingFreshness).not.toHaveBeenCalled();
    expect(testPersonCodingService.getAppliedResultsOverview).not.toHaveBeenCalled();
    expect(testPersonCodingService.notifyTestResultsChanged).toHaveBeenCalled();
  });

  it('should ignore stale manual coding status responses after status was cleared', () => {
    const codingStatisticsService = TestBed.inject(CodingStatisticsService) as unknown as {
      getCodingFreshness: jest.Mock;
    };
    const testPersonCodingService = TestBed.inject(TestPersonCodingService) as unknown as {
      getAppliedResultsOverview: jest.Mock;
    };
    const codingFreshness$ = new Subject<unknown>();
    const appliedResults$ = new Subject<unknown>();

    codingStatisticsService.getCodingFreshness.mockReturnValue(
      codingFreshness$.asObservable()
    );
    testPersonCodingService.getAppliedResultsOverview.mockReturnValue(
      appliedResults$.asObservable()
    );
    (component as unknown as {
      setAutoRefreshCodingStatus: (enabled: boolean) => void;
    }).setAutoRefreshCodingStatus(false);

    (component as unknown as {
      loadCodingFreshnessStatus: (options?: { force?: boolean }) => void;
    }).loadCodingFreshnessStatus({ force: true });
    component.onFlatTableResponseDeleted();
    codingFreshness$.next({ items: [] });
    codingFreshness$.complete();
    appliedResults$.next({ appliedResponses: 5 });
    appliedResults$.complete();

    expect(component.codingFreshnessSummary()).toBeNull();
    expect(component.manualAppliedResultsOverview()).toBeNull();
    expect(component.isLoadingCodingFreshnessStatus()).toBe(false);
    expect(component.isLoadingManualAppliedResultsOverview()).toBe(false);
  });

  it('should keep the last workspace overview while a reload has no result yet', () => {
    const testResultService = TestBed.inject(TestResultService) as unknown as {
      getWorkspaceOverview: jest.Mock;
    };
    const previousOverview = {
      testPersons: 47,
      testGroups: 2,
      uniqueBooklets: 47,
      uniqueUnits: 320,
      uniqueResponses: 10249,
      responseStatusCounts: {},
      sessionBrowserCounts: {},
      sessionOsCounts: {},
      sessionScreenCounts: {}
    };

    component.overview.set(previousOverview);
    testResultService.getWorkspaceOverview.mockReturnValue(of(null));

    (component as unknown as { loadWorkspaceOverview: () => void })
      .loadWorkspaceOverview();

    expect(component.overview()).toBe(previousOverview);
    expect(component.isLoadingOverview()).toBe(false);
  });

  it('should expose log anomaly summary load failures', () => {
    const testResultService = TestBed.inject(TestResultService) as unknown as {
      getLogAnomalySummary: jest.Mock;
    };

    component.showTestResultsLogAnomalies.set(true);
    component.logAnomalySummary.set({
      totalBooklets: 10,
      affectedBooklets: 1,
      criticalBooklets: 1,
      warningBooklets: 0,
      infoBooklets: 0,
      totalAnomalyRules: 1,
      totalAnomalyEvents: 1,
      byCode: { controller_error: 1 }
    });
    testResultService.getLogAnomalySummary.mockReturnValue(
      throwError(() => new Error('summary failed'))
    );

    (component as unknown as { loadLogAnomalySummary: () => void })
      .loadLogAnomalySummary();

    expect(component.logAnomalySummary()).toBeNull();
    expect(component.logAnomalySummaryLoadFailed()).toBe(true);
    expect(component.isLoadingLogAnomalySummary()).toBe(false);
    expect(component.logAnomalySummaryRequested()).toBe(true);
  });

  it('should force the log anomaly table column for the dashboard table action', () => {
    component.showTestResultsLogAnomalies.set(true);
    component.forceShowLogAnomalyTableColumn.set(false);

    component.showLogAnomaliesInTable();

    expect(component.quickSearchTableFilters()).toEqual({ logAnomalies: 'any' });
    expect(component.forceShowLogAnomalyTableColumn()).toBe(true);
    expect(component.isTableView()).toBe(true);
  });

  it('should not force the log anomaly table column when workspace setting is disabled', () => {
    component.showTestResultsLogAnomalies.set(false);
    component.forceShowLogAnomalyTableColumn.set(false);

    component.showLogAnomaliesInTable();

    expect(component.quickSearchTableFilters()).toEqual({ logAnomalies: 'any' });
    expect(component.forceShowLogAnomalyTableColumn()).toBe(false);
    expect(component.isTableView()).toBe(true);
  });

  it('should open booklet replay in booklet-view mode with a clean hash URL', () => {
    const windowOpenSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    const bookletReplay = {
      id: 0,
      name: 'BOOKLET_Ä',
      currentUnitIndex: 0,
      skippedUnits: 0,
      totalBookletUnits: 1,
      units: [
        {
          id: 1,
          name: 'UNIT_1',
          alias: 'Unit 1',
          bookletId: 0
        }
      ]
    };

    unitsReplayService.getUnitsFromFileUpload.mockReturnValue(of(bookletReplay));
    appService.createOwnToken.mockReturnValue(of('token'));
    component.testPerson.set({
      login: 'login',
      code: 'code',
      group: 'group'
    } as never);

    component.replayBooklet({ name: 'BOOKLET_Ä' } as never);

    expect(unitsReplayService.getUnitsFromFileUpload).toHaveBeenCalledWith(
      1,
      'BOOKLET_Ä',
      'login@code@group@BOOKLET_Ä'
    );
    expect(windowOpenSpy).toHaveBeenCalledWith(expect.any(String), '_blank');
    const openedUrl = windowOpenSpy.mock.calls[0][0] as string;
    expect(openedUrl).toContain('/#/replay/');
    expect(openedUrl).toContain('mode=booklet-view');
    expect(openedUrl).toContain('unitsData=');
    expect(openedUrl).not.toContain('#//replay');

    windowOpenSpy.mockRestore();
  });

  it('should open booklet replay for test persons without a code', () => {
    const windowOpenSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    const bookletReplay = {
      id: 0,
      name: 'BOOKLET_A',
      currentUnitIndex: 0,
      skippedUnits: 0,
      totalBookletUnits: 1,
      units: [
        {
          id: 1,
          name: 'UNIT_1',
          alias: 'Unit 1',
          bookletId: 0
        }
      ]
    };

    unitsReplayService.getUnitsFromFileUpload.mockReturnValue(of(bookletReplay));
    appService.createOwnToken.mockReturnValue(of('token'));
    component.testPerson.set({
      login: 'login',
      code: '',
      group: 'group'
    } as never);

    component.replayBooklet({ name: 'BOOKLET_A' } as never);

    expect(unitsReplayService.getUnitsFromFileUpload).toHaveBeenCalledWith(
      1,
      'BOOKLET_A',
      'login@@group@BOOKLET_A'
    );
    expect(windowOpenSpy).toHaveBeenCalledWith(expect.any(String), '_blank');

    windowOpenSpy.mockRestore();
  });

  it('should show Testcenter import results when overview loads with zero delta', async () => {
    const dialog = TestBed.inject(MatDialog) as unknown as { open: jest.Mock };
    const testResultService = TestBed.inject(TestResultService) as unknown as {
      getWorkspaceOverview: jest.Mock;
      invalidateCache: jest.Mock;
    };
    const progressClose = jest.fn();
    const overview = {
      testPersons: 45,
      testGroups: 2,
      uniqueBooklets: 47,
      uniqueUnits: 320,
      uniqueResponses: 10219,
      responseStatusCounts: {
        DISPLAYED: 7414,
        NOT_REACHED: 289,
        VALUE_CHANGED: 2298,
        UNSET: 218
      },
      sessionBrowserCounts: {},
      sessionOsCounts: {},
      sessionScreenCounts: {}
    };

    testResultService.getWorkspaceOverview.mockReturnValue(of(overview));
    dialog.open.mockImplementation((componentType: unknown) => {
      if (componentType === TestCenterImportComponent) {
        return {
          afterClosed: () => of({
            didImport: true,
            resultType: 'responses',
            importedResponses: true,
            importedLogs: false,
            uploadResult: {
              success: true,
              issues: [],
              codingFreshness: {
                workspaceId: 1,
                currentRevision: 0,
                items: []
              }
            }
          })
        };
      }

      if (componentType === TestResultsImportProgressDialogComponent) {
        return { close: progressClose };
      }

      return { close: jest.fn(), afterClosed: () => of(undefined) };
    });

    await component.testCenterImport();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const resultCall = dialog.open.mock.calls.find(
      ([componentType]) => componentType === TestResultsUploadResultDialogComponent
    );

    expect(progressClose).toHaveBeenCalled();
    expect(resultCall).toBeTruthy();
    expect(resultCall?.[1]).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        result: expect.objectContaining({
          overviewPending: false,
          delta: expect.objectContaining({
            testPersons: 0,
            testGroups: 0,
            uniqueBooklets: 0,
            uniqueUnits: 0,
            uniqueResponses: 0
          }),
          responseStatusCounts: overview.responseStatusCounts
        })
      })
    }));
  });

  it.each(['destroy', 'workspace'])('cancels the initial Testcenter overview and never opens a late dialog on %s', async reason => {
    const reply = new Subject<unknown>();
    const service = TestBed.inject(TestResultService) as unknown as { getWorkspaceOverview: jest.Mock };
    service.getWorkspaceOverview.mockReturnValue(reply);
    const pending = component.testCenterImport();
    expect(reply.observed).toBe(true);
    if (reason === 'destroy') fixture.destroy();
    if (reason === 'workspace') {
      appService.selectedWorkspaceId = 2;
      appService.selectedWorkspaceId$.next(2);
      appService.selectedWorkspaceId = 1;
      appService.selectedWorkspaceId$.next(1);
    }
    expect(reply.observed).toBe(false);
    reply.next({ testPersons: 12 });
    await pending;
    expect(TestBed.inject(MatDialog).open).not.toHaveBeenCalled();
  });

  it('cancels the post-import overview and closes progress without opening late results', async () => {
    const service = TestBed.inject(TestResultService) as unknown as { getWorkspaceOverview: jest.Mock };
    const initial = {
      testPersons: 1,
      testGroups: 1,
      uniqueBooklets: 1,
      uniqueUnits: 1,
      uniqueResponses: 1,
      responseStatusCounts: {},
      sessionBrowserCounts: {},
      sessionOsCounts: {},
      sessionScreenCounts: {}
    };
    const reply = new Subject<unknown>();
    const closed = new Subject<unknown>();
    const progressClose = jest.fn();
    const importClose = jest.fn();
    service.getWorkspaceOverview.mockReturnValueOnce(of(initial)).mockReturnValue(reply);
    const dialog = TestBed.inject(MatDialog) as unknown as { open: jest.Mock };
    dialog.open.mockImplementation((componentType: unknown) => {
      if (componentType === TestCenterImportComponent) return { close: importClose, afterClosed: () => closed };
      if (componentType === TestResultsImportProgressDialogComponent) return { close: progressClose };
      return { close: jest.fn() };
    });
    await component.testCenterImport();
    closed.next({ didImport: true, resultType: 'responses' });
    expect(reply.observed).toBe(true);
    fixture.destroy();
    expect(reply.observed).toBe(false);
    reply.next(initial);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(progressClose).toHaveBeenCalledTimes(1);
    expect(dialog.open.mock.calls.some(([type]) => type === TestResultsUploadResultDialogComponent)).toBe(false);
  });

  it('should ignore zero-count coding freshness rows in the overview banner', () => {
    component.codingFreshnessSummary.set({
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
    });

    expect(component.codingFreshnessWarnings()).toEqual([]);
    expect(component.hasCodingFreshnessWarning()).toBe(false);
    expect(component.codingFreshnessBannerTitle).toBe('Kodierstand aktuell');
  });

  it('should show second auto-coding as waiting while manual coding results are still open', () => {
    component.codingFreshnessSummary.set({
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
    });
    component.manualAppliedResultsOverview.set({
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
    });

    expect(component.hasCodingFreshnessWarning()).toBe(true);
    expect(component.codingFreshnessWarnings()).toEqual([]);
    expect(component.codingFreshnessDisplayWarnings()).toHaveLength(1);
    expect(component.codingFreshnessBannerTitle).toBe('Manuelle Kodierung abschließen');
    expect(component.codingFreshnessSummaryText).toContain('Auto-Coding 2 ist der nächste Schritt');
    expect(component.codingFreshnessSummaryText).toContain('461 manuelle Kodierergebnisse offen');
    expect(component.getCodingFreshnessChipLabel(component.codingFreshnessDisplayWarnings()[0])).toBe(
      'Auto-Coding 2: 671 Aufgabenbearbeitungen wartet'
    );
    expect(component.codingFreshnessActionLabel()).toBe('Manuelle Kodierung öffnen');
  });

  it('should hide second auto-coding while the manual coding status is still loading', () => {
    component.codingFreshnessSummary.set({
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
    });
    component.manualAppliedResultsOverview.set({
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
    });
    component.manualAppliedResultsOverviewLoadFailed.set(false);
    component.isLoadingManualAppliedResultsOverview.set(true);

    expect(component.hasCodingFreshnessWarning()).toBe(false);
    expect(component.codingFreshnessWarnings()).toEqual([]);
    expect(component.codingFreshnessDisplayWarnings()).toEqual([]);
  });

  it('should show second auto-coding as actionable once manual coding is complete', () => {
    component.codingFreshnessSummary.set({
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
    });
    component.manualAppliedResultsOverview.set({
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
    });

    expect(component.codingFreshnessWarnings()).toHaveLength(1);
    expect(component.codingFreshnessBannerTitle).toBe('Auto-Coding starten');
    expect(component.codingFreshnessSummaryText).toBe(
      '671 Aufgabenbearbeitungen benötigen Auto-Coding 2. ' +
      'Dabei werden 5098 Antwortwerte berücksichtigt.'
    );
    expect(component.codingFreshnessActionLabel()).toBe('Auto-Coding öffnen');
  });

  it('should keep earlier auto-coding warnings actionable while second auto-coding waits', () => {
    component.codingFreshnessSummary.set({
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
    });
    component.manualAppliedResultsOverview.set({
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
    });

    expect(component.codingFreshnessWarnings()).toEqual([
      expect.objectContaining({ version: 'v1' })
    ]);
    expect(component.codingFreshnessBannerTitle).toBe('Auto-Coding starten');
    expect(component.codingFreshnessSummaryText).toBe(
      '10 Aufgabenbearbeitungen benötigen Auto-Coding 1. ' +
      'Dabei werden 50 Antwortwerte berücksichtigt.'
    );
    expect(component.codingFreshnessActionLabel()).toBe('Auto-Coding öffnen');
  });
  it.each(['booklet', 'unit'].flatMap(kind => ['destroy', 'workspace'].flatMap(end => ['success', 'error'].map(outcome => ({ kind, end, outcome })))))('ignores delayed $kind $outcome after $end', async ({ kind, end, outcome }) => {
    const response = new Subject<unknown>();
    const files = TestBed.inject(FileService) as unknown as { getBookletInfo: jest.Mock; getUnitInfo: jest.Mock };
    files.getBookletInfo.mockReturnValue(response);
    files.getUnitInfo.mockReturnValue(response);
    component.selectedUnit.set({ id: 10, name: 'UNIT' } as NonNullable<ReturnType<TestResultsComponent['selectedUnit']>>);
    const snack = TestBed.inject(MatSnackBar).open as jest.Mock;
    snack.mockClear();
    if (kind === 'booklet') component.openBookletInfo('BOOKLET');
    else component.openUnitInfoForSelectedUnit();
    const loading = snack.mock.results[0].value;
    if (end === 'destroy') fixture.destroy();
    else appService.selectedWorkspaceId = 2;
    if (outcome === 'error') response.error(new Error('Synthetic error'));
    else { response.next({}); response.complete(); }
    await fixture.whenStable();
    expect(TestBed.inject(MatDialog).open).not.toHaveBeenCalled();
    expect(snack).toHaveBeenCalledTimes(1);
    expect(loading.dismiss).toHaveBeenCalled();
  });
});
