import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  catchError,
  map,
  Observable,
  of,
  forkJoin,
  tap
} from 'rxjs';
import { logger } from 'nx/src/utils/logger';
import { ResponseDto } from '../../../../../../../api-dto/responses/response-dto';
import { SERVER_URL } from '../../../injection-tokens';
import { TestResultService } from '../test-result/test-result.service';

@Injectable({
  providedIn: 'root'
})
export class ResponseService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);
  private testResultService = inject(TestResultService);

  get authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('id_token')}` };
  }

  getResponses(workspaceId: number, testPerson: string, unitId: string, authToken?: string): Observable<ResponseDto[]> {
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : this.authHeader;
    return this.http.get<ResponseDto[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/responses/${testPerson}/${unitId}`,
      { headers });
  }

  getResponsesForWorkspace(workspaceId: number): Observable<ResponseDto[]> {
    return this.http.get<ResponseDto[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/responses`,
      { headers: this.authHeader });
  }

  deleteTestPersons(workspace_id: number, testPersonIds: number[]): Observable<boolean> {
    const params = new HttpParams().set('testPersons', testPersonIds.join(','));
    return this.http
      .delete(
        `${this.serverUrl}admin/workspace/${workspace_id}/test-results`,
        { headers: this.authHeader, params })
      .pipe(
        catchError(() => of(false)),
        map(() => true),
        tap(success => {
          // Invalidate cache if deletion was successful
          if (success) {
            this.testResultService.invalidateCache(workspace_id);
          }
        })
      );
  }

  /**
   * Delete a response
   * @param workspaceId The ID of the workspace
   * @param responseId The ID of the response to delete
   * @returns An Observable of the deletion result
   */
  deleteResponse(workspaceId: number, responseId: number): Observable<{
    success: boolean;
    report: {
      deletedResponse: number | null;
      warnings: string[];
    };
  }> {
    return this.http.delete<{
      success: boolean;
      report: {
        deletedResponse: number | null;
        warnings: string[];
      };
    }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/responses/${responseId}`,
      { headers: this.authHeader }
    ).pipe(
      catchError(() => {
        logger.error(`Error deleting response with ID: ${responseId}`);
        return of({ success: false, report: { deletedResponse: null, warnings: ['Failed to delete response'] } });
      }),
      tap(result => {
        // Invalidate cache if deletion was successful
        if (result.success) {
          this.testResultService.invalidateCache(workspaceId);
        }
      })
    );
  }

  /**
   * Delete multiple responses
   * @param workspaceId The ID of the workspace
   * @param responseIds Array of response IDs to delete
   * @returns An Observable of the deletion result
   */
  deleteMultipleResponses(workspaceId: number, responseIds: number[]): Observable<{
    success: boolean;
    report: {
      deletedResponses: number[];
      warnings: string[];
    };
  }> {
    // Create a series of delete requests for each response
    const deleteRequests = responseIds.map(responseId => this.deleteResponse(workspaceId, responseId));

    // Combine all requests and aggregate the results
    return forkJoin(deleteRequests).pipe(
      map(results => {
        const successfulDeletes = results.filter(result => result.success);
        const deletedResponses = successfulDeletes
          .map(result => result.report.deletedResponse)
          .filter(id => id !== null) as number[];

        const warnings = results
          .filter(result => !result.success || result.report.warnings.length > 0)
          .flatMap(result => result.report.warnings);

        return {
          success: deletedResponses.length > 0,
          report: {
            deletedResponses,
            warnings
          }
        };
      }),
      catchError(() => {
        logger.error('Error deleting multiple responses');
        return of({
          success: false,
          report: {
            deletedResponses: [],
            warnings: ['Failed to delete responses']
          }
        });
      }),
      tap(result => {
        // Invalidate cache if any responses were deleted successfully
        if (result.success) {
          this.testResultService.invalidateCache(workspaceId);
        }
      })
    );
  }

  searchResponses(
    workspaceId: number,
    searchParams: { value?: string; variableId?: string; unitName?: string; bookletName?: string; status?: string; codedStatus?: string; group?: string; code?: string; version?: 'v1' | 'v2' | 'v3' },
    page?: number,
    limit?: number
  ): Observable<{
      data: {
        responseId: number;
        variableId: string;
        value: string;
        status: string;
        code?: number;
        score?: number;
        codedStatus?: string;
        unitId: number;
        unitName: string;
        unitAlias: string | null;
        bookletId: number;
        bookletName: string;
        personId: number;
        personLogin: string;
        personCode: string;
        personGroup: string;
        variablePage?: string;
      }[];
      total: number;
    }> {
    let params = new HttpParams();

    if (searchParams.value) {
      params = params.set('value', searchParams.value);
    }

    if (searchParams.variableId) {
      params = params.set('variableId', searchParams.variableId);
    }

    if (searchParams.unitName) {
      params = params.set('unitName', searchParams.unitName);
    }

    if (searchParams.bookletName) {
      params = params.set('bookletName', searchParams.bookletName);
    }

    if (searchParams.status) {
      params = params.set('status', searchParams.status);
    }

    if (searchParams.codedStatus) {
      params = params.set('codedStatus', searchParams.codedStatus);
    }

    if (searchParams.group) {
      params = params.set('group', searchParams.group);
    }

    if (searchParams.code) {
      params = params.set('code', searchParams.code);
    }

    if (searchParams.version) {
      params = params.set('version', searchParams.version);
    }

    if (page !== undefined) {
      params = params.set('page', page.toString());
    }

    if (limit !== undefined) {
      params = params.set('limit', limit.toString());
    }

    return this.http.get<{
      data: {
        responseId: number;
        variableId: string;
        value: string;
        status: string;
        code?: number;
        score?: number;
        codedStatus?: string;
        unitId: number;
        unitName: string;
        unitAlias: string | null;
        bookletId: number;
        bookletName: string;
        personId: number;
        personLogin: string;
        personCode: string;
        personGroup: string;
      }[];
      total: number;
    }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/responses/search`,
      { headers: this.authHeader, params }
    ).pipe(
      catchError(() => {
        logger.error(`Error searching for responses with params: ${JSON.stringify(searchParams)}`);
        return of({ data: [], total: 0 });
      })
    );
  }

  deleteInvalidResponses(workspaceId: number, responseIds: number[]): Observable<number> {
    const params = new HttpParams().set('responseIds', responseIds.join(','));
    return this.http.delete<number>(
      `${this.serverUrl}admin/workspace/${workspaceId}/files/invalid-responses`,
      { headers: this.authHeader, params }
    ).pipe(
      catchError(() => of(0))
    );
  }
}
