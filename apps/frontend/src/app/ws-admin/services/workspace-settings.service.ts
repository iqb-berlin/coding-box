import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { finalize, shareReplay, tap } from 'rxjs/operators';
import { SERVER_URL } from '../../injection-tokens';
import { WorkspaceSettings } from '../models/workspace-settings.model';
import { suppressGlobalHttpErrorContext } from '../../core/interceptors/http-error-context';

export enum ResponseMatchingFlag {
  NO_AGGREGATION = 'NO_AGGREGATION',
  IGNORE_CASE = 'IGNORE_CASE',
  IGNORE_WHITESPACE = 'IGNORE_WHITESPACE'
}

export interface ResponseMatchingModeDto {
  flags: ResponseMatchingFlag[];
}

export const DEFAULT_RESPONSE_MATCHING_MODE: ResponseMatchingModeDto = {
  flags: []
};

@Injectable({
  providedIn: 'root'
})
export class WorkspaceSettingsService {
  private http = inject(HttpClient);
  private rawServerUrl = inject(SERVER_URL);
  private readonly settingsCacheTtlMs = 10_000;
  private readonly settingsCache = new Map<
  string,
  { expiresAt: number; value: WorkspaceSettings }
  >();

  private readonly settingsInFlight = new Map<
  string,
  Observable<WorkspaceSettings>
  >();

  private get serverUrl(): string {
    return this.rawServerUrl.endsWith('/') ?
      this.rawServerUrl.slice(0, -1) :
      this.rawServerUrl;
  }

  getWorkspaceSetting(
    workspaceId: number,
    key: string,
    suppressGlobalError = false
  ): Observable<WorkspaceSettings> {
    const cacheKey = this.getSettingCacheKey(workspaceId, key);
    const requestCacheKey = this.getSettingRequestCacheKey(
      workspaceId,
      key,
      suppressGlobalError
    );
    const cached = this.settingsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return new Observable(observer => {
        observer.next(cached.value);
        observer.complete();
      });
    }

    const inFlight = this.settingsInFlight.get(requestCacheKey);
    if (inFlight) {
      return inFlight;
    }

