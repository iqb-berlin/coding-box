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
import { CodeBookContentSetting } from '../../../../../api-dto/coding/codebook-content-setting';
import { MissingsProfilesDto } from '../../../../../api-dto/coding/missings-profiles.dto';
import { VariableAnalysisItemDto } from '../../../../../api-dto/coding/variable-analysis-item.dto';
import { ResponseEntity } from '../shared/models/response-entity.model';

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
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({
          status: 'failed' as const,
          progress: 0,
          error: 'Failed to get job status'
        }))
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
        catchError(() => of({
          success: false,
          message: 'Failed to cancel job'
        }))
      );
  }

  getAllCodingJobs(workspace_id: number): Observable<{
    jobId: string;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused';
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
      status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused';
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
        catchError(() => of([]))
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

  createCodingStatisticsJob(workspace_id: number): Observable<{ jobId: string; message: string }> {
    return this.http
      .post<{ jobId: string; message: string }>(
      `${this.serverUrl}admin/workspace/${workspace_id}/coding/statistics/job`,
      {},
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({ jobId: '', message: 'Failed to create job' }))
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

  getMissingsProfiles(workspaceId: number): Observable<{ label: string }[]> {
    return this.http
      .get<{ label: string }[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/missings-profiles`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of([]))
      );
  }

  getMissingsProfileDetails(workspaceId: number, label: string): Observable<MissingsProfilesDto | null> {
    return this.http
      .get<MissingsProfilesDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/missings-profiles/${encodeURIComponent(label)}`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of(null))
      );
  }

  createMissingsProfile(workspaceId: number, profile: MissingsProfilesDto): Observable<MissingsProfilesDto | null> {
    return this.http
      .post<MissingsProfilesDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/missings-profiles`,
      profile,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of(null))
      );
  }

  updateMissingsProfile(workspaceId: number, label: string, profile: MissingsProfilesDto): Observable<MissingsProfilesDto | null> {
    return this.http
      .put<MissingsProfilesDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/missings-profiles/${encodeURIComponent(label)}`,
      profile,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of(null))
      );
  }

  deleteMissingsProfile(workspaceId: number, label: string): Observable<boolean> {
    return this.http
      .delete<boolean>(
      `${this.serverUrl}admin/workspace/${workspaceId}/missings-profiles/${encodeURIComponent(label)}`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of(false))
      );
  }

  getCodingBook(
    workspaceId: number,
    missingsProfile: string,
    contentOptions: CodeBookContentSetting,
    unitList: number[]
  ): Observable<Blob | null> {
    // Ensure unitList is an array of numbers
    const payload = {
      missingsProfile,
      contentOptions,
      unitList: Array.isArray(unitList) ? unitList : [unitList]
    };

    return this.http
      .post(
        `${this.serverUrl}admin/workspace/${workspaceId}/coding/codebook`,
        payload,
        {
          headers: this.authHeader,
          responseType: 'blob'
        }
      )
      .pipe(
        catchError(() => of(null))
      );
  }

  getVariableAnalysis(
    workspace_id: number,
    page: number = 1,
    limit: number = 100,
    unitId?: string,
    variableId?: string,
    derivation?: string
  ): Observable<PaginatedResponse<VariableAnalysisItemDto>> {
    const identity = this.appService.loggedUser?.sub || '';
    return this.appService.createToken(workspace_id, identity, 60).pipe(
      catchError(() => of('')),
      switchMap(token => {
        let params = new HttpParams()
          .set('authToken', token)
          .set('serverUrl', window.location.origin)
          .set('page', page.toString())
          .set('limit', limit.toString());

        if (unitId) {
          params = params.set('unitId', unitId);
        }

        if (variableId) {
          params = params.set('variableId', variableId);
        }

        if (derivation) {
          params = params.set('derivation', derivation);
        }

        return this.http
          .get<PaginatedResponse<VariableAnalysisItemDto>>(
          `${this.serverUrl}admin/workspace/${workspace_id}/coding/variable-analysis`,
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
}
