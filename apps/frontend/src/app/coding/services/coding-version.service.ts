import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of } from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';

export interface ResetVersionJobStatus {
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'not_found';
  progress: number;
  result?: {
    affectedResponseCount: number;
    cascadeResetVersions: ('v2' | 'v3')[];
    message: string;
  };
  error?: string;
}

export interface ActiveResetJob {
  hasActiveJob: boolean;
  jobId?: string;
  version?: string;
  progress?: number;
  status?: string;
}

@Injectable({
  providedIn: 'root'
})
export class CodingVersionService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  resetCodingVersion(
    workspaceId: number,
    version: 'v1' | 'v2' | 'v3',
    unitFilters?: string[],
    variableFilters?: string[]
  ): Observable<{ jobId: string; message: string }> {
    return this.http
      .post<{ jobId: string; message: string }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/reset-version`,
      {
        version,
        unitFilters: unitFilters || [],
        variableFilters: variableFilters || []
      }
    );
  }

  getResetVersionJobStatus(
    workspaceId: number,
    jobId: string
  ): Observable<ResetVersionJobStatus> {
    return this.http
      .get<ResetVersionJobStatus>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/reset-version/job/${jobId}`
    )
      .pipe(
        catchError(() => of({
          status: 'failed' as const,
          progress: 0,
          error: 'Failed to get reset job status'
        }))
      );
  }

  getActiveResetVersionJob(
    workspaceId: number
  ): Observable<ActiveResetJob> {
    return this.http
      .get<ActiveResetJob>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/reset-version/active`
    )
      .pipe(
        catchError(() => of({ hasActiveJob: false }))
      );
  }
}
