import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  Observable, catchError, forkJoin, map, shareReplay, throwError, timeout
} from 'rxjs';
import Keycloak from 'keycloak-js';
import { SERVER_URL } from '../../injection-tokens';
import { FilesDto } from '../../../../../../api-dto/files/files.dto';
import { suppressGlobalAndAuthRedirectHttpErrorContext } from '../../core/interceptors/http-error-context';
import { CodingScheme } from '../../models/coding-interfaces';

const REPLAY_ASSETS_REQUEST_TIMEOUT_MS = 120_000;

export type ReplayUnitResponse = {
  responses: {
    id: string;
    content: string;
  }[];
};

export type ReplayTimingMap = Record<string, number | null>;
export type ReplayStatisticsSource = 'internal' | 'external';
export type ReplayClientTimings = {
  codingSessionMs: number | null;
  routeToVisibleMs: number | null;
  loadToVisibleMs: number | null;
  routeToPayloadRequestMs: number | null;
  payloadMs: number | null;
  payloadToVisibleMs: number | null;
  payloadToPlayerReadyMs: number | null;
  playerReadyToVisibleMs: number | null;
};
export type ReplayServerTimings = ReplayTimingMap;

export type ReplayAssetsPayload = {
  unitDef: FilesDto[];
  player: FilesDto[];
  vocs: FilesDto[];
};

export type ReplayResponsePayload = {
  response: ReplayUnitResponse;
  serverTimings?: ReplayServerTimings;
};

export type ReplayPayload = ReplayAssetsPayload & ReplayResponsePayload & {
  codingScheme?: CodingScheme | null;
  serverTimings?: ReplayServerTimings;
};

export type ReplayStatisticsResponse = {
  id: number;
  timestamp: string;
  workspace_id: number;
  unit_id: string;
  booklet_id?: string;
  test_person_login?: string;
  test_person_code?: string;
  duration_milliseconds: number;
  replay_url?: string;
  replay_source?: ReplayStatisticsSource;
  success?: boolean;
  error_message?: string;
  client_timings?: ReplayClientTimings;
  server_timings?: ReplayServerTimings;
};

export type ReplaySourceSummaryResponse = {
  internal: number;
  external: number;
  total: number;
};

type ReplayAssetsCacheEntry = {
  identity: object;
  request$: Observable<ReplayAssetsCacheValue>;
  expiresAt: number | null;
  expirationTimer: ReturnType<typeof setTimeout> | null;
};

type ReplayAssetsCacheValue = {
  assets: ReplayAssetsPayload;
  getCodingScheme: () => CodingScheme | null | undefined;
};

