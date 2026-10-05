import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, Subject, throwError } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { CodingStatisticsService } from '../../../coding/services/coding-statistics.service';
import {
  QuickSearchResult,
  QuickSearchResultItem,
  TestResultService
} from '../../../shared/services/test-result/test-result.service';
import { TestResultsSearchComponent } from './test-results-search.component';

describe('TestResultsSearchComponent', () => {
  let component: TestResultsSearchComponent;
  let resultService: { quickSearch: jest.Mock };
  let statisticsService: { getReplayUrl: jest.Mock };
  let dialogRef: { close: jest.Mock };
  let snackBar: { open: jest.Mock };

  const responseItem: QuickSearchResultItem = {
    kind: 'response',
    id: 11,
    label: 'Answer',
    responseId: 11,
    personLogin: 'login-a',
    personCode: 'code-a',
    personGroup: 'group-a',
    bookletName: 'booklet-a',
    unitName: 'technical-unit',
    unitAlias: 'unit-alias',
    variableId: 'VAR1',
    responseValue: '42'
  };
  const searchResult: QuickSearchResult = {
    query: 'answer',
    limit: 8,
    persons: [],
    booklets: [],
    units: [],
    responses: [responseItem],
    totals: {
      person: 0, booklet: 0, unit: 0, response: 1
    }
  };

  beforeEach(() => {
    resultService = { quickSearch: jest.fn(() => of(searchResult)) };
    statisticsService = { getReplayUrl: jest.fn(() => of({ replayUrl: '/replay/11' })) };
    dialogRef = { close: jest.fn() };
    snackBar = { open: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        TestResultsSearchComponent,
        { provide: MAT_DIALOG_DATA, useValue: { title: 'Search' } },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: TestResultService, useValue: resultService },
        { provide: CodingStatisticsService, useValue: statisticsService },
        { provide: AppService, useValue: { selectedWorkspaceId: 5 } }
      ]
    });
    component = TestBed.inject(TestResultsSearchComponent);
    component.ngOnInit();
  });

  afterEach(() => {
    component.ngOnDestroy();
    jest.restoreAllMocks();
  });

  it('debounces input and displays only the completed search result', fakeAsync(() => {
    const pendingResult = new Subject<QuickSearchResult>();
    resultService.quickSearch.mockReturnValue(pendingResult.asObservable());
    component.searchText = 'ans';
    component.onSearchChange();
    tick(200);
    component.searchText = ' answer ';
    component.onSearchChange();
    tick(component.SEARCH_DEBOUNCE_TIME - 1);
    expect(resultService.quickSearch).not.toHaveBeenCalled();
    tick(1);
    expect(resultService.quickSearch).toHaveBeenCalledTimes(1);
    expect(resultService.quickSearch).toHaveBeenCalledWith(5, 'answer', 8);
    expect(component.isLoading).toBe(true);
    pendingResult.next(searchResult);
    pendingResult.complete();
    expect(component.isLoading).toBe(false);
    expect(component.getVisibleResults('response')).toEqual([responseItem]);
    expect(component.getVisibleCount()).toBe(1);
  }));

  it('clears earlier results for input shorter than the search minimum', fakeAsync(() => {
    component.results = searchResult;
    component.searchText = ' a ';
    component.onSearchChange();
    tick(component.SEARCH_DEBOUNCE_TIME);
    expect(resultService.quickSearch).not.toHaveBeenCalled();
    expect(component.results.query).toBe('a');
    expect(component.getVisibleCount()).toBe(0);
    expect(component.hasSearched).toBe(false);
    expect(component.isLoading).toBe(false);
  }));

  it('clears stale results and releases loading when the search fails', fakeAsync(() => {
    resultService.quickSearch.mockReturnValue(throwError(() => new Error('search unavailable')));
    component.results = searchResult;
    component.searchText = 'answer';
    component.onSearchChange();
    tick(component.SEARCH_DEBOUNCE_TIME);
    expect(component.getVisibleCount()).toBe(0);
    expect(component.results.query).toBe('answer');
    expect(component.isLoading).toBe(false);
    expect(component.hasSearched).toBe(true);
  }));

  it('keeps at least one result kind selected', () => {
    component.selectedKinds = new Set(['response']);
    component.toggleKind('response');
    expect(component.isKindSelected('response')).toBe(true);
    component.toggleKind('unit');
    component.toggleKind('response');
    expect(component.getVisibleResults('response')).toEqual([]);
    expect(component.isKindSelected('unit')).toBe(true);
  });

  it('opens a response with its exact person, booklet and aliased-unit filters', () => {
    component.openInTable(responseItem);
    expect(dialogRef.close).toHaveBeenCalledWith({
      action: 'table',
      item: responseItem,
      filters: {
        code: 'code-a',
        group: 'group-a',
        login: 'login-a',
        booklet: 'booklet-a',
        unit: 'unit-alias',
        response: 'VAR1',
        responseValue: '42'
      }
    });
  });

  it('opens the replay URL returned for the selected response', () => {
    const openWindow = jest.spyOn(window, 'open').mockReturnValue(null);
    component.replay(responseItem);
    expect(statisticsService.getReplayUrl).toHaveBeenCalledWith(5, 11);
    expect(openWindow).toHaveBeenCalledWith('/replay/11', '_blank');
  });

  it('reports a replay failure without opening a window', () => {
    const openWindow = jest.spyOn(window, 'open').mockReturnValue(null);
    statisticsService.getReplayUrl.mockReturnValue(throwError(() => new Error('replay unavailable')));
    component.replay(responseItem);
    expect(openWindow).not.toHaveBeenCalled();
    expect(snackBar.open).toHaveBeenCalledWith(
      'Fehler beim Laden der Replay-URL', 'Fehler', { duration: 3000 }
    );
  });

  it('does not run a queued search after the dialog is destroyed', fakeAsync(() => {
    component.searchText = 'answer';
    component.onSearchChange();
    component.ngOnDestroy();
    tick(component.SEARCH_DEBOUNCE_TIME);
    expect(resultService.quickSearch).not.toHaveBeenCalled();
  }));
});
