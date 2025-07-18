import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  catchError,
  Observable,
  of,
  switchMap
} from 'rxjs';
import { CodingStatistics } from '../../../../../api-dto/coding/coding-statistics';
import { SERVER_URL } from '../injection-tokens';
import { AppService } from './app.service';

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface CodingListItem {
  unit_key: string;
  unit_alias: string;
  login_name: string;
  login_code: string;
  booklet_id: string;
  variable_id: string;
  variable_page: string;
  variable_anchor: string;
  url: string;
}

interface ResponseEntity {
  id: number;
  unitId: number;
  variableId: string;
  status: string;
  value: string;
  subform: string;
  code: number;
  score: number;
  codedStatus: string;
  unit?: {
    name: string;
    alias: string;
    booklet?: {
      person?: {
        login: string;
        code: string;
      };
      bookletinfo?: {
        name: string;
      };
    };
  };
}

@Injectable({
  providedIn: 'root'
})
export class CodingService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);
  private appService = inject(AppService);

  get authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('id_token')}` };
  }

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
      { headers: this.authHeader, params })
      .pipe(
        catchError(() => of({ totalResponses: 0, statusCounts: {} }))
      );
  }

  getCodingJobStatus(workspace_id: number, jobId: string): Observable<{
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
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
      status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
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
      { headers: this.authHeader }
    )
      .pipe(
        catchError(error => {
          console.error('Error getting job status:', error);
          return of({
            status: 'failed' as const,
            progress: 0,
            error: 'Failed to get job status'
          });
        })
      );
  }

  cancelCodingJob(workspace_id: number, jobId: string): Observable<{
    success: boolean;
    message: string;
  }> {
    return this.http
      .get<{
      success: boolean;
      message: string;
    }>(
      `${this.serverUrl}admin/workspace/${workspace_id}/coding/job/${jobId}/cancel`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(error => {
          console.error('Error cancelling job:', error);
          return of({
            success: false,
            message: 'Failed to cancel job'
          });
        })
      );
  }

  getAllCodingJobs(workspace_id: number): Observable<{
    jobId: string;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
    progress: number;
    result?: {
      totalResponses: number;
      statusCounts: {
        [key: string]: number;
      };
    };
    error?: string;
    workspaceId?: number;
    createdAt?: Date;
  }[]> {
    return this.http
      .get<{
      jobId: string;
      status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
      progress: number;
      result?: {
        totalResponses: number;
        statusCounts: {
          [key: string]: number;
        };
      };
      error?: string;
      workspaceId?: number;
      createdAt?: Date;
    }[]>(
      `${this.serverUrl}admin/workspace/${workspace_id}/coding/jobs`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(error => {
          console.error('Error getting all jobs:', error);
          return of([]);
        })
      );
  }

  getCodingList(workspace_id: number, page: number = 1, limit: number = 100): Observable<PaginatedResponse<CodingListItem>> {
    const identity = this.appService.loggedUser?.sub || '';
    return this.appService.createToken(workspace_id, identity, 60).pipe(
      catchError(() => of('')),
      switchMap(token => {
        const params = new HttpParams()
          .set('page', page.toString())
          .set('limit', limit.toString())
          .set('identity', identity)
          .set('authToken', token)
          .set('serverUrl', window.location.origin);
        return this.http
          .get<PaginatedResponse<CodingListItem>>(
          `${this.serverUrl}admin/workspace/${workspace_id}/coding/coding-list`,
          { headers: this.authHeader, params }
        )
          .pipe(
            catchError(() => of({
              data: [],
              total: 0,
              page,
              limit
            }))
          );
      })
    );
  }

  getCodingListAsCsv(workspace_id: number): Observable<ArrayBuffer> {
    return this.http.get(
      `${this.serverUrl}admin/workspace/${workspace_id}/coding/coding-list/csv`,
      {
        headers: this.authHeader,
        responseType: 'arraybuffer'
      }
    );
  }

  getCodingListAsExcel(workspace_id: number): Observable<ArrayBuffer> {
    return this.http.get(
      `${this.serverUrl}admin/workspace/${workspace_id}/coding/coding-list/excel`,
      {
        headers: this.authHeader,
        responseType: 'arraybuffer'
      }
    );
  }

  getCodingStatistics(workspace_id: number): Observable<CodingStatistics> {
    return this.http
      .get<CodingStatistics>(
      `${this.serverUrl}admin/workspace/${workspace_id}/coding/statistics`,
      { headers: this.authHeader })
      .pipe(
        catchError(() => of({ totalResponses: 0, statusCounts: {} }))
      );
  }

  getResponsesByStatus(workspace_id: number, status: string, page: number = 1, limit: number = 100): Observable<PaginatedResponse<ResponseEntity>> {
    const params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString());

    return this.http
      .get<PaginatedResponse<ResponseEntity>>(
      `${this.serverUrl}admin/workspace/${workspace_id}/coding/responses/${status}`,
      { headers: this.authHeader, params }
    )
      .pipe(
        catchError(() => of({
          data: [],
          total: 0,
          page,
          limit
        }))
      );
  }
}
