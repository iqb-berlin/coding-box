import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  Observable, catchError, of, switchMap
} from 'rxjs';
import { CodingStatistics } from '../../../../../../api-dto/coding/coding-statistics';
import { SERVER_URL } from '../../injection-tokens';
import { AppService } from '../../core/services/app.service';
import { suppressGlobalHttpErrorContext } from '../../core/interceptors/http-error-context';
import { VariableAnalysisItemDto } from '../../../../../../api-dto/coding/variable-analysis-item.dto';
import { ResponseEntity } from '../../shared/models/response-entity.model';
import { CodingFreshnessSummaryDto } from '../../../../../../api-dto/coding/coding-freshness.dto';
import {
  CodingResponseSortBy,
  CodingResponseSortDirection
} from '../../models/coding-interfaces';

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

@Injectable({
  providedIn: 'root'
})
export class CodingStatisticsService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);
  private appService = inject(AppService);

  getCodingStatistics(workspace_id: number, version: 'v1' | 'v2' | 'v3' = 'v1'): Observable<CodingStatistics> {
    const params = new HttpParams().set('version', version);
    return this.http
      .get<CodingStatistics>(
      `${this.serverUrl}admin/workspace/${workspace_id}/coding/statistics`,
      {
        params,
        context: suppressGlobalHttpErrorContext()
      })
      .pipe(
        catchError(() => of({ totalResponses: 0, statusCounts: {} }))
      );
  }

  getCodingFreshness(workspace_id: number): Observable<CodingFreshnessSummaryDto> {
    return this.http
      .get<CodingFreshnessSummaryDto>(
      `${this.serverUrl}admin/workspace/${workspace_id}/coding/freshness`,
      { context: suppressGlobalHttpErrorContext() }
    )
      .pipe(
        catchError(() => of({
          workspaceId: workspace_id,
          currentRevision: 0,
          items: []
        }))
      );
  }

  getResponsesByStatus(
    workspace_id: number,
    status: string,
    version: 'v1' | 'v2' | 'v3' = 'v1',
    page: number = 1,
    limit: number = 100,
    sortBy?: CodingResponseSortBy,
    sortDirection?: CodingResponseSortDirection
  ): Observable<PaginatedResponse<ResponseEntity>> {
    let params = new HttpParams()
      .set('version', version)
      .set('page', page.toString())
      .set('limit', limit.toString());

    if (sortBy) {
      params = params.set('sortBy', sortBy);
    }

    if (sortDirection) {
      params = params.set('sortDirection', sortDirection);
    }

    return this.http
      .get<PaginatedResponse<ResponseEntity>>(
      `${this.serverUrl}admin/workspace/${workspace_id}/coding/responses/${status}`,
      { params }
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

  getReplayUrl(workspaceId: number, responseId: number): Observable<{ replayUrl: string }> {
    return this.http
      .get<{ replayUrl: string }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/responses/${responseId}/replay-url`,
      {
        context: suppressGlobalHttpErrorContext()
      }
    )
      .pipe(
        catchError(() => of({ replayUrl: '' }))
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
    return this.appService.createOwnToken(workspace_id, 60).pipe(
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
          { params }
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
