import { SimpleChange } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, of } from 'rxjs';
import { FileService } from '../../../shared/services/file/file.service';
import { UnitNoteService } from '../../../shared/services/unit/unit-note.service';
import { CodingStatisticsService } from '../../../coding/services/coding-statistics.service';
import { ResponseService } from '../../../shared/services/response/response.service';
import { AppService } from '../../../core/services/app.service';
import {
  FlatTestResultResponsesResponse,
  TestResultService
} from '../../../shared/services/test-result/test-result.service';
import { WorkspaceSettingsService } from '../../services/workspace-settings.service';
import { TestResultsFlatTableComponent } from './test-results-flat-table.component';

describe('TestResultsFlatTableComponent', () => {
  let fixture: ComponentFixture<TestResultsFlatTableComponent>;
  let component: TestResultsFlatTableComponent;
  let testResultService: {
    getFlatResponses: jest.Mock;
    getFlatResponseFilterOptions: jest.Mock;
    getFlatResponseFrequencies: jest.Mock;
    workspaceCacheInvalidated$: Subject<number>;
  };
  let workspaceSettingsService: {
    getShowTestResultsLogAnomalies: jest.Mock;
  };

  const emptyFilterOptions = {
    codes: [],
    groups: [],
    logins: [],
    booklets: [],
    units: [],
    responses: [],
    responseStatuses: [],
    tags: [],
    processingDurations: [],
    unitProgresses: [],
    sessionBrowsers: [],
    sessionOs: [],
    sessionScreens: [],
    sessionIds: []
  };

  beforeEach(async () => {
    testResultService = {
      getFlatResponses: jest.fn().mockReturnValue(of({
        data: [],
        total: 0,
        page: 1,
        limit: 100
      })),
      getFlatResponseFilterOptions: jest.fn().mockReturnValue(of(emptyFilterOptions)),
      getFlatResponseFrequencies: jest.fn().mockReturnValue(of({})),
      workspaceCacheInvalidated$: new Subject<number>()
    };
    workspaceSettingsService = {
      getShowTestResultsLogAnomalies: jest.fn().mockReturnValue(of(false))
    };

    await TestBed.configureTestingModule({
      imports: [
        TestResultsFlatTableComponent,
        NoopAnimationsModule
      ],
      providers: [
        { provide: FileService, useValue: {} },
        {
          provide: UnitNoteService,
          useValue: {
            getUnitNotes: jest.fn().mockReturnValue(of([])),
            getNotesForMultipleUnits: jest.fn().mockReturnValue(of({}))
          }
        },
        {
          provide: CodingStatisticsService,
          useValue: { getReplayUrl: jest.fn().mockReturnValue(of(null)) }
        },
        {
          provide: ResponseService,
          useValue: { deleteResponse: jest.fn().mockReturnValue(of({ success: true })) }
        },
        {
          provide: AppService,
          useValue: {
            selectedWorkspaceId: 1,
            createOwnToken: jest.fn().mockReturnValue(of('token'))
          }
        },
        { provide: TestResultService, useValue: testResultService },
        { provide: WorkspaceSettingsService, useValue: workspaceSettingsService },
        {
          provide: MatSnackBar,
          useValue: { open: jest.fn().mockReturnValue({ dismiss: jest.fn() }) }
        },
        { provide: MatDialog, useValue: { open: jest.fn() } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(TestResultsFlatTableComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should include row log anomalies when the dashboard forces the column', () => {
    component.forceShowLogAnomalies = true;
    component.ngOnChanges({
      forceShowLogAnomalies: new SimpleChange(false, true, true)
    });

    component.ngOnInit();

    expect(component.flatDisplayedColumns).toContain('logStatus');
    expect(testResultService.getFlatResponses).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ includeLogAnomalies: 'true' })
    );
  });

  it('should ignore stale flat-response requests', () => {
    const firstResponse = new Subject<FlatTestResultResponsesResponse>();
    const secondResponse = new Subject<FlatTestResultResponsesResponse>();
    workspaceSettingsService.getShowTestResultsLogAnomalies.mockReturnValue(of(true));
    testResultService.getFlatResponses
      .mockReturnValueOnce(firstResponse.asObservable())
      .mockReturnValueOnce(secondResponse.asObservable());

    component.ngOnInit();
    component.onFlatPaginatorChange({
      length: 2,
      pageIndex: 1,
      pageSize: 100,
      previousPageIndex: 0
    });

    secondResponse.next({
      data: [{
        bookletId: 2,
        responseId: 2,
        unitId: 2,
        personId: 2,
        code: 'new',
        group: '',
        login: '',
        booklet: '',
        unit: '',
        response: '',
        responseStatus: '',
        responseValue: '',
        tags: [],
        logAnomalies: [{
          code: 'controller_error',
          severity: 'critical',
          label: 'Controller-Fehler',
          evidence: 'Fehler',
          count: 1
        }]
      }],
      total: 1,
      page: 2,
      limit: 100
    });
    firstResponse.next({
      data: [{
        bookletId: 1,
        responseId: 1,
        unitId: 1,
        personId: 1,
        code: 'stale',
        group: '',
        login: '',
        booklet: '',
        unit: '',
        response: '',
        responseStatus: '',
        responseValue: '',
        tags: [],
        logAnomalies: []
      }],
      total: 1,
      page: 1,
      limit: 100
    });

    expect(component.flatData[0].code).toBe('new');
    expect(component.flatData[0].logAnomalies).toHaveLength(1);
  });
});
