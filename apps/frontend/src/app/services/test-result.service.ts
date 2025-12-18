import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  catchError, Observable, of, Subject
} from 'rxjs';
import { logger } from 'nx/src/utils/logger';
import { SERVER_URL } from '../injection-tokens';
import { TestResultCacheService } from './test-result-cache.service';

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
}

@Injectable({
  providedIn: 'root'
})
export class TestResultService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);
  private cacheService = inject(TestResultCacheService);

  private workspaceCacheInvalidatedSubject = new Subject<number>();
  readonly workspaceCacheInvalidated$ =
    this.workspaceCacheInvalidatedSubject.asObservable();

  get authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('id_token')}` };
  }

  getTestPersons(workspaceId: number): Observable<number[]> {
    return this.http.get<number[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-groups`,
      { headers: this.authHeader }
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
      { headers: this.authHeader }
    )
      .pipe(catchError(() => of(null)));
  }

  getFlatResponseFrequencies(
    workspaceId: number,
    combos: FlatResponseFrequencyRequestCombo[]
  ): Observable<FlatResponseFrequenciesResponse> {
    return this.http
      .post<FlatResponseFrequenciesResponse>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-results/flat-responses/frequencies`,
      { combos },
      { headers: this.authHeader }
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

    return this.http
      .get<FlatTestResultResponsesResponse>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-results/flat-responses`,
      { headers: this.authHeader, params }
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
      { headers: this.authHeader, params }
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
      { headers: this.authHeader }
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
      { headers: this.authHeader }
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
      headers: this.authHeader,
      params
    })
      .pipe(
        catchError(() => {
          logger.error(
            `Error searching for booklets with name: ${bookletName}`
          );
          return of({ data: [], total: 0 });
        })
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
      headers: this.authHeader,
      params
    })
      .pipe(
        catchError(() => {
          logger.error(`Error searching for units with name: ${unitName}`);
          return of({ data: [], total: 0 });
        })
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
    }>(`${this.serverUrl}admin/workspace/${workspaceId}/units/${unitId}`, {
      headers: this.authHeader
    })
      .pipe(
        catchError(() => {
          logger.error(`Error deleting unit with ID: ${unitId}`);
          return of({
            success: false,
            report: { deletedUnit: null, warnings: ['Failed to delete unit'] }
          });
        })
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
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => {
          logger.error(`Error deleting booklet with ID: ${bookletId}`);
          return of({
            success: false,
            report: {
              deletedBooklet: null,
              warnings: ['Failed to delete booklet']
            }
          });
        })
      );
  }
}
