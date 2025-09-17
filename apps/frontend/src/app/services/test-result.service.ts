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
import { TestResultCacheService } from './test-result-cache.service';

@Injectable({
  providedIn: 'root'
})
export class TestResultService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);
  private cacheService = inject(TestResultCacheService);

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
    // Use the cache service to get test results
    return this.cacheService.getTestResults(workspaceId, page, limit, searchText);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getPersonTestResults(workspaceId: number, personId: number): Observable<any[]> {
    // Use the cache service to get person test results
    return this.cacheService.getPersonTestResults(workspaceId, personId);
  }

  /**
   * Invalidate the cache for a specific workspace
   * This should be called whenever test results are modified
   * @param workspaceId The workspace ID
   */
  invalidateCache(workspaceId: number): void {
    this.cacheService.invalidateWorkspaceCache(workspaceId);
  }

  searchBookletsByName(
    workspaceId: number,
    bookletName: string,
    page?: number,
    limit?: number
  ): Observable<{
      data: {
        bookletId: number;
        bookletName: string;
        personId: number;
        personLogin: string;
        personCode: string;
        personGroup: string;
        units: {
          unitId: number;
          unitName: string;
          unitAlias: string | null;
        }[];
      }[];
      total: number;
    }> {
    let params = new HttpParams().set('bookletName', bookletName);

    if (page !== undefined) {
      params = params.set('page', page.toString());
    }

    if (limit !== undefined) {
      params = params.set('limit', limit.toString());
    }

    return this.http.get<{
      data: {
        bookletId: number;
        bookletName: string;
        personId: number;
        personLogin: string;
        personCode: string;
        personGroup: string;
        units: {
          unitId: number;
          unitName: string;
          unitAlias: string | null;
        }[];
      }[];
      total: number;
    }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/booklets/search`,
      { headers: this.authHeader, params }
    ).pipe(
      catchError(() => {
        logger.error(`Error searching for booklets with name: ${bookletName}`);
        return of({ data: [], total: 0 });
      })
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

  /**
   * Delete a booklet and all its associated units and responses
   * @param workspaceId The ID of the workspace
   * @param bookletId The ID of the booklet to delete
   * @returns An Observable of the deletion result
   */
  deleteBooklet(workspaceId: number, bookletId: number): Observable<{
    success: boolean;
    report: {
      deletedBooklet: number | null;
      warnings: string[];
    };
  }> {
    return this.http.delete<{
      success: boolean;
      report: {
        deletedBooklet: number | null;
        warnings: string[];
      };
    }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/booklets/${bookletId}`,
      { headers: this.authHeader }
    ).pipe(
      catchError(() => {
        logger.error(`Error deleting booklet with ID: ${bookletId}`);
        return of({ success: false, report: { deletedBooklet: null, warnings: ['Failed to delete booklet'] } });
      })
    );
  }
}
