import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  catchError, Observable, of, Subject, tap
} from 'rxjs';
import { SERVER_URL } from '../../../injection-tokens';
import { TestResultCacheService } from './test-result-cache.service';
import { ValidationTaskStateService } from '../validation/validation-task-state.service';
import { ValidationTaskDto } from '../../../models/validation-task.dto';
import {
  TestResultsDeletePreviewDto,
  TestResultsDeleteRequestDto,
  TestResultsResponseCleanupRequestDto
} from '../../../../../../../api-dto/test-results/test-results-deletion.dto';

export interface TestResultsResponse {
  data: TestResultItem[];
  total: number;
}

export interface TestResultItem {
  id: number;
  code: string;
  group: string;
  login: string;
  uploaded_at: Date;
  [key: string]: unknown;
}

export interface PersonTestResult {
  [key: string]: unknown;
}

export interface FlatTestResultResponseRow {
  bookletId: number;
  responseId: number;
  unitId: number;
  personId: number;
  code: string;
  group: string;
  login: string;
  booklet: string;
  unit: string;
  response: string;
  responseStatus: string;
  responseValue: string;
  tags: string[];
  logAnomalies?: LogAnomalySummary[];
}

export type LogAnomalySeverity = 'critical' | 'warning' | 'info';

export interface LogAnomalySummary {
  code: string;
  severity: LogAnomalySeverity;
  label: string;
  evidence: string;
  count: number;
}

export interface LogAnomalyDashboardSummary {
  totalBooklets: number;
  affectedBooklets: number;
  criticalBooklets: number;
  warningBooklets: number;
  infoBooklets: number;
  totalAnomalyRules: number;
  totalAnomalyEvents: number;
  byCode: Record<string, number>;
}

export interface LogAnomalyDetailRow {
  bookletId: number;
  booklet: string;
  personId: number;
  code: string;
  group: string;
  login: string;
  maxSeverity: LogAnomalySeverity;
  anomalies: LogAnomalySummary[];
}

export interface LogAnomalyDetailsResponse {
  total: number;
  data: LogAnomalyDetailRow[];
}

export interface FlatResponseFilterRequest {
  workspaceId: number;
  filters: {
    logAnomalies?: string;
  };
  forceShowLogAnomalies?: boolean;
}

export interface FlatTestResultResponsesResponse {
  data: FlatTestResultResponseRow[];
  total: number;
  page: number;
  limit: number;
}

export interface FlatResponseFilterOptionsResponse {
  codes: string[];
  groups: string[];
  logins: string[];
  booklets: string[];
  units: string[];
  responses: string[];
  responseStatuses: string[];
  tags: string[];
  processingDurations: string[];
  unitProgresses: string[];
  sessionBrowsers: string[];
  sessionOs: string[];
  sessionScreens: string[];
  sessionIds: string[];
}

export interface FlatResponseFrequencyRequestCombo {
  unitKey: string;
  variableId: string;
  values: string[];
}

export interface FlatResponseFrequencyItem {
  value: string;
  count: number;
  p: number;
}

export type FlatResponseFrequenciesResponse = Record<
string,
{ total: number; values: FlatResponseFrequencyItem[] }
>;

export interface UnitLogRow {
  id: number;
  unitid: number;
  ts: string;
  key: string;
  parameter: string;
}

export interface BookletLogRow {
  id: number;
  bookletid: number;
  ts: string;
  key: string;
  parameter: string;
}

export interface BookletSessionRow {
  id: number;
  browser: string;
  os: string;
  screen: string;
  ts: string;
}

export interface BookletLogsForUnitResponse {
  bookletId: number;
  logs: BookletLogRow[];
  sessions: BookletSessionRow[];
  units: {
    id: number;
    bookletid: number;
    name: string;
    alias: string | null;
    logs: UnitLogRow[];
  }[];
}

export interface TestResultsOverviewResponse {
  testPersons: number;
  testGroups: number;
  uniqueBooklets: number;
  uniqueUnits: number;
  uniqueResponses: number;
  responseStatusCounts: Record<string, number>;
  sessionBrowserCounts: Record<string, number>;
  sessionOsCounts: Record<string, number>;
  sessionScreenCounts: Record<string, number>;
}

export type QuickSearchResultKind = 'person' | 'booklet' | 'unit' | 'response';

export interface QuickSearchResultItem {
  kind: QuickSearchResultKind;
  id: number;
  label: string;
  secondaryLabel?: string;
  personId?: number;
  personLogin?: string;
  personCode?: string;
  personGroup?: string;
  bookletId?: number;
  bookletName?: string;
  unitId?: number;
  unitName?: string;
  unitAlias?: string | null;
  responseId?: number;
  variableId?: string;
  responseValue?: string;
  responseStatus?: string;
}