    const request$ = this.http.get<WorkspaceSettings>(
      `${this.serverUrl}/workspace/${workspaceId}/settings/${key}`,
      suppressGlobalError ? { context: suppressGlobalHttpErrorContext() } : {}
    ).pipe(
      tap(setting => {
        if (this.settingsInFlight.get(requestCacheKey) === request$) {
          this.settingsCache.set(cacheKey, {
            expiresAt: Date.now() + this.settingsCacheTtlMs,
            value: setting
          });
        }
      }),
      finalize(() => {
        if (this.settingsInFlight.get(requestCacheKey) === request$) {
          this.settingsInFlight.delete(requestCacheKey);
        }
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.settingsInFlight.set(requestCacheKey, request$);
    return request$;
  }

  setWorkspaceSetting(
    workspaceId: number,
    key: string,
    value: string,
    description?: string
  ): Observable<WorkspaceSettings> {
    return this.http.post<WorkspaceSettings>(
      `${this.serverUrl}/workspace/${workspaceId}/settings`,
      {
        key,
        value,
        description
      }
    ).pipe(
      tap(() => this.invalidateWorkspaceSetting(workspaceId, key))
    );
  }

  updateWorkspaceSetting(
    workspaceId: number,
    settingId: number,
    value: string
  ): Observable<WorkspaceSettings> {
    return this.http.put<WorkspaceSettings>(
      `${this.serverUrl}/workspace/${workspaceId}/settings/${settingId}`,
      {
        value
      }
    ).pipe(
      tap(() => this.invalidateWorkspaceSettings(workspaceId))
    );
  }

  deleteWorkspaceSetting(
    workspaceId: number,
    settingId: number
  ): Observable<void> {
    return this.http.delete<void>(
      `${this.serverUrl}/workspace/${workspaceId}/settings/${settingId}`
    ).pipe(
      tap(() => this.invalidateWorkspaceSettings(workspaceId))
    );
  }

  getAutoFetchCodingStatistics(workspaceId: number): Observable<boolean> {
    return new Observable(observer => {
      this.getWorkspaceSetting(
        workspaceId,
        'auto-fetch-coding-statistics',
        true
      ).subscribe({
        next: setting => {
          try {
            const parsed = JSON.parse(setting.value);
            observer.next(parsed.enabled ?? false);
          } catch {
            observer.next(false);
          }
          observer.complete();
        },
        error: () => {
          observer.next(false);
          observer.complete();
        }
      });
    });
  }

  setAutoFetchCodingStatistics(
    workspaceId: number,
    enabled: boolean
  ): Observable<WorkspaceSettings> {
    const value = JSON.stringify({ enabled });
    return this.setWorkspaceSetting(
      workspaceId,
      'auto-fetch-coding-statistics',
      value,
      'Controls whether coding statistics are automatically fetched in the coding management component'
    );
  }

  getAutoRefreshManualCodingJobs(workspaceId: number): Observable<boolean> {
    return new Observable(observer => {
      this.getWorkspaceSetting(
        workspaceId,
        'auto-refresh-manual-coding-jobs',
        true
      ).subscribe({
        next: setting => {
          try {
            const parsed = JSON.parse(setting.value);
            observer.next(parsed.enabled ?? true);
          } catch {
            observer.next(true);
          }
          observer.complete();
        },
        error: () => {
          observer.next(true);
          observer.complete();
        }
      });
    });
  }

  setAutoRefreshManualCodingJobs(
    workspaceId: number,
    enabled: boolean
  ): Observable<WorkspaceSettings> {
    const value = JSON.stringify({ enabled });
    return this.setWorkspaceSetting(
      workspaceId,
      'auto-refresh-manual-coding-jobs',
      value,
      'Controls whether coding status and manual coding views refresh automatically'
    );
  }

  getShowTestResultsLogAnomalies(workspaceId: number): Observable<boolean> {
    return new Observable(observer => {
      this.getWorkspaceSetting(
        workspaceId,
        'show-test-results-log-anomalies',
        true
      ).subscribe({
        next: setting => {
          try {
            const parsed = JSON.parse(setting.value);
            observer.next(parsed.enabled ?? false);
          } catch {
            observer.next(false);
          }
          observer.complete();
        },
        error: () => {
          observer.next(false);
          observer.complete();
        }
      });
    });
  }

  setShowTestResultsLogAnomalies(
    workspaceId: number,
    enabled: boolean
  ): Observable<WorkspaceSettings> {
    const value = JSON.stringify({ enabled });
    return this.setWorkspaceSetting(
      workspaceId,
      'show-test-results-log-anomalies',
      value,
      'Controls whether log anomaly information is shown on the test results page'
    );
  }

  getIncludeDeriveErrorInManualCoding(
    workspaceId: number
  ): Observable<boolean> {
    return new Observable(observer => {
      this.getWorkspaceSetting(
        workspaceId,
        'include-derive-error-in-manual-coding',
        true
      ).subscribe({
        next: setting => {
          try {
            const parsed = JSON.parse(setting.value);
            observer.next(parsed.enabled ?? false);
          } catch {
            observer.next(false);
          }
          observer.complete();
        },
        error: () => {
          observer.next(false);
          observer.complete();
        }
      });
    });
  }

  setIncludeDeriveErrorInManualCoding(
    workspaceId: number,
    enabled: boolean
  ): Observable<WorkspaceSettings> {
    const value = JSON.stringify({ enabled });
    return this.setWorkspaceSetting(
      workspaceId,
      'include-derive-error-in-manual-coding',
      value,
      'Controls whether DERIVE_ERROR responses can be included in manual coding jobs'
    );
  }

  getEnableRegexSearch(workspaceId: number): Observable<boolean> {
    return new Observable(observer => {
      this.getWorkspaceSetting(
        workspaceId,
        'enable-regex-search',
        true
      ).subscribe({
        next: setting => {
          try {
            const parsed = JSON.parse(setting.value);
            observer.next(parsed.enabled ?? false);
          } catch {
            observer.next(false);
          }
          observer.complete();
        },
        error: () => {
          observer.next(false);
          observer.complete();
        }
      });
    });
  }

  setEnableRegexSearch(
    workspaceId: number,
    enabled: boolean
  ): Observable<WorkspaceSettings> {
    const value = JSON.stringify({ enabled });
    return this.setWorkspaceSetting(
      workspaceId,
      'enable-regex-search',
      value,
      'Controls whether selected workspace search fields interpret input as regular expressions'
    );
  }

  getResponseMatchingMode(
    workspaceId: number
  ): Observable<ResponseMatchingFlag[]> {
    return new Observable(observer => {
      this.getWorkspaceSetting(workspaceId, 'response-matching-mode').subscribe(
        {
          next: setting => {
            try {
              const parsed = JSON.parse(setting.value);
              observer.next(
                parsed.flags ?? DEFAULT_RESPONSE_MATCHING_MODE.flags
              );
            } catch {
              observer.next(DEFAULT_RESPONSE_MATCHING_MODE.flags);
            }
            observer.complete();
          },
          error: () => {
            observer.next(DEFAULT_RESPONSE_MATCHING_MODE.flags);
            observer.complete();
          }
        }
      );
    });
  }

  setResponseMatchingMode(
    workspaceId: number,
    flags: ResponseMatchingFlag[]
  ): Observable<WorkspaceSettings> {
    const value = JSON.stringify({ flags });
    return this.setWorkspaceSetting(
      workspaceId,
      'response-matching-mode',
      value,
      'Controls how responses are aggregated by value similarity for coding case distribution'
    );
  }

  getAggregationThreshold(workspaceId: number): Observable<number | null> {
    return new Observable(observer => {
      this.getWorkspaceSetting(
        workspaceId,
        'duplicate-aggregation-threshold'
      ).subscribe({
        next: setting => {
          try {
            observer.next(this.normalizeAggregationThreshold(setting.value));
          } catch {
            observer.next(2);
          }
          observer.complete();
        },
        error: () => {
          observer.next(2); // Default
          observer.complete();
        }
      });
    });
  }

  setAggregationThreshold(
    workspaceId: number,
    threshold: number | null
  ): Observable<WorkspaceSettings> {
    const normalizedThreshold = this.normalizeAggregationThreshold(threshold);
    return this.setWorkspaceSetting(
      workspaceId,
      'duplicate-aggregation-threshold',
      normalizedThreshold === null ?
        'disabled' :
        normalizedThreshold.toString(),
      'Minimum number of identical responses required for aggregation'
    );
  }

  private normalizeAggregationThreshold(
    value: number | string | null | undefined
  ): number | null {
    if (
      value === 'disabled' ||
      value === '0' ||
      value === 0 ||
      value === null
    ) {
      return null;
    }
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return 2;
    }
    return Math.min(100, Math.max(2, Math.round(numericValue)));
  }

  private getSettingCacheKey(workspaceId: number, key: string): string {
    return `${workspaceId}:${key}`;
  }

  private getSettingRequestCacheKey(
    workspaceId: number,
    key: string,
    suppressGlobalError: boolean
  ): string {
    const errorMode = suppressGlobalError ? 'quiet' : 'default';
    return `${this.getSettingCacheKey(workspaceId, key)}:${errorMode}`;
  }

  private invalidateWorkspaceSetting(workspaceId: number, key: string): void {
    const cacheKey = this.getSettingCacheKey(workspaceId, key);
    const requestPrefix = `${cacheKey}:`;
    this.settingsCache.delete(cacheKey);
    Array.from(this.settingsInFlight.keys())
      .filter(inFlightKey => inFlightKey.startsWith(requestPrefix))
      .forEach(inFlightKey => this.settingsInFlight.delete(inFlightKey));
  }

  private invalidateWorkspaceSettings(workspaceId: number): void {
    const prefix = `${workspaceId}:`;
    Array.from(this.settingsCache.keys())
      .filter(cacheKey => cacheKey.startsWith(prefix))
      .forEach(cacheKey => this.settingsCache.delete(cacheKey));
    Array.from(this.settingsInFlight.keys())
      .filter(cacheKey => cacheKey.startsWith(prefix))
      .forEach(cacheKey => this.settingsInFlight.delete(cacheKey));
  }
}
