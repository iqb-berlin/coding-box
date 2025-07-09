import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  Observable,
  catchError,
  of
} from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';

export interface CodingStatistics {
  totalResponses: number;
  statusCounts: {
    [key: string]: number;
  };
}

export interface CodingStatisticsWithJob extends CodingStatistics {
  jobId?: string;
  message?: string;
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

export interface PaginatedCodingList {
  data: CodingListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface JobStatus {
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused';
  progress: number;
  result?: CodingStatistics;
  error?: string;
  workspaceId?: number;
  createdAt?: Date;
  testPersonId?: string;
}

export interface JobInfo extends JobStatus {
  jobId: string;
}

@Injectable({
  providedIn: 'root'
})
export class TestPersonCodingService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  get authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('id_token')}` };
  }

  /**
   * Code test persons
   * @param workspaceId Workspace ID
   * @param testPersonIds Comma-separated list of test person IDs
   */
  codeTestPersons(workspaceId: number, testPersonIds: string): Observable<CodingStatisticsWithJob> {
    return this.http
      .get<CodingStatisticsWithJob>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding?testPersons=${testPersonIds}`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({ totalResponses: 0, statusCounts: {} }))
      );
  }

  /**
   * Get manual test persons
   * @param workspaceId Workspace ID
   * @param testPersonIds Optional comma-separated list of test person IDs
   */
  getManualTestPersons(workspaceId: number, testPersonIds?: string): Observable<unknown> {
    let url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/manual`;
    if (testPersonIds) {
      url += `?testPersons=${testPersonIds}`;
    }

    return this.http
      .get<unknown>(url, { headers: this.authHeader })
      .pipe(
        catchError(() => of([]))
      );
  }

  /**
   * Get coding list
   * @param workspaceId Workspace ID
   * @param authToken Authentication token
   * @param serverUrl Server URL
   * @param page Page number
   * @param limit Items per page
   */
  getCodingList(
    workspaceId: number,
    authToken: string,
    serverUrl?: string,
    page = 1,
    limit = 20
  ): Observable<PaginatedCodingList> {
    let params = new HttpParams()
      .set('authToken', authToken)
      .set('page', page.toString())
      .set('limit', limit.toString());

    if (serverUrl) {
      params = params.set('serverUrl', serverUrl);
    }

    return this.http
      .get<PaginatedCodingList>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/coding-list`,
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

  /**
   * Get coding statistics
   * @param workspaceId Workspace ID
   */
  getCodingStatistics(workspaceId: number): Observable<CodingStatistics> {
    return this.http
      .get<CodingStatistics>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/statistics`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({ totalResponses: 0, statusCounts: {} }))
      );
  }

  /**
   * Get job status
   * @param workspaceId Workspace ID
   * @param jobId Job ID
   */
  getJobStatus(workspaceId: number, jobId: string): Observable<JobStatus | { error: string }> {
    return this.http
      .get<JobStatus | { error: string }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/job/${jobId}`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({ error: `Failed to get status for job ${jobId}` }))
      );
  }

  /**
   * Cancel job
   * @param workspaceId Workspace ID
   * @param jobId Job ID
   */
  cancelJob(workspaceId: number, jobId: string): Observable<{ success: boolean; message: string }> {
    return this.http
      .get<{ success: boolean; message: string }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/job/${jobId}/cancel`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({ success: false, message: `Failed to cancel job ${jobId}` }))
      );
  }

  /**
   * Pause job
   * @param workspaceId Workspace ID
   * @param jobId Job ID
   */
  pauseJob(workspaceId: number, jobId: string): Observable<{ success: boolean; message: string }> {
    return this.http
      .get<{ success: boolean; message: string }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/job/${jobId}/pause`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({ success: false, message: `Failed to pause job ${jobId}` }))
      );
  }

  /**
   * Resume job
   * @param workspaceId Workspace ID
   * @param jobId Job ID
   */
  resumeJob(workspaceId: number, jobId: string): Observable<{ success: boolean; message: string }> {
    return this.http
      .get<{ success: boolean; message: string }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/job/${jobId}/resume`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({ success: false, message: `Failed to resume job ${jobId}` }))
      );
  }

  /**
   * Export coding list as CSV
   * @param workspaceId Workspace ID
   */
  exportCodingListAsCsv(workspaceId: number): Observable<Blob> {
    return this.http
      .get(
        `${this.serverUrl}admin/workspace/${workspaceId}/coding/coding-list/csv`,
        {
          headers: this.authHeader,
          responseType: 'blob'
        }
      )
      .pipe(
        catchError(() => of(new Blob(['No data available'], { type: 'text/csv' })))
      );
  }

  /**
   * Export coding list as Excel
   * @param workspaceId Workspace ID
   */
  exportCodingListAsExcel(workspaceId: number): Observable<Blob> {
    return this.http
      .get(
        `${this.serverUrl}admin/workspace/${workspaceId}/coding/coding-list/excel`,
        {
          headers: this.authHeader,
          responseType: 'blob'
        }
      )
      .pipe(
        catchError(() => of(new Blob(['No data available'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })))
      );
  }

  /**
   * Get all jobs for a workspace
   * @param workspaceId Workspace ID
   * @returns Observable of an array of job information
   */
  getAllJobs(workspaceId: number): Observable<JobInfo[]> {
    return this.http
      .get<JobInfo[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/jobs`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of([]))
      );
  }
}
