import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';
import { WorkspaceSettings } from '../models/workspace-settings.model';

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
  private get serverUrl(): string {
    return this.rawServerUrl.endsWith('/') ? this.rawServerUrl.slice(0, -1) : this.rawServerUrl;
  }

  getWorkspaceSetting(workspaceId: number, key: string): Observable<WorkspaceSettings> {
    return this.http.get<WorkspaceSettings>(`${this.serverUrl}/workspace/${workspaceId}/settings/${key}`);
  }

  setWorkspaceSetting(workspaceId: number, key: string, value: string, description?: string): Observable<WorkspaceSettings> {
    return this.http.post<WorkspaceSettings>(`${this.serverUrl}/workspace/${workspaceId}/settings`, {
      key,
      value,
      description
    });
  }

  updateWorkspaceSetting(workspaceId: number, settingId: number, value: string): Observable<WorkspaceSettings> {
    return this.http.put<WorkspaceSettings>(`${this.serverUrl}/workspace/${workspaceId}/settings/${settingId}`, {
      value
    });
  }

  deleteWorkspaceSetting(workspaceId: number, settingId: number): Observable<void> {
    return this.http.delete<void>(`${this.serverUrl}/workspace/${workspaceId}/settings/${settingId}`);
  }

  getAutoFetchCodingStatistics(workspaceId: number): Observable<boolean> {
    return new Observable(observer => {
      this.getWorkspaceSetting(workspaceId, 'auto-fetch-coding-statistics')
        .subscribe({
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

  setAutoFetchCodingStatistics(workspaceId: number, enabled: boolean): Observable<WorkspaceSettings> {
    const value = JSON.stringify({ enabled });
    return this.setWorkspaceSetting(
      workspaceId,
      'auto-fetch-coding-statistics',
      value,
      'Controls whether coding statistics are automatically fetched in the coding management component'
    );
  }

  getResponseMatchingMode(workspaceId: number): Observable<ResponseMatchingFlag[]> {
    return new Observable(observer => {
      this.getWorkspaceSetting(workspaceId, 'response-matching-mode')
        .subscribe({
          next: setting => {
            try {
              const parsed = JSON.parse(setting.value);
              observer.next(parsed.flags ?? DEFAULT_RESPONSE_MATCHING_MODE.flags);
            } catch {
              observer.next(DEFAULT_RESPONSE_MATCHING_MODE.flags);
            }
            observer.complete();
          },
          error: () => {
            observer.next(DEFAULT_RESPONSE_MATCHING_MODE.flags);
            observer.complete();
          }
        });
    });
  }

  setResponseMatchingMode(workspaceId: number, flags: ResponseMatchingFlag[]): Observable<WorkspaceSettings> {
    const value = JSON.stringify({ flags });
    return this.setWorkspaceSetting(
      workspaceId,
      'response-matching-mode',
      value,
      'Controls how responses are aggregated by value similarity for coding case distribution'
    );
  }
}
