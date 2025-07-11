import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  catchError,
  forkJoin,
  map,
  Observable,
  of
} from 'rxjs';
import { logger } from 'nx/src/utils/logger';
import { SERVER_URL } from '../injection-tokens';

@Injectable({
  providedIn: 'root'
})
export class TestResultService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  get authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('id_token')}` };
  }

  getTestPersons(workspaceId: number): Observable<number[]> {
    return this.http.get<number[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-groups`,
      { headers: this.authHeader });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getTestResults(workspaceId: number, page: number, limit: number, searchText?: string): Observable<any> {
    const params: { [key: string]: string } = {
      page: page.toString(),
      limit: limit.toString()
    };

    if (searchText && searchText.trim() !== '') {
      params.searchText = searchText.trim();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.http.get<any>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-results/`,
      {
        headers: this.authHeader,
        params: params
      }
    ).pipe(
      catchError(() => {
        logger.error('Error fetching test data');
        return of({ results: [], total: 0 });
      }),
      map(result => result || { results: [], total: 0 })
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getPersonTestResults(workspaceId: number, personId: number): Observable<any[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.http.get<any[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-results/${personId}`,
      { headers: this.authHeader }
    );
  }

  searchUnitsByName(
    workspaceId: number,
    unitName: string,
    page?: number,
    limit?: number
  ): Observable<{
      data: {
        unitId: number;
        unitName: string;
        unitAlias: string | null;
        bookletId: number;
        bookletName: string;
        personId: number;
        personLogin: string;
        personCode: string;
        personGroup: string;
        tags: { id: number; unitId: number; tag: string; color?: string; createdAt: Date }[];
        responses: { variableId: string; value: string; status: string; code?: number; score?: number; codedStatus?: string }[];
      }[];
      total: number;
    }> {
    let params = new HttpParams().set('unitName', unitName);

    if (page !== undefined) {
      params = params.set('page', page.toString());
    }

    if (limit !== undefined) {
      params = params.set('limit', limit.toString());
    }

    return this.http.get<{
      data: {
        unitId: number;
        unitName: string;
        unitAlias: string | null;
        bookletId: number;
        bookletName: string;
        personId: number;
        personLogin: string;
        personCode: string;
        personGroup: string;
        tags: { id: number; unitId: number; tag: string; color?: string; createdAt: Date }[];
        responses: { variableId: string; value: string; status: string; code?: number; score?: number; codedStatus?: string }[];
      }[];
      total: number;
    }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/units/search`,
      { headers: this.authHeader, params }
    ).pipe(
      catchError(() => {
        logger.error(`Error searching for units with name: ${unitName}`);
        return of({ data: [], total: 0 });
      })
    );
  }

  /**
   * Delete a unit and all its associated responses
   * @param workspaceId The ID of the workspace
   * @param unitId The ID of the unit to delete
   * @returns An Observable of the deletion result
   */
  deleteUnit(workspaceId: number, unitId: number): Observable<{
    success: boolean;
    report: {
      deletedUnit: number | null;
      warnings: string[];
    };
  }> {
    return this.http.delete<{
      success: boolean;
      report: {
        deletedUnit: number | null;
        warnings: string[];
      };
    }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/units/${unitId}`,
      { headers: this.authHeader }
    ).pipe(
      catchError(() => {
        logger.error(`Error deleting unit with ID: ${unitId}`);
        return of({ success: false, report: { deletedUnit: null, warnings: ['Failed to delete unit'] } });
      })
    );
  }

  /**
   * Delete multiple units and all their associated responses
   * @param workspaceId The ID of the workspace
   * @param unitIds Array of unit IDs to delete
   * @returns An Observable of the deletion result
   */
  deleteMultipleUnits(workspaceId: number, unitIds: number[]): Observable<{
    success: boolean;
    report: {
      deletedUnits: number[];
      warnings: string[];
    };
  }> {
    // Create a series of delete requests for each unit
    const deleteRequests = unitIds.map(unitId => this.deleteUnit(workspaceId, unitId));

    // Combine all requests and aggregate the results
    return forkJoin(deleteRequests).pipe(
      map(results => {
        const successfulDeletes = results.filter(result => result.success);
        const deletedUnits = successfulDeletes
          .map(result => result.report.deletedUnit)
          .filter(id => id !== null) as number[];

        const warnings = results
          .filter(result => !result.success || result.report.warnings.length > 0)
          .flatMap(result => result.report.warnings);

        return {
          success: deletedUnits.length > 0,
          report: {
            deletedUnits,
            warnings
          }
        };
      }),
      catchError(() => {
        logger.error('Error deleting multiple units');
        return of({
          success: false,
          report: {
            deletedUnits: [],
            warnings: ['Failed to delete units']
          }
        });
      })
    );
  }
}
