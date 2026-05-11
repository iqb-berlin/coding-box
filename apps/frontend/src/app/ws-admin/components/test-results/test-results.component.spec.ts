// eslint-disable-next-line max-classes-per-file
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { of } from 'rxjs';
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
import { VariableAnalysisService } from '../../../shared/services/response/variable-analysis.service';
import { AppService } from '../../../core/services/app.service';
import { TestResultService } from '../../../shared/services/test-result/test-result.service';
import { ValidationTaskStateService } from '../../../shared/services/validation/validation-task-state.service';
import { UnitsReplayService } from '../../../replay/services/units-replay.service';

describe('TestResultsComponent', () => {
  let component: TestResultsComponent;
  let fixture: ComponentFixture<TestResultsComponent>;
  let unitsReplayService: { getUnitsFromFileUpload: jest.Mock };
  let appService: { selectedWorkspaceId: number; loggedUser: { sub: string }; createToken: jest.Mock };

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
          useValue: { getCodingStatistics: jest.fn().mockReturnValue(of({})) }
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
            createToken: jest.fn().mockReturnValue(of('token'))
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
            invalidateCache: jest.fn(),
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

    fixture = TestBed.createComponent(TestResultsComponent);
    component = fixture.componentInstance;
    unitsReplayService = TestBed.inject(UnitsReplayService) as unknown as { getUnitsFromFileUpload: jest.Mock };
    appService = TestBed.inject(AppService) as unknown as { selectedWorkspaceId: number; loggedUser: { sub: string }; createToken: jest.Mock };
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should reload workspace overview after deleting a unit', () => {
    const dialog = TestBed.inject(MatDialog) as unknown as { open: jest.Mock };
    const unitService = TestBed.inject(UnitService) as unknown as {
      deleteUnit: jest.Mock;
    };
    const testResultService = TestBed.inject(TestResultService) as unknown as {
      getWorkspaceOverview: jest.Mock;
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
  });

  it('should reload workspace overview after deleting a response', () => {
    const dialog = TestBed.inject(MatDialog) as unknown as { open: jest.Mock };
    const responseService = TestBed.inject(ResponseService) as unknown as {
      deleteResponse: jest.Mock;
    };
    const testResultService = TestBed.inject(TestResultService) as unknown as {
      getWorkspaceOverview: jest.Mock;
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

  it('should open booklet replay in booklet-view mode with a clean hash URL', () => {
    const windowOpenSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    const bookletReplay = {
      id: 0,
      name: 'BOOKLET_Ä',
      currentUnitIndex: 0,
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
    appService.createToken.mockReturnValue(of('token'));
    component.testPerson = {
      login: 'login',
      code: 'code',
      group: 'group'
    } as never;

    component.replayBooklet({ name: 'BOOKLET_Ä' } as never);

    expect(windowOpenSpy).toHaveBeenCalledWith(expect.any(String), '_blank');
    const openedUrl = windowOpenSpy.mock.calls[0][0] as string;
    expect(openedUrl).toContain('/#/replay/');
    expect(openedUrl).toContain('mode=booklet-view');
    expect(openedUrl).toContain('unitsData=');
    expect(openedUrl).not.toContain('#//replay');

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
              issues: []
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
});
