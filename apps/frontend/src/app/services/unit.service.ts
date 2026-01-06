import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  catchError,
  forkJoin,
  map,
  Observable,
  of
} from 'rxjs';
import { SERVER_URL } from '../injection-tokens';

@Injectable({
  providedIn: 'root'
})
export class UnitService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

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
      {}
    ).pipe(
      catchError(() => of({ success: false, report: { deletedUnit: null, warnings: ['Failed to delete unit'] } }))
    );
  }

  deleteMultipleUnits(workspaceId: number, unitIds: number[]): Observable<{
    success: boolean;
    report: {
      deletedUnits: number[];
      warnings: string[];
    };
  }> {
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
      catchError(() => of({
        success: false,
        report: {
          deletedUnits: [],
          warnings: ['Failed to delete units']
        }
      }))
    );
  }
}
