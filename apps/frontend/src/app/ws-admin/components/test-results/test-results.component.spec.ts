// eslint-disable-next-line max-classes-per-file
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';
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

describe('TestResultsComponent', () => {
  let component: TestResultsComponent;
  let fixture: ComponentFixture<TestResultsComponent>;
  let unitsReplayService: { getUnitsFromFileUpload: jest.Mock };
  let appService: { selectedWorkspaceId: number; loggedUser: { sub: string }; createOwnToken: jest.Mock };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        MatCheckboxModule,
        MatTooltipModule,
        MatIconModule,
        MatTableModule,
        NoopAnimationsModule,
        TranslateModule.forRoot()
      ],
      providers: [
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
          useValue: { getFilesList: jest.fn().mockReturnValue(of({ data: [] })) }
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
            loggedUser: { sub: 'user' },
            createOwnToken: jest.fn().mockReturnValue(of('token'))
          }
        },
        {
          provide: WorkspaceSettingsService,
          useValue: {
            getShowTestResultsLogAnomalies: jest.fn().mockReturnValue(of(false))
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
    expect(component.logAnomalySummaryRequested).toBe(false);
  });

  it('should hide log quality when disabled by workspace setting', () => {
    expect(component.showTestResultsLogAnomalies).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('Log-Qualität');
  });

  it('should use centralized DERIVE_ERROR tooltip text', () => {
    expect(component.getResponseStatusTooltip('DERIVE_ERROR'))
      .toBe('DERIVE_ERROR bedeutet: Ableitung/Solver fehlgeschlagen, z. B. Typkonflikt im Kodierschema. Keine inhaltlich falsche Antwort.');
  });

  it('should show log quality when enabled by workspace setting', () => {
    component.showTestResultsLogAnomalies = true;
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

    component.responses = [response] as never;
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

    component.overview = previousOverview;
    testResultService.getWorkspaceOverview.mockReturnValue(of(null));

    (component as unknown as { loadWorkspaceOverview: () => void })
      .loadWorkspaceOverview();

    expect(component.overview).toBe(previousOverview);
    expect(component.isLoadingOverview).toBe(false);
  });

  it('should expose log anomaly summary load failures', () => {
    const testResultService = TestBed.inject(TestResultService) as unknown as {
      getLogAnomalySummary: jest.Mock;
    };

    component.showTestResultsLogAnomalies = true;
    component.logAnomalySummary = {
      totalBooklets: 10,
      affectedBooklets: 1,
      criticalBooklets: 1,
      warningBooklets: 0,
      infoBooklets: 0,
      totalAnomalyRules: 1,
      totalAnomalyEvents: 1,
      byCode: { controller_error: 1 }
    };
    testResultService.getLogAnomalySummary.mockReturnValue(
      throwError(() => new Error('summary failed'))
    );

    (component as unknown as { loadLogAnomalySummary: () => void })
      .loadLogAnomalySummary();

    expect(component.logAnomalySummary).toBeNull();
    expect(component.logAnomalySummaryLoadFailed).toBe(true);
    expect(component.isLoadingLogAnomalySummary).toBe(false);
    expect(component.logAnomalySummaryRequested).toBe(true);
  });

  it('should force the log anomaly table column for the dashboard table action', () => {
    component.showTestResultsLogAnomalies = true;
    component.forceShowLogAnomalyTableColumn = false;

    component.showLogAnomaliesInTable();

    expect(component.quickSearchTableFilters).toEqual({ logAnomalies: 'any' });
    expect(component.forceShowLogAnomalyTableColumn).toBe(true);
    expect(component.isTableView).toBe(true);
  });

  it('should not force the log anomaly table column when workspace setting is disabled', () => {
    component.showTestResultsLogAnomalies = false;
    component.forceShowLogAnomalyTableColumn = false;

    component.showLogAnomaliesInTable();

    expect(component.quickSearchTableFilters).toEqual({ logAnomalies: 'any' });
    expect(component.forceShowLogAnomalyTableColumn).toBe(false);
    expect(component.isTableView).toBe(true);
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
    component.testPerson = {
      login: 'login',
      code: 'code',
      group: 'group'
    } as never;

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
    component.testPerson = {
      login: 'login',
      code: '',
      group: 'group'
    } as never;

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

  it('should ignore zero-count coding freshness rows in the overview banner', () => {
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

    expect(component.codingFreshnessWarnings).toEqual([]);
    expect(component.hasCodingFreshnessWarning).toBe(false);
    expect(component.codingFreshnessBannerTitle).toBe('Kodierstand aktuell');
  });

  it('should show second auto-coding as waiting while manual coding results are still open', () => {
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

    expect(component.hasCodingFreshnessWarning).toBe(true);
    expect(component.codingFreshnessWarnings).toEqual([]);
    expect(component.codingFreshnessDisplayWarnings).toHaveLength(1);
    expect(component.codingFreshnessBannerTitle).toBe('Manuelle Kodierung abschließen');
    expect(component.codingFreshnessSummaryText).toContain('Auto-Coding 2 ist der nächste Schritt');
    expect(component.codingFreshnessSummaryText).toContain('461 manuelle Kodierergebnisse offen');
    expect(component.getCodingFreshnessChipLabel(component.codingFreshnessDisplayWarnings[0])).toBe(
      'Auto-Coding 2: 671 Aufgabenbearbeitungen wartet'
    );
    expect(component.codingFreshnessActionLabel).toBe('Manuelle Kodierung öffnen');
  });

  it('should hide second auto-coding while the manual coding status is still loading', () => {
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
    component.manualAppliedResultsOverviewLoadFailed = false;
    component.isLoadingManualAppliedResultsOverview = true;

    expect(component.hasCodingFreshnessWarning).toBe(false);
    expect(component.codingFreshnessWarnings).toEqual([]);
    expect(component.codingFreshnessDisplayWarnings).toEqual([]);
  });

  it('should show second auto-coding as actionable once manual coding is complete', () => {
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

    expect(component.codingFreshnessWarnings).toHaveLength(1);
    expect(component.codingFreshnessBannerTitle).toBe('Auto-Coding starten');
    expect(component.codingFreshnessSummaryText).toBe(
      '671 Aufgabenbearbeitungen benötigen Auto-Coding 2. ' +
      'Dabei werden 5098 Antwortwerte berücksichtigt.'
    );
    expect(component.codingFreshnessActionLabel).toBe('Auto-Coding öffnen');
  });

  it('should keep earlier auto-coding warnings actionable while second auto-coding waits', () => {
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

    expect(component.codingFreshnessWarnings).toEqual([
      expect.objectContaining({ version: 'v1' })
    ]);
    expect(component.codingFreshnessBannerTitle).toBe('Auto-Coding starten');
    expect(component.codingFreshnessSummaryText).toBe(
      '10 Aufgabenbearbeitungen benötigen Auto-Coding 1. ' +
      'Dabei werden 50 Antwortwerte berücksichtigt.'
    );
    expect(component.codingFreshnessActionLabel).toBe('Auto-Coding öffnen');
  });
});
