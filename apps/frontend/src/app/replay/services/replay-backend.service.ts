import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';

export type ReplayStatisticsResponse = {
  id: number;
  timestamp: string;
  workspaceId: number;
  unitId: string;
  bookletId?: string;
  testPersonLogin?: string;
  testPersonCode?: string;
  durationMilliseconds: number;
  replayUrl?: string;
  success?: boolean;
  errorMessage?: string;
};

@Injectable({
  providedIn: 'root'
})
export class ReplayBackendService {
  private readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  private get authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('id_token')}` };
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
    }
  ): Observable<ReplayStatisticsResponse> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/replay-statistics`;
    return this.http.post<ReplayStatisticsResponse>(url, data, { headers: this.authHeader });
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
