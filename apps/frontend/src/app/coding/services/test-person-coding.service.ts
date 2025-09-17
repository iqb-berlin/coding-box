import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  Observable,
  catchError,
  of
} from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';
import { ExpectedCombinationDto } from '../../../../../../api-dto/coding/expected-combination.dto';
import {
  ValidateCodingCompletenessResponseDto
} from '../../../../../../api-dto/coding/validate-coding-completeness-response.dto';
import {
  ValidateCodingCompletenessRequestDto
} from '../../../../../../api-dto/coding/validate-coding-completeness-request.dto';

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
  groupNames?: string;
  durationMs?: number;
  completedAt?: Date;
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
   * Delete job
   * @param workspaceId Workspace ID
   * @param jobId Job ID
   */
  deleteJob(workspaceId: number, jobId: string): Observable<{ success: boolean; message: string }> {
    return this.http
      .get<{ success: boolean; message: string }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/job/${jobId}/delete`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({ success: false, message: `Failed to delete job ${jobId}` }))
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

  /**
   * Get all test person groups for a workspace
   * @param workspaceId Workspace ID
   * @returns Observable of an array of group names
   */
  getWorkspaceGroups(workspaceId: number): Observable<string[]> {
    return this.http
      .get<string[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/groups`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of([]))
      );
  }

  /**
   * Restart a failed job
   * @param workspaceId Workspace ID
   * @param jobId Job ID to restart
   * @returns Observable with restart result
   */
  restartJob(workspaceId: number, jobId: string): Observable<{ success: boolean; message: string; jobId?: string }> {
    return this.http
      .get<{ success: boolean; message: string; jobId?: string }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/job/${jobId}/restart`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({ success: false, message: `Failed to restart job ${jobId}` }))
      );
  }

  /**
   * Validate completeness of coding responses with pagination support
   * @param workspaceId Workspace ID
   * @param expectedCombinations Expected combinations from Excel
   * @param page Page number (1-based, optional - defaults to 1)
   * @param pageSize Number of items per page (optional - defaults to 50)
   * @returns Observable of validation results with pagination metadata
   */
  validateCodingCompleteness(
    workspaceId: number,
    expectedCombinations: ExpectedCombinationDto[],
    page?: number,
    pageSize?: number
  ): Observable<ValidateCodingCompletenessResponseDto> {
    const request: ValidateCodingCompletenessRequestDto = {
      expectedCombinations,
      page: page || 1,
      pageSize: pageSize || 50
    };

    return this.http
      .post<ValidateCodingCompletenessResponseDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/validate-completeness`,
      request,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({
          results: [],
          total: 0,
          missing: 0,
          currentPage: page || 1,
          pageSize: pageSize || 50,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false
        }))
      );
  }

  /**
   * Download validation results as Excel file using cache key
   * @param workspaceId Workspace ID
   * @param cacheKey Cache key from validation results
   * @returns Observable of Excel file as Blob
   */
  downloadValidationResultsAsExcel(
    workspaceId: number,
    cacheKey: string
  ): Observable<Blob> {
    const request = {
      cacheKey
    };

    return this.http
      .post(
        `${this.serverUrl}admin/workspace/${workspaceId}/coding/validate-completeness/export-excel`,
        request,
        {
          headers: this.authHeader,
          responseType: 'blob'
        }
      )
      .pipe(
        catchError(error => {
          throw error;
        })
      );
  }
}
