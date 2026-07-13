import { SimpleChange } from '@angular/core';
import {
  ComponentFixture, fakeAsync, TestBed, tick
} from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { Subject, of, throwError } from 'rxjs';
import { FileService } from '../../../shared/services/file/file.service';
import { UnitNoteService } from '../../../shared/services/unit/unit-note.service';
import { CodingStatisticsService } from '../../../coding/services/coding-statistics.service';
import { ResponseService } from '../../../shared/services/response/response.service';
import { AppService } from '../../../core/services/app.service';
import {
  FlatTestResultResponsesResponse,
  TestResultService
} from '../../../shared/services/test-result/test-result.service';
import { TestResultsFlatTableComponent } from './test-results-flat-table.component';

describe('TestResultsFlatTableComponent', () => {
  let fixture: ComponentFixture<TestResultsFlatTableComponent>;
  let component: TestResultsFlatTableComponent;
  let snackBar: { open: jest.Mock };
  let testResultService: {
    getFlatResponses: jest.Mock;
    getFlatResponseFilterOptions: jest.Mock;
    getFlatResponseFrequencies: jest.Mock;
    workspaceCacheInvalidated$: Subject<number>;
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
    snackBar = {
      open: jest.fn().mockReturnValue({ dismiss: jest.fn() })
    };
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

    await TestBed.configureTestingModule({
      imports: [
        TestResultsFlatTableComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot()
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
        {
          provide: MatSnackBar,
          useValue: snackBar
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

  it('should not include row log anomalies when the dashboard force is disabled by workspace setting', () => {
    component.forceShowLogAnomalies = true;
    component.ngOnChanges({
      forceShowLogAnomalies: new SimpleChange(false, true, true)
    });

    component.ngOnInit();

    expect(component.flatDisplayedColumns).not.toContain('logStatus');
    expect(testResultService.getFlatResponses).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ includeLogAnomalies: '' }),
      expect.objectContaining({ suppressGlobalHttpError: true })
    );
  });

  it('should include row log anomalies when the workspace setting enables the column', () => {
    component.showWorkspaceLogAnomalies = true;

    component.ngOnInit();

    expect(component.flatDisplayedColumns).toContain('logStatus');
    expect(testResultService.getFlatResponses).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ includeLogAnomalies: 'true' }),
      expect.objectContaining({ suppressGlobalHttpError: true })
    );
  });

  it('should expose the dashboard all-anomalies filter in the media filter UI', () => {
    component.initialFilters = { logAnomalies: 'any' };

    component.ngOnChanges({
      initialFilters: new SimpleChange(null, component.initialFilters, true)
    });

    expect(component.flatFilters.logAnomalies).toBe('any');
    expect(component.mediaFilters).toContain('logAny');
  });

  it('should keep the all-anomalies media filter exclusive', () => {
    component.mediaFilters = [
      'geogebra',
      'logAny',
      'logCritical',
      'logTimer'
    ];

    component.onMediaFiltersChanged();

    expect(component.mediaFilters).toEqual(['geogebra', 'logAny']);
    expect(component.flatFilters.geogebra).toBe(true);
    expect(component.flatFilters.logAnomalies).toBe('any');
  });

  it('should replace external table filters instead of keeping stale log filters', () => {
    component.initialFilters = { logAnomalies: 'any' };
    component.ngOnChanges({
      initialFilters: new SimpleChange(null, component.initialFilters, true)
    });

    component.initialFilters = { code: 'person-a' };
    component.ngOnChanges({
      initialFilters: new SimpleChange({ logAnomalies: 'any' }, component.initialFilters, false)
    });

    expect(component.flatFilters.code).toBe('person-a');
    expect(component.flatFilters.logAnomalies).toBe('');
    expect(component.mediaFilters).not.toContain('logAny');
  });

  it('should send the regex flag when the workspace setting is enabled', () => {
    component.enableRegexSearch = true;

    component.ngOnInit();

    expect(testResultService.getFlatResponses).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ regexSearch: true }),
      expect.objectContaining({ suppressGlobalHttpError: true })
    );
  });

  it('should pass quoted exact filters unchanged in normal mode', () => {
    component.flatFilters.response = '"01"';

    component.ngOnInit();

    expect(testResultService.getFlatResponses).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        response: '"01"',
        regexSearch: false
      }),
      expect.objectContaining({ suppressGlobalHttpError: true })
    );
  });

  it('should not request data while a regex filter exceeds the limit', fakeAsync(() => {
    component.enableRegexSearch = true;
    component.ngOnInit();
    testResultService.getFlatResponses.mockClear();
    component.flatFilters.response = 'a'.repeat(257);

    component.onFlatFilterChanged();
    tick(401);

    expect(component.isRegexFilterInvalid('response')).toBe(true);
    expect(testResultService.getFlatResponses).not.toHaveBeenCalled();
  }));

  it('should send PostgreSQL ARE syntax unsupported by JavaScript', fakeAsync(() => {
    component.enableRegexSearch = true;
    component.ngOnInit();
    testResultService.getFlatResponses.mockClear();
    component.flatFilters.response = '(?i)^var$';

    component.onFlatFilterChanged();
    tick(401);

    expect(component.isRegexFilterInvalid('response')).toBe(false);
    expect(testResultService.getFlatResponses).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ response: '(?i)^var$' }),
      expect.objectContaining({ suppressGlobalHttpError: true })
    );
  }));

  it('should disable autocomplete suggestions in regex mode', () => {
    component.enableRegexSearch = true;
    component.flatFilterOptions.codes = ['P-01'];
    component.flatFilters.code = '^P-';

    expect(component.filteredCodes()).toEqual([]);
  });

  it('should show a specific message when a regex query times out', () => {
    component.enableRegexSearch = true;
    testResultService.getFlatResponses.mockReturnValue(throwError(() => (
      new HttpErrorResponse({
        status: 400,
        error: {
          code: 'REGEX_TIMEOUT',
          message: 'Regular expression search timed out after 3000 ms.'
        }
      })
    )));

    component.ngOnInit();

    expect(snackBar.open).toHaveBeenCalledWith(
      'search-filter.regex-timeout',
      'close',
      expect.objectContaining({ duration: 5000 })
    );
  });

  it('should show a specific message when a response value search times out', () => {
    component.flatFilters.responseValue = 'needle';
    testResultService.getFlatResponses.mockReturnValue(throwError(() => (
      new HttpErrorResponse({
        status: 400,
        error: {
          code: 'SEARCH_TIMEOUT',
          field: 'responseValue',
          message: 'Response value search timed out after 15000 ms.'
        }
      })
    )));

    component.ngOnInit();

    expect(snackBar.open).toHaveBeenCalledWith(
      'search-filter.response-value-timeout',
      'close',
      expect.objectContaining({ duration: 5000 })
    );
  });

  it('should use the structured invalid regex error code', () => {
    component.enableRegexSearch = true;
    component.flatFilters.response = '[';
    testResultService.getFlatResponses.mockReturnValue(throwError(() => (
      new HttpErrorResponse({
        status: 400,
        error: {
          code: 'INVALID_REGEX',
          field: 'response',
          message: 'Invalid regular expression for response'
        }
      })
    )));

    component.ngOnInit();

    expect(snackBar.open).toHaveBeenCalledWith(
      'search-filter.invalid-postgres-regex',
      'close',
      expect.objectContaining({ duration: 5000 })
    );
    expect(component.isRegexFilterInvalid('response')).toBe(true);
  });

  it('should ignore an invalid-regex error for an edited filter', fakeAsync(() => {
    const staleResponse = new Subject<FlatTestResultResponsesResponse>();
    component.enableRegexSearch = true;
    component.flatFilters.response = '[';
    testResultService.getFlatResponses
      .mockReturnValueOnce(staleResponse.asObservable())
      .mockReturnValueOnce(of({
        data: [],
        total: 0,
        page: 1,
        limit: 100
      }));
    component.ngOnInit();

    component.flatFilters.response = '[a]';
    component.onFlatFilterChanged();
    staleResponse.error(new HttpErrorResponse({
      status: 400,
      error: {
        code: 'INVALID_REGEX',
        field: 'response',
        message: 'Invalid regular expression for response'
      }
    }));
    tick(401);

    expect(component.isRegexFilterInvalid('response')).toBe(false);
    expect(testResultService.getFlatResponses).toHaveBeenCalledTimes(2);
    expect(testResultService.getFlatResponses).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({ response: '[a]' }),
      expect.objectContaining({ suppressGlobalHttpError: true })
    );
  }));

  it('should ignore stale flat-response requests', () => {
    const firstResponse = new Subject<FlatTestResultResponsesResponse>();
    const secondResponse = new Subject<FlatTestResultResponsesResponse>();
    component.showWorkspaceLogAnomalies = true;
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
