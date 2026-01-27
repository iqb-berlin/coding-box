import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  Observable, catchError, of, switchMap
} from 'rxjs';
import { CodingStatistics } from '../../../../../../api-dto/coding/coding-statistics';
import { SERVER_URL } from '../../injection-tokens';
import { AppService } from '../../core/services/app.service';
import { VariableAnalysisItemDto } from '../../../../../../api-dto/coding/variable-analysis-item.dto';
import { ResponseEntity } from '../../shared/models/response-entity.model';

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
      { params })
      .pipe(
        catchError(() => of({ totalResponses: 0, statusCounts: {} }))
      );
  }

  getResponsesByStatus(workspace_id: number, status: string, version: 'v1' | 'v2' | 'v3' = 'v1', page: number = 1, limit: number = 100): Observable<PaginatedResponse<ResponseEntity>> {
    const params = new HttpParams()
      .set('version', version)
      .set('page', page.toString())
      .set('limit', limit.toString());

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

  getReplayUrl(workspaceId: number, responseId: number, authToken: string): Observable<{ replayUrl: string }> {
    const params = new HttpParams().set('authToken', authToken);

    return this.http
      .get<{ replayUrl: string }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/responses/${responseId}/replay-url`,
      { params }
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