export interface QuickSearchResult {
  query: string;
  limit: number;
  persons: QuickSearchResultItem[];
  booklets: QuickSearchResultItem[];
  units: QuickSearchResultItem[];
  responses: QuickSearchResultItem[];
  totals: Record<QuickSearchResultKind, number>;
}

@Injectable({
  providedIn: 'root'
})
export class TestResultService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);
  private cacheService = inject(TestResultCacheService);
  private validationTaskStateService = inject(ValidationTaskStateService);

  private workspaceCacheInvalidatedSubject = new Subject<number>();
  readonly workspaceCacheInvalidated$ =
    this.workspaceCacheInvalidatedSubject.asObservable();

  private flatResponseFilterRequestSubject =
    new Subject<FlatResponseFilterRequest>();

  readonly flatResponseFilterRequests$ =
    this.flatResponseFilterRequestSubject.asObservable();

  getTestPersons(workspaceId: number): Observable<number[]> {
    return this.http.get<number[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-groups`,
      {}
    );
  }

  getTestResults(
    workspaceId: number,
    page: number,
    limit: number,
    searchText?: string
  ): Observable<TestResultsResponse> {
    return this.cacheService.getTestResults(
      workspaceId,
      page,
      limit,
      searchText
    );
  }

  getPersonTestResults(
    workspaceId: number,
    personId: number
  ): Observable<PersonTestResult[]> {
    return this.cacheService.getPersonTestResults(workspaceId, personId);
  }

  getWorkspaceOverview(
    workspaceId: number
  ): Observable<TestResultsOverviewResponse | null> {
    return this.http
      .get<TestResultsOverviewResponse>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-results/overview`,
      {}
    )
      .pipe(catchError(() => of(null)));
  }

  getLogAnomalySummary(
    workspaceId: number,
    options: {
      longLoadingThresholdMs?: string;
      focusLostThresholdMs?: string;
      sessionSpanThresholdMs?: string;
      repeatedStartThreshold?: string;
    } = {}
  ): Observable<LogAnomalyDashboardSummary> {
    let params = new HttpParams();
    const addIf = (key: string, value?: string) => {
      const v = (value || '').trim();
      if (v) {
        params = params.set(key, v);
      }
    };

    addIf('longLoadingThresholdMs', options.longLoadingThresholdMs);
    addIf('focusLostThresholdMs', options.focusLostThresholdMs);
    addIf('sessionSpanThresholdMs', options.sessionSpanThresholdMs);
    addIf('repeatedStartThreshold', options.repeatedStartThreshold);

    return this.http
      .get<LogAnomalyDashboardSummary>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-results/log-anomaly-summary`,
      { params }
    );
  }

  getLogAnomalyDetails(
    workspaceId: number,
    options: {
      longLoadingThresholdMs?: string;
      focusLostThresholdMs?: string;
      sessionSpanThresholdMs?: string;
      repeatedStartThreshold?: string;
      limit?: string;
    } = {}
  ): Observable<LogAnomalyDetailsResponse> {
    let params = new HttpParams();
    const addIf = (key: string, value?: string) => {
      const v = (value || '').trim();
      if (v) {
        params = params.set(key, v);
      }
    };

    addIf('longLoadingThresholdMs', options.longLoadingThresholdMs);
    addIf('focusLostThresholdMs', options.focusLostThresholdMs);
    addIf('sessionSpanThresholdMs', options.sessionSpanThresholdMs);
    addIf('repeatedStartThreshold', options.repeatedStartThreshold);
    addIf('limit', options.limit);

    return this.http
      .get<LogAnomalyDetailsResponse>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-results/log-anomaly-details`,
      { params }
    );
  }

  requestFlatResponseFilters(
    workspaceId: number,
    filters: FlatResponseFilterRequest['filters'],
    options: { forceShowLogAnomalies?: boolean } = {}
  ): void {
    this.flatResponseFilterRequestSubject.next({
      workspaceId,
      filters,
      forceShowLogAnomalies: options.forceShowLogAnomalies
    });
  }

  quickSearch(
    workspaceId: number,
    query: string,
    limit: number = 8
  ): Observable<QuickSearchResult> {
    const trimmedQuery = String(query || '').trim();
    const params = new HttpParams()
      .set('q', trimmedQuery)
      .set('limit', String(limit));

    return this.http
      .get<QuickSearchResult>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-results/quick-search`,
      { params }
    )
      .pipe(
        catchError(() => of({
          query: trimmedQuery,
          limit,
          persons: [],
          booklets: [],
          units: [],
          responses: [],
          totals: {
            person: 0,
            booklet: 0,
            unit: 0,
            response: 0
          }
        }))
      );
  }

  previewDeleteTestResults(
    workspaceId: number,
    request: TestResultsDeleteRequestDto
  ): Observable<TestResultsDeletePreviewDto | null> {
    return this.http
      .post<TestResultsDeletePreviewDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-results/delete-preview`,
      request,
      {}
    )
      .pipe(
        catchError(() => of(null))
      );
  }

  createDeleteTestResultsJob(
    workspaceId: number,
    request: TestResultsDeleteRequestDto
  ): Observable<ValidationTaskDto> {
    return this.http
      .post<ValidationTaskDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-results/delete-jobs`,
      request,
      {}
    )
      .pipe(
        tap(() => {
          this.invalidateCache(workspaceId);
          this.validationTaskStateService.invalidateWorkspace(workspaceId);
        })
      );
  }

  previewDeleteTestResultResponses(
    workspaceId: number,
    request: TestResultsResponseCleanupRequestDto
  ): Observable<TestResultsDeletePreviewDto | null> {
    return this.http
      .post<TestResultsDeletePreviewDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-results/responses/delete-preview`,
      request,
      {}
    )
      .pipe(
        catchError(() => of(null))
      );
  }

  createDeleteTestResultResponsesJob(
    workspaceId: number,
    request: TestResultsResponseCleanupRequestDto
  ): Observable<ValidationTaskDto> {
    return this.http
      .post<ValidationTaskDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-results/responses/delete-jobs`,
      request,
      {}
    )
      .pipe(
        tap(() => {
          this.invalidateCache(workspaceId);
          this.validationTaskStateService.invalidateWorkspace(workspaceId);
        })
      );
  }

  previewDeleteTestLogs(
    workspaceId: number,
    request: TestResultsDeleteRequestDto
  ): Observable<TestResultsDeletePreviewDto | null> {
    return this.http
      .post<TestResultsDeletePreviewDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-results/logs/delete-preview`,
      request,
      {}
    )
      .pipe(
        catchError(() => of(null))
      );
  }

  createDeleteTestLogsJob(
    workspaceId: number,
    request: TestResultsDeleteRequestDto
  ): Observable<ValidationTaskDto> {
    return this.http
      .post<ValidationTaskDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-results/logs/delete-jobs`,
      request,
      {}
    )
      .pipe(
        tap(() => {
          this.invalidateCache(workspaceId);
          this.validationTaskStateService.invalidateWorkspace(workspaceId);
        })
      );
  }

  getFlatResponseFrequencies(
    workspaceId: number,
    combos: FlatResponseFrequencyRequestCombo[]
  ): Observable<FlatResponseFrequenciesResponse> {
    return this.http
      .post<FlatResponseFrequenciesResponse>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-results/flat-responses/frequencies`,
      { combos },
      {}
    )
      .pipe(catchError(() => of({} as FlatResponseFrequenciesResponse)));
  }

  getFlatResponses(
    workspaceId: number,
    options: {
      page: number;
      limit: number;
      code?: string;
      group?: string;
      login?: string;
      booklet?: string;
      unit?: string;
      response?: string;
      responseStatus?: string;
      responseValue?: string;
      tags?: string;
      geogebra?: string;
      audioLow?: string;
      hasValue?: string;
      audioLowThreshold?: string;
      shortProcessing?: string;
      shortProcessingThresholdMs?: string;
      longLoading?: string;
      longLoadingThresholdMs?: string;
      processingDurations?: string;
      processingDurationThresholdMs?: string;
      processingDurationMin?: string;
      processingDurationMax?: string;
      unitProgress?: string;
      sessionBrowsers?: string;
      sessionOs?: string;
      sessionScreens?: string;
      sessionIds?: string;
      logAnomalies?: string;
      includeLogAnomalies?: string;
      focusLostThresholdMs?: string;
      sessionSpanThresholdMs?: string;
      repeatedStartThreshold?: string;
    }
  ): Observable<FlatTestResultResponsesResponse> {
    let params = new HttpParams()
      .set('page', String(options.page))
      .set('limit', String(options.limit));

    const addIf = (key: string, value?: string) => {
      const v = (value || '').trim();
      if (v) {
        params = params.set(key, v);
      }
    };

    addIf('code', options.code);
    addIf('group', options.group);
    addIf('login', options.login);
    addIf('booklet', options.booklet);
    addIf('unit', options.unit);
    addIf('response', options.response);
    addIf('responseStatus', options.responseStatus);
    addIf('responseValue', options.responseValue);
    addIf('tags', options.tags);
    addIf('geogebra', options.geogebra);
    addIf('audioLow', options.audioLow);
    addIf('hasValue', options.hasValue);
    addIf('audioLowThreshold', options.audioLowThreshold);
    addIf('shortProcessing', options.shortProcessing);
    addIf('shortProcessingThresholdMs', options.shortProcessingThresholdMs);
    addIf('longLoading', options.longLoading);
    addIf('longLoadingThresholdMs', options.longLoadingThresholdMs);
    addIf('processingDurations', options.processingDurations);
    addIf(
      'processingDurationThresholdMs',
      options.processingDurationThresholdMs
    );
    addIf('processingDurationMin', options.processingDurationMin);
    addIf('processingDurationMax', options.processingDurationMax);
    addIf('unitProgress', options.unitProgress);
    addIf('sessionBrowsers', options.sessionBrowsers);
    addIf('sessionOs', options.sessionOs);
    addIf('sessionScreens', options.sessionScreens);
    addIf('sessionIds', options.sessionIds);
    addIf('logAnomalies', options.logAnomalies);
    addIf('includeLogAnomalies', options.includeLogAnomalies);
    addIf('focusLostThresholdMs', options.focusLostThresholdMs);
    addIf('sessionSpanThresholdMs', options.sessionSpanThresholdMs);
    addIf('repeatedStartThreshold', options.repeatedStartThreshold);

    return this.http
      .get<FlatTestResultResponsesResponse>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-results/flat-responses`,
      { params }
    )
      .pipe(
        catchError(() => of({
          data: [],
          total: 0,
          page: options.page,
          limit: options.limit
        })
        )
      );
  }

  getFlatResponseFilterOptions(
    workspaceId: number,
    options: {
      code?: string;
      group?: string;
      login?: string;
      booklet?: string;
      unit?: string;
      response?: string;
      responseStatus?: string;
      responseValue?: string;
      tags?: string;
      geogebra?: string;
      audioLow?: string;
      audioLowThreshold?: string;
      shortProcessing?: string;
      shortProcessingThresholdMs?: string;
      longLoading?: string;
      longLoadingThresholdMs?: string;
      processingDurations?: string;
      processingDurationThresholdMs?: string;
      unitProgress?: string;
      sessionBrowsers?: string;
      sessionOs?: string;
      sessionScreens?: string;
      sessionIds?: string;
    }
  ): Observable<FlatResponseFilterOptionsResponse> {
    let params = new HttpParams();

    const addIf = (key: string, value?: string) => {
      const v = (value || '').trim();
      if (v) {
        params = params.set(key, v);
      }
    };

    addIf('code', options.code);
    addIf('group', options.group);
    addIf('login', options.login);
    addIf('booklet', options.booklet);
    addIf('unit', options.unit);
    addIf('response', options.response);
    addIf('responseStatus', options.responseStatus);
    addIf('responseValue', options.responseValue);
    addIf('tags', options.tags);
    addIf('geogebra', options.geogebra);
    addIf('audioLow', options.audioLow);
    addIf('audioLowThreshold', options.audioLowThreshold);
    addIf('shortProcessing', options.shortProcessing);
    addIf('shortProcessingThresholdMs', options.shortProcessingThresholdMs);
    addIf('longLoading', options.longLoading);
    addIf('longLoadingThresholdMs', options.longLoadingThresholdMs);
    addIf('processingDurations', options.processingDurations);
    addIf(
      'processingDurationThresholdMs',
      options.processingDurationThresholdMs
    );
    addIf('unitProgress', options.unitProgress);
    addIf('sessionBrowsers', options.sessionBrowsers);
    addIf('sessionOs', options.sessionOs);
    addIf('sessionScreens', options.sessionScreens);
    addIf('sessionIds', options.sessionIds);

    return this.http
      .get<FlatResponseFilterOptionsResponse>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-results/flat-responses/filter-options`,
      { params }
    )
      .pipe(
        catchError(() => of({
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
        })
        )
      );
  }

  getUnitLogs(workspaceId: number, unitId: number): Observable<UnitLogRow[]> {
    return this.http
      .get<UnitLogRow[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/units/${unitId}/logs`,
      {}
    )
      .pipe(catchError(() => of([])));
  }

  getBookletLogsForUnit(
    workspaceId: number,
    unitId: number
  ): Observable<BookletLogsForUnitResponse | null> {
    return this.http
      .get<BookletLogsForUnitResponse>(
      `${this.serverUrl}admin/workspace/${workspaceId}/units/${unitId}/booklet-logs`,
      {}
    )
      .pipe(catchError(() => of(null)));
  }

  invalidateCache(workspaceId: number): void {
    this.cacheService.invalidateWorkspaceCache(workspaceId);
    this.workspaceCacheInvalidatedSubject.next(workspaceId);
  }

  searchBookletsByName(
    workspaceId: number,
    bookletName: string,
    page?: number,
    limit?: number
  ): Observable<{
      data: {
        bookletId: number;
        bookletName: string;
        personId: number;
        personLogin: string;
        personCode: string;
        personGroup: string;
        units: {
          unitId: number;
          unitName: string;
          unitAlias: string | null;
        }[];
      }[];
      total: number;
    }> {
    let params = new HttpParams().set('bookletName', bookletName);

    if (page !== undefined) {
      params = params.set('page', page.toString());
    }

    if (limit !== undefined) {
      params = params.set('limit', limit.toString());
    }

    return this.http
      .get<{
      data: {
        bookletId: number;
        bookletName: string;
        personId: number;
        personLogin: string;
        personCode: string;
        personGroup: string;
        units: {
          unitId: number;
          unitName: string;
          unitAlias: string | null;
        }[];
      }[];
      total: number;
    }>(`${this.serverUrl}admin/workspace/${workspaceId}/booklets/search`, {
      params
    })
      .pipe(
        catchError(() => of({ data: [], total: 0 }))
      );
  }

  searchUnitsByName(
    workspaceId: number,
    unitName: string,
    page?: number,
    limit?: number
  ): Observable<{
      data: {
        unitId: number;
        unitName: string;
        unitAlias: string | null;
        bookletId: number;
        bookletName: string;
        personId: number;
        personLogin: string;
        personCode: string;
        personGroup: string;
        tags: {
          id: number;
          unitId: number;
          tag: string;
          color?: string;
          createdAt: Date;
        }[];
        responses: {
          variableId: string;
          value: string;
          status: string;
          code?: number;
          score?: number;
          codedStatus?: string;
        }[];
      }[];
      total: number;
    }> {
    let params = new HttpParams().set('unitName', unitName);

    if (page !== undefined) {
      params = params.set('page', page.toString());
    }

    if (limit !== undefined) {
      params = params.set('limit', limit.toString());
    }

    return this.http
      .get<{
      data: {
        unitId: number;
        unitName: string;
        unitAlias: string | null;
        bookletId: number;
        bookletName: string;
        personId: number;
        personLogin: string;
        personCode: string;
        personGroup: string;
        tags: {
          id: number;
          unitId: number;
          tag: string;
          color?: string;
          createdAt: Date;
        }[];
        responses: {
          variableId: string;
          value: string;
          status: string;
          code?: number;
          score?: number;
          codedStatus?: string;
        }[];
      }[];
      total: number;
    }>(`${this.serverUrl}admin/workspace/${workspaceId}/units/search`, {
      params
    })
      .pipe(
        catchError(() => of({ data: [], total: 0 }))
      );
  }

  deleteUnit(
    workspaceId: number,
    unitId: number
  ): Observable<{
      success: boolean;
      report: {
        deletedUnit: number | null;
        warnings: string[];
      };
    }> {
    return this.http
      .delete<{
      success: boolean;
      report: {
        deletedUnit: number | null;
        warnings: string[];
      };
    }>(`${this.serverUrl}admin/workspace/${workspaceId}/units/${unitId}`, {})
      .pipe(
        // Unit removals can invalidate all cached validation findings.
        // We clear only after a successful backend delete.
        tap(result => {
          if (result.success) {
            this.validationTaskStateService.invalidateWorkspace(workspaceId);
          }
        }),
        catchError(() => of({
          success: false,
          report: { deletedUnit: null, warnings: ['Failed to delete unit'] }
        }))
      );
  }

  deleteBooklet(
    workspaceId: number,
    bookletId: number
  ): Observable<{
      success: boolean;
      report: {
        deletedBooklet: number | null;
        warnings: string[];
      };
    }> {
    return this.http
      .delete<{
      success: boolean;
      report: {
        deletedBooklet: number | null;
        warnings: string[];
      };
    }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/booklets/${bookletId}`,
      {}
    )
      .pipe(
        tap(result => {
          if (result.success) {
            this.validationTaskStateService.invalidateWorkspace(workspaceId);
          }
        }),
        catchError(() => of({
          success: false,
          report: {
            deletedBooklet: null,
            warnings: ['Failed to delete booklet']
          }
        }))
      );
  }
}
