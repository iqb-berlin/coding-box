import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of } from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';

@Injectable({
  providedIn: 'root'
})
export class CodingVersionService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  resetCodingVersion(
    workspaceId: number,
    version: 'v1' | 'v2' | 'v3',
    unitFilters?: string[],
    variableFilters?: string[]
  ): Observable<{
      affectedResponseCount: number;
      cascadeResetVersions: ('v2' | 'v3')[];
      message: string;
    }> {
    return this.http
      .post<{
      affectedResponseCount: number;
      cascadeResetVersions: ('v2' | 'v3')[];
      message: string;
    }>(
        `${this.serverUrl}admin/workspace/${workspaceId}/coding/reset-version`,
        {
          version,
          unitFilters: unitFilters || [],
          variableFilters: variableFilters || []
        },
        {}
        )
      .pipe(
        catchError(() => of({
          affectedResponseCount: 0,
          cascadeResetVersions: [],
          message: 'Failed to reset coding version'
        }))
      );
  }
}
