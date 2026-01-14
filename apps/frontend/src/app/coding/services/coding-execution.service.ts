import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, of } from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';

@Injectable({
  providedIn: 'root'
})
export class CodingExecutionService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  codeTestPersons(workspace_id: number, testPersonIds: number[]): Observable<{
    totalResponses: number;
    statusCounts: {
      [key: string]: number;
    };
    jobId?: string;
    message?: string;
  }> {
    const params = new HttpParams().set('testPersons', testPersonIds.join(','));
    return this.http
      .get<{
      totalResponses: number;
      statusCounts: {
        [key: string]: number;
      };
      jobId?: string;
      message?: string;
    }>(
      `${this.serverUrl}admin/workspace/${workspace_id}/coding`,
      { params })
      .pipe(
        catchError(() => of({ totalResponses: 0, statusCounts: {} }))
      );
  }

  getCodingJobStatus(workspace_id: number, jobId: string): Observable<{
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused';
    progress: number;
    result?: {
      totalResponses: number;
      statusCounts: {
        [key: string]: number;
      };
    };
    error?: string;
  }> {
    return this.http
      .get<{
      status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused';
      progress: number;
      result?: {
        totalResponses: number;
        statusCounts: {
          [key: string]: number;
        };
      };
      error?: string;
    }>(
      `${this.serverUrl}admin/workspace/${workspace_id}/coding/job/${jobId}`,
      {}
    )
      .pipe(
        catchError(() => of({
          status: 'failed' as const,
          progress: 0,
          error: 'Failed to get job status'
        }))
      );
  }

  createCodingStatisticsJob(workspace_id: number): Observable<{ jobId: string; message: string }> {
    return this.http
      .post<{ jobId: string; message: string }>(
      `${this.serverUrl}admin/workspace/${workspace_id}/coding/statistics/job`,
      {},
      {}
    )
      .pipe(
        catchError(() => of({ jobId: '', message: 'Failed to create job' }))
      );
  }
}
