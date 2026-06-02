import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, forkJoin, map } from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';
import { FilesDto } from '../../../../../../api-dto/files/files.dto';
import { suppressGlobalAndAuthRedirectHttpErrorContext } from '../../core/interceptors/http-error-context';

export type ReplayUnitResponse = {
  responses: {
    id: string;
    content: string;
  }[];
};

export type ReplayTimingMap = Record<string, number | null>;
export type ReplayStatisticsSource = 'internal' | 'external';
export type ReplayClientTimings = {
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

@Injectable({
  providedIn: 'root'
})
export class ReplayBackendService {
  private readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  private get authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('auth_token')}` };
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
    authToken?: string
  ): Observable<ReplayPayload> {
    return forkJoin({
      assets: this.getReplayAssets(workspaceId, unitId, authToken),
      responsePayload: this.getReplayResponse(workspaceId, testPerson, unitId, authToken)
    }).pipe(
      map(({ assets, responsePayload }) => ({
        ...assets,
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
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/replay-assets/${encodeURIComponent(unitId)}`;
    const headers = authToken ?
      { Authorization: `Bearer ${authToken}` } :
      this.authHeader;
    const params = new HttpParams().set('replayPart', 'assets');
    return this.http.get<ReplayAssetsPayload>(url, { headers, params });
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