@Injectable({
  providedIn: 'root'
})
export class ReplayBackendService {
  private readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);
  private readonly keycloak = inject(Keycloak, { optional: true });
  private readonly replayAssetsCache = new Map<string, ReplayAssetsCacheEntry>();

  private get authHeader() {
    return {};
  }

  storeReplayStatistics(
    workspaceId: number,
    data: {
      unitId: string;
      bookletId?: string;
      testPersonLogin?: string;
      testPersonCode?: string;
      durationMilliseconds: number;
      replayUrl?: string;
      success?: boolean;
      errorMessage?: string;
      clientTimings?: ReplayClientTimings;
      serverTimings?: ReplayServerTimings;
    },
    authToken?: string
  ): Observable<ReplayStatisticsResponse> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/replay-statistics`;
    const headers = authToken ?
      { Authorization: `Bearer ${authToken}` } :
      this.authHeader;
    return this.http.post<ReplayStatisticsResponse>(url, data, {
      headers,
      context: suppressGlobalAndAuthRedirectHttpErrorContext()
    });
  }

  getReplayPayload(
    workspaceId: number,
    testPerson: string,
    unitId: string,
    authToken?: string,
    includeCodingScheme = false
  ): Observable<ReplayPayload> {
    return forkJoin({
      assetsEntry: this.getReplayAssetsCacheValue(workspaceId, unitId, authToken),
      responsePayload: this.getReplayResponse(workspaceId, testPerson, unitId, authToken)
    }).pipe(
      map(({ assetsEntry, responsePayload }) => ({
        ...assetsEntry.assets,
        ...(includeCodingScheme ?
          { codingScheme: assetsEntry.getCodingScheme() } :
          {}),
        response: responsePayload.response,
        serverTimings: this.prefixServerTimings(
          'response',
          responsePayload.serverTimings
        )
      }))
    );
  }

  private prefixServerTimings(
    prefix: 'response',
    timings?: ReplayServerTimings
  ): ReplayServerTimings | undefined {
    if (!timings) {
      return undefined;
    }
    const prefixed = Object.entries(timings).reduce<ReplayServerTimings>((acc, [key, value]) => {
      if (typeof value === 'number' || value === null) {
        acc[`${prefix}${key.charAt(0).toUpperCase()}${key.slice(1)}`] = value;
      }
      return acc;
    }, {});
    return Object.keys(prefixed).length ? prefixed : undefined;
  }

  getReplayAssets(
    workspaceId: number,
    unitId: string,
    authToken?: string
  ): Observable<ReplayAssetsPayload> {
    return this.getReplayAssetsCacheValue(workspaceId, unitId, authToken)
      .pipe(map(entry => entry.assets));
  }

  private getReplayAssetsCacheValue(
    workspaceId: number,
    unitId: string,
    authToken?: string
  ): Observable<ReplayAssetsCacheValue> {
    const now = Date.now();
    this.removeExpiredReplayAssets(now);
    const authContext = authToken ??
      this.keycloak?.tokenParsed?.sub ??
      this.keycloak?.idTokenParsed?.sub ??
      null;
    const cacheKey = JSON.stringify([workspaceId, unitId, authContext]);
    const cached = this.replayAssetsCache.get(cacheKey);
    if (cached && (cached.expiresAt === null || cached.expiresAt > now)) {
      return cached.request$;
    }

    const url = `${this.serverUrl}admin/workspace/${workspaceId}/replay-assets/${encodeURIComponent(unitId)}`;
    const headers = authToken ?
      { Authorization: `Bearer ${authToken}` } :
      this.authHeader;
    const params = new HttpParams().set('replayPart', 'assets');
    const identity = {};
    const request$ = this.http.get<ReplayAssetsPayload>(url, {
      headers,
      params,
      observe: 'response'
    }).pipe(
      timeout({ first: REPLAY_ASSETS_REQUEST_TIMEOUT_MS }),
      map(response => {
        const maxAgeSeconds = ReplayBackendService.getCacheMaxAgeSeconds(
          response.headers.get('Cache-Control')
        );
        const current = this.replayAssetsCache.get(cacheKey);
        if (current?.identity === identity) {
          if (maxAgeSeconds > 0) {
            current.expiresAt = Date.now() + maxAgeSeconds * 1000;
            current.expirationTimer = setTimeout(() => {
              this.deleteReplayAssetsCacheEntry(cacheKey, identity);
            }, maxAgeSeconds * 1000);
          } else {
            this.deleteReplayAssetsCacheEntry(cacheKey, identity);
          }
        }
        if (!response.body) {
          throw new Error('Replay assets response body is empty.');
        }
        return ReplayBackendService.createAssetsCacheValue(response.body);
      }),
      catchError(error => {
        this.deleteReplayAssetsCacheEntry(cacheKey, identity);
        return throwError(() => error);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.replayAssetsCache.set(cacheKey, {
      identity,
      request$,
      expiresAt: null,
      expirationTimer: null
    });
    return request$;
  }

  private removeExpiredReplayAssets(now: number): void {
    this.replayAssetsCache.forEach((entry, key) => {
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        this.deleteReplayAssetsCacheEntry(key, entry.identity);
      }
    });
  }

  private deleteReplayAssetsCacheEntry(key: string, identity: object): void {
    const entry = this.replayAssetsCache.get(key);
    if (entry?.identity !== identity) {
      return;
    }
    if (entry.expirationTimer !== null) {
      clearTimeout(entry.expirationTimer);
    }
    this.replayAssetsCache.delete(key);
  }

  private static getCacheMaxAgeSeconds(cacheControl: string | null): number {
    if (!cacheControl || /(?:^|,)\s*(?:no-store|no-cache)\s*(?:,|$)/i.test(cacheControl)) {
      return 0;
    }
    const maxAgeMatch = cacheControl.match(/(?:^|,)\s*max-age\s*=\s*(\d+)\s*(?:,|$)/i);
    return maxAgeMatch ? Number(maxAgeMatch[1]) : 0;
  }

  private static parseCodingScheme(vocs: FilesDto[]): CodingScheme | null | undefined {
    const vocsData = vocs[0]?.data;
    if (!vocsData) {
      return undefined;
    }
    try {
      return JSON.parse(vocsData) as CodingScheme;
    } catch {
      return null;
    }
  }

  private static createAssetsCacheValue(assets: ReplayAssetsPayload): ReplayAssetsCacheValue {
    let codingSchemeParsed = false;
    let codingScheme: CodingScheme | null | undefined;
    return {
      assets,
      getCodingScheme: () => {
        if (!codingSchemeParsed) {
          codingScheme = ReplayBackendService.parseCodingScheme(assets.vocs);
          codingSchemeParsed = true;
        }
        return codingScheme;
      }
    };
  }

  getReplayResponse(
    workspaceId: number,
    testPerson: string,
    unitId: string,
    authToken?: string
  ): Observable<ReplayResponsePayload> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/replay-response/${encodeURIComponent(testPerson)}/${encodeURIComponent(unitId)}`;
    const headers = authToken ?
      { Authorization: `Bearer ${authToken}` } :
      this.authHeader;
    const params = new HttpParams().set('replayPart', 'response');
    return this.http.get<ReplayResponsePayload>(url, { headers, params });
  }

  getReplayFrequencyByUnit(
    workspaceId: number,
    options?: { from?: string; to?: string; lastDays?: number; limit?: number }
  ): Observable<Record<string, number>> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/replay-statistics/frequency`;
    let params = new HttpParams();
    if (options?.from) {
      params = params.set('from', options.from);
    }
    if (options?.to) {
      params = params.set('to', options.to);
    }
    if (options?.lastDays !== undefined) {
      params = params.set('lastDays', options.lastDays.toString());
    }
    if (options?.limit !== undefined) {
      params = params.set('limit', options.limit.toString());
    }
    return this.http.get<Record<string, number>>(url, { params, headers: this.authHeader });
  }

  getReplaySourceSummary(
    workspaceId: number,
    options?: { from?: string; to?: string; lastDays?: number }
  ): Observable<ReplaySourceSummaryResponse> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/replay-statistics/sources`;
    let params = new HttpParams();
    if (options?.from) {
      params = params.set('from', options.from);
    }
    if (options?.to) {
      params = params.set('to', options.to);
    }
    if (options?.lastDays !== undefined) {
      params = params.set('lastDays', options.lastDays.toString());
    }
    return this.http.get<ReplaySourceSummaryResponse>(url, { params, headers: this.authHeader });
  }

  getReplayDurationStatistics(
    workspaceId: number,
    unitId?: string,
    options?: { from?: string; to?: string; lastDays?: number }
  ): Observable<{
      min: number;
      max: number;
      average: number;
      distribution: Record<string, number>;
      unitAverages?: Record<string, number>;
    }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/replay-statistics/duration`;
    let params = new HttpParams();
    if (unitId) {
      params = params.set('unitId', unitId);
    }
    if (options?.from) {
      params = params.set('from', options.from);
    }
    if (options?.to) {
      params = params.set('to', options.to);
    }
    if (options?.lastDays !== undefined) {
      params = params.set('lastDays', options.lastDays.toString());
    }
    return this.http.get<{
      min: number;
      max: number;
      average: number;
      distribution: Record<string, number>;
      unitAverages?: Record<string, number>;
    }>(url, { params, headers: this.authHeader });
  }

  getReplayDistributionByDay(
    workspaceId: number,
    options?: { from?: string; to?: string; lastDays?: number }
  ): Observable<Record<string, number>> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/replay-statistics/distribution/day`;
    let params = new HttpParams();
    if (options?.from) {
      params = params.set('from', options.from);
    }
    if (options?.to) {
      params = params.set('to', options.to);
    }
    if (options?.lastDays !== undefined) {
      params = params.set('lastDays', options.lastDays.toString());
    }
    return this.http.get<Record<string, number>>(url, { params, headers: this.authHeader });
  }

  getReplayDistributionByHour(
    workspaceId: number,
    options?: { from?: string; to?: string; lastDays?: number }
  ): Observable<Record<string, number>> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/replay-statistics/distribution/hour`;
    let params = new HttpParams();
    if (options?.from) {
      params = params.set('from', options.from);
    }
    if (options?.to) {
      params = params.set('to', options.to);
    }
    if (options?.lastDays !== undefined) {
      params = params.set('lastDays', options.lastDays.toString());
    }
    return this.http.get<Record<string, number>>(url, { params, headers: this.authHeader });
  }

  getReplayErrorStatistics(
    workspaceId: number,
    options?: { from?: string; to?: string; lastDays?: number; limit?: number }
  ): Observable<{
      successRate: number;
      totalReplays: number;
      successfulReplays: number;
      failedReplays: number;
      commonErrors: Array<{ message: string; count: number }>;
    }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/replay-statistics/errors`;
    let params = new HttpParams();
    if (options?.from) {
      params = params.set('from', options.from);
    }
    if (options?.to) {
      params = params.set('to', options.to);
    }
    if (options?.lastDays !== undefined) {
      params = params.set('lastDays', options.lastDays.toString());
    }
    if (options?.limit !== undefined) {
      params = params.set('limit', options.limit.toString());
    }
    return this.http.get<{
      successRate: number;
      totalReplays: number;
      successfulReplays: number;
      failedReplays: number;
      commonErrors: Array<{ message: string; count: number }>;
    }>(url, { params, headers: this.authHeader });
  }

  getFailureDistributionByUnit(
    workspaceId: number,
    options?: { from?: string; to?: string; lastDays?: number; limit?: number }
  ): Observable<Record<string, number>> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/replay-statistics/failures/unit`;
    let params = new HttpParams();
    if (options?.from) {
      params = params.set('from', options.from);
    }
    if (options?.to) {
      params = params.set('to', options.to);
    }
    if (options?.lastDays !== undefined) {
      params = params.set('lastDays', options.lastDays.toString());
    }
    if (options?.limit !== undefined) {
      params = params.set('limit', options.limit.toString());
    }
    return this.http.get<Record<string, number>>(url, { params, headers: this.authHeader });
  }

  getFailureDistributionByDay(
    workspaceId: number,
    options?: { from?: string; to?: string; lastDays?: number }
  ): Observable<Record<string, number>> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/replay-statistics/failures/day`;
    let params = new HttpParams();
    if (options?.from) {
      params = params.set('from', options.from);
    }
    if (options?.to) {
      params = params.set('to', options.to);
    }
    if (options?.lastDays !== undefined) {
      params = params.set('lastDays', options.lastDays.toString());
    }
    return this.http.get<Record<string, number>>(url, { params, headers: this.authHeader });
  }

  getFailureDistributionByHour(
    workspaceId: number,
    options?: { from?: string; to?: string; lastDays?: number }
  ): Observable<Record<string, number>> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/replay-statistics/failures/hour`;
    let params = new HttpParams();
    if (options?.from) {
      params = params.set('from', options.from);
    }
    if (options?.to) {
      params = params.set('to', options.to);
    }
    if (options?.lastDays !== undefined) {
      params = params.set('lastDays', options.lastDays.toString());
    }
    return this.http.get<Record<string, number>>(url, { params, headers: this.authHeader });
  }
}
