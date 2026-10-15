import { provideZonelessChangeDetection, SimpleChange, WritableSignal } from '@angular/core';
import { delay } from 'rxjs/operators';
import {
  ComponentFixture, TestBed
} from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
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
  FlatResponseFrequenciesResponse,
  FlatTestResultResponsesResponse,
  TestResultService
} from '../../../shared/services/test-result/test-result.service';
import { TestResultsFlatTableComponent } from './test-results-flat-table.component';
import { UnitNoteDto } from '../../../../../../../api-dto/unit-notes/unit-note.dto';

describe('TestResultsFlatTableComponent', () => {
  let fixture: ComponentFixture<TestResultsFlatTableComponent>;
  let component: TestResultsFlatTableComponent;
  let snackBar: { open: jest.Mock };
  let testResultService: {
    getFlatResponses: jest.Mock;
    getPersonTestResults: jest.Mock;
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
      getPersonTestResults: jest.fn().mockReturnValue(of([{ name: 'BOOKLET', units: [{ id: 10, name: 'UNIT' }] }])),
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
        TranslateModule.forRoot()
      ],
      providers: [
        provideZonelessChangeDetection(),
        { provide: FileService, useValue: { getBookletInfo: jest.fn().mockReturnValue(of({})), getUnitInfo: jest.fn().mockReturnValue(of({})) } },
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

  it.each(['notes', 'frequencies'])('renders delayed %s without another user action', async kind => {
    const notes = new Subject<Record<number, UnitNoteDto[]>>();
    const frequencies = new Subject<FlatResponseFrequenciesResponse>();
    jest.spyOn(TestBed.inject(UnitNoteService), 'getNotesForMultipleUnits').mockReturnValue(notes);
    testResultService.getFlatResponseFrequencies.mockReturnValue(frequencies);
    const response: FlatTestResultResponsesResponse = {
      data: [{
        responseId: 1,
        unitId: 1,
        personId: 1,
        code: 'person',
        group: 'g',
        login: 'login',
        booklet: 'BOOKLET',
        unit: 'UNIT',
        response: 'V1',
        responseStatus: 'VALUE_CHANGED',
        responseValue: 'answer',
        tags: [],
        logAnomalies: []
      }],
      total: 1,
      page: 1,
      limit: 100
    };
    testResultService.getFlatResponses.mockReturnValue(of(response));
    fixture.autoDetectChanges();
    await fixture.whenStable();
    // Settle initial ngModel notifications before delivering the independent requests.
    await new Promise<void>(resolve => { setTimeout(resolve, 80); });
    await fixture.whenStable();
    const frequencyCell = fixture.nativeElement.querySelector('td.mat-column-frequencies') as HTMLElement;
    const hasNoteIndicator = () => Array.from(
      fixture.nativeElement.querySelectorAll('td.mat-column-actions mat-icon') as NodeListOf<HTMLElement>
    ).some(icon => icon.textContent?.trim() === 'circle');
    expect(frequencyCell.textContent?.trim()).toBe('');
    expect(hasNoteIndicator()).toBe(false);

    if (kind === 'notes') {
      notes.next({
        1: [{
          id: 1, unitId: 1, note: 'note', createdAt: new Date(), updatedAt: new Date()
        }]
      });
    } else {
      frequencies.next({ 'UNIT:V1': { total: 10, values: [{ value: 'answer', count: 2, p: 0.2 }] } });
    }
    await fixture.whenStable();

    if (kind === 'notes') {
      expect(hasNoteIndicator()).toBe(true);
      notes.error(new Error('Request failed'));
      await fixture.whenStable();
      expect(hasNoteIndicator()).toBe(false);
    } else {
      expect(frequencyCell.textContent?.trim()).toBe('p=.200 (n=2)');
    }
    notes.complete();
    frequencies.complete();
  });

  it('should display response-value frequencies as proportions', () => {
    const frequencyState = component as unknown as {
      frequenciesByComboKey: WritableSignal<Map<string, {
        total: number;
        values: Array<{ value: string; count: number; p: number }>;
      }>>;
    };
    frequencyState.frequenciesByComboKey.set(new Map([['Unit%20A:variable-1', {
      total: 10,
      values: [{
        value: 'answer-a',
        count: 2,
        p: 0.2
      }]
    }]]));

    const summary = component.getFrequencySummary({
      unit: 'Unit A',
      response: 'variable-1',
      responseValue: 'answer-a'
    } as Parameters<TestResultsFlatTableComponent['getFrequencySummary']>[0]);

    expect(summary).toBe('p=.200 (n=2)');
  });

  it('should not include row log anomalies when the dashboard force is disabled by workspace setting', () => {
    fixture.componentRef.setInput('forceShowLogAnomalies', true);
    component.ngOnChanges({
      forceShowLogAnomalies: new SimpleChange(false, true, true)
    });

    component.ngOnInit();

    expect(component.flatDisplayedColumns()).not.toContain('logStatus');
    expect(testResultService.getFlatResponses).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ includeLogAnomalies: '' }),
      expect.objectContaining({ suppressGlobalHttpError: true })
    );
  });

  it('should include row log anomalies when the workspace setting enables the column', () => {
    fixture.componentRef.setInput('showWorkspaceLogAnomalies', true);

    component.ngOnInit();

    expect(component.flatDisplayedColumns()).toContain('logStatus');
    expect(testResultService.getFlatResponses).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ includeLogAnomalies: 'true' }),
      expect.objectContaining({ suppressGlobalHttpError: true })
    );
  });

  it('should expose the dashboard all-anomalies filter in the media filter UI', () => {
    fixture.componentRef.setInput('initialFilters', { logAnomalies: 'any' });

    component.ngOnChanges({
      initialFilters: new SimpleChange(null, component.initialFilters(), true)
    });

    expect(component.flatFilters().logAnomalies).toBe('any');
    expect(component.mediaFilters()).toContain('logAny');
  });

  it('should keep the all-anomalies media filter exclusive', () => {
    component.mediaFilters.set([
      'geogebra',
      'logAny',
      'logCritical',
      'logTimer'
    ]);

    component.onMediaFiltersChanged();

    expect(component.mediaFilters()).toEqual(['geogebra', 'logAny']);
    expect(component.flatFilters().geogebra).toBe(true);
    expect(component.flatFilters().logAnomalies).toBe('any');
  });

  it('should replace external table filters instead of keeping stale log filters', () => {
    fixture.componentRef.setInput('initialFilters', { logAnomalies: 'any' });
    component.ngOnChanges({
      initialFilters: new SimpleChange(null, component.initialFilters(), true)
    });

    fixture.componentRef.setInput('initialFilters', { code: 'person-a' });
    component.ngOnChanges({
      initialFilters: new SimpleChange({ logAnomalies: 'any' }, component.initialFilters(), false)
    });

    expect(component.flatFilters().code).toBe('person-a');
    expect(component.flatFilters().logAnomalies).toBe('');
    expect(component.mediaFilters()).not.toContain('logAny');
  });

  it('should send the regex flag when the workspace setting is enabled', () => {
    fixture.componentRef.setInput('enableRegexSearch', true);

    component.ngOnInit();

    expect(testResultService.getFlatResponses).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ regexSearch: true }),
      expect.objectContaining({ suppressGlobalHttpError: true })
    );
  });

  it('should pass quoted exact filters unchanged in normal mode', () => {
    component.flatFilters.update(value => ({ ...value, response: '"01"' }));

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

  it('should not request data while a regex filter exceeds the limit', async () => {
    fixture.componentRef.setInput('enableRegexSearch', true);
    component.ngOnInit();
    testResultService.getFlatResponses.mockClear();
    component.flatFilters.update(value => ({ ...value, response: 'a'.repeat(257) }));

    component.onFlatFilterChanged();
    await new Promise<void>(resolve => { setTimeout(resolve, 401); });

    expect(component.isRegexFilterInvalid('response')).toBe(true);
    expect(testResultService.getFlatResponses).not.toHaveBeenCalled();
  });

  it('should send PostgreSQL ARE syntax unsupported by JavaScript', async () => {
    fixture.componentRef.setInput('enableRegexSearch', true);
    component.ngOnInit();
    testResultService.getFlatResponses.mockClear();
    component.flatFilters.update(value => ({ ...value, response: '(?i)^var$' }));

    component.onFlatFilterChanged();
    await new Promise<void>(resolve => { setTimeout(resolve, 401); });

    expect(component.isRegexFilterInvalid('response')).toBe(false);
    expect(testResultService.getFlatResponses).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ response: '(?i)^var$' }),
      expect.objectContaining({ suppressGlobalHttpError: true })
    );
  });

  it('should disable autocomplete suggestions in regex mode', () => {
    fixture.componentRef.setInput('enableRegexSearch', true);
    component.flatFilterOptions.update(value => ({ ...value, codes: ['P-01'] }));
    component.flatFilters.update(value => ({ ...value, code: '^P-' }));

    expect(component.filteredCodes()).toEqual([]);
  });

  it('should show a specific message when a regex query times out', () => {
    fixture.componentRef.setInput('enableRegexSearch', true);
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
    component.flatFilters.update(value => ({ ...value, responseValue: 'needle' }));
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
    fixture.componentRef.setInput('enableRegexSearch', true);
    component.flatFilters.update(value => ({ ...value, response: '[' }));
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

  it('should ignore an invalid-regex error for an edited filter', async () => {
    const staleResponse = new Subject<FlatTestResultResponsesResponse>();
    let resolveReload: () => void;
    const reloadStarted = new Promise<void>(resolve => { resolveReload = resolve; });
    fixture.componentRef.setInput('enableRegexSearch', true);
    component.flatFilters.update(value => ({ ...value, response: '[' }));
    testResultService.getFlatResponses
      .mockReturnValueOnce(staleResponse.asObservable())
      .mockImplementationOnce(() => {
        resolveReload();
        return of({
          data: [], total: 0, page: 1, limit: 100
        });
      });
    fixture.detectChanges();

    component.flatFilters.update(value => ({ ...value, response: '[a]' }));
    component.onFlatFilterChanged();
    staleResponse.error(new HttpErrorResponse({
      status: 400,
      error: {
        code: 'INVALID_REGEX',
        field: 'response',
        message: 'Invalid regular expression for response'
      }
    }));
    await reloadStarted;
    await fixture.whenStable();

    expect(component.isRegexFilterInvalid('response')).toBe(false);
    expect(testResultService.getFlatResponses).toHaveBeenCalledTimes(2);
    expect(testResultService.getFlatResponses).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({ response: '[a]' }),
      expect.objectContaining({ suppressGlobalHttpError: true })
    );
  });

  it('should ignore stale flat-response requests', () => {
    const firstResponse = new Subject<FlatTestResultResponsesResponse>();
    const secondResponse = new Subject<FlatTestResultResponsesResponse>();
    fixture.componentRef.setInput('showWorkspaceLogAnomalies', true);
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

    expect(component.flatData()[0].code).toBe('new');
    expect(component.flatData()[0].logAnomalies).toHaveLength(1);
  });
  it('renders a delayed server response without another user action', async () => {
    const backend = TestBed.inject(TestResultService);
    const response = backend.getFlatResponses(1, {}).pipe(delay(30));
    jest.spyOn(backend, 'getFlatResponses').mockReturnValue(response);
    fixture.destroy();
    fixture = TestBed.createComponent(TestResultsFlatTableComponent);
    component = fixture.componentInstance;
    fixture.autoDetectChanges();
    await new Promise<void>(resolve => { setTimeout(resolve, 80); });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Keine Ergebnisse gefunden');
  });
  it.each(['booklet', 'unit-person', 'unit-info'].flatMap(stage => ['destroy', 'workspace'].flatMap(end => ['success', 'error'].map(outcome => ({ stage, end, outcome })))))('ignores delayed $stage $outcome after $end', async ({ stage, end, outcome }) => {
    const response = new Subject<unknown>();
    const files = TestBed.inject(FileService) as unknown as { getBookletInfo: jest.Mock; getUnitInfo: jest.Mock };
    if (stage === 'booklet') files.getBookletInfo.mockReturnValue(response);
    else if (stage === 'unit-person') testResultService.getPersonTestResults.mockReturnValue(response);
    else files.getUnitInfo.mockReturnValue(response);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const row = {
      bookletId: 1,
      responseId: 1,
      unitId: 10,
      personId: 20,
      code: '',
      group: '',
      login: '',
      booklet: 'BOOKLET',
      unit: 'UNIT',
      response: 'v',
      responseStatus: '',
      responseValue: '',
      tags: []
    };
    if (stage === 'booklet') component.openBookletInfoFromFlatRow(row);
    else component.openUnitInfoFromFlatRow(row);
    const loading = snackBar.open.mock.results.at(-1)?.value;
    if (end === 'destroy') fixture.destroy();
    else TestBed.inject(AppService).selectedWorkspaceId = 2;
    if (outcome === 'error') response.error(new Error('Synthetic error'));
    else {
      response.next(stage === 'unit-person' ? [{ name: 'BOOKLET', units: [{ id: 10, name: 'UNIT' }] }] : {});
      response.complete();
    }
    expect(snackBar.open).toHaveBeenCalledTimes(stage === 'unit-person' ? 0 : 1);
    if (stage !== 'unit-person') expect(loading.dismiss).toHaveBeenCalled();
    expect(TestBed.inject(MatDialog).open).not.toHaveBeenCalled();
    if (stage === 'unit-person') expect(files.getUnitInfo).not.toHaveBeenCalled();
  });
});
