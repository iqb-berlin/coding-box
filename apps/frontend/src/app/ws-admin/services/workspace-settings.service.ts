import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';
import { WorkspaceSettings } from '../models/workspace-settings.model';

@Injectable({
  providedIn: 'root'
})
export class WorkspaceSettingsService {
  private http = inject(HttpClient);
  private serverUrl = inject(SERVER_URL);

  getWorkspaceSetting(workspaceId: number, key: string): Observable<WorkspaceSettings> {
    return this.http.get<WorkspaceSettings>(`${this.serverUrl}/api/workspace/${workspaceId}/settings/${key}`);
  }

  setWorkspaceSetting(workspaceId: number, key: string, value: string, description?: string): Observable<WorkspaceSettings> {
    return this.http.post<WorkspaceSettings>(`${this.serverUrl}/api/workspace/${workspaceId}/settings`, {
      key,
      value,
      description
    });
  }

  updateWorkspaceSetting(workspaceId: number, settingId: number, value: string): Observable<WorkspaceSettings> {
    return this.http.put<WorkspaceSettings>(`${this.serverUrl}/api/workspace/${workspaceId}/settings/${settingId}`, {
      value
    });
  }

  deleteWorkspaceSetting(workspaceId: number, settingId: number): Observable<void> {
    return this.http.delete<void>(`${this.serverUrl}/api/workspace/${workspaceId}/settings/${settingId}`);
  }

  getAutoFetchCodingStatistics(workspaceId: number): Observable<boolean> {
    return new Observable(observer => {
      this.getWorkspaceSetting(workspaceId, 'auto-fetch-coding-statistics')
        .subscribe({
          next: setting => {
            try {
              const parsed = JSON.parse(setting.value);
              observer.next(parsed.enabled ?? true); // Default to true
            } catch {
              observer.next(true); // Default to true if parsing fails
            }
            observer.complete();
          },
          error: () => {
            observer.next(true); // Default to true if setting doesn't exist
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
}
