import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  catchError,
  Observable,
  of
} from 'rxjs';
import { SERVER_URL } from '../injection-tokens';
// eslint-disable-next-line import/no-cycle
import {
  ImportOptions,
  Result
} from '../ws-admin/components/test-center-import/test-center-import.component';
import { TestGroupsInfoDto } from '../../../../../api-dto/files/test-groups-info.dto';

@Injectable({
  providedIn: 'root'
})
export class ImportService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  get authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('id_token')}` };
  }

  importWorkspaceFiles(workspace_id: number,
                       testCenterWorkspace: string,
                       server: string,
                       url: string,
                       token: string,
                       importOptions: ImportOptions,
                       testGroups: string[],
                       overwriteExistingLogs: boolean = false
  ): Observable<Result> {
    const {
      units, responses, definitions, player, codings, logs, testTakers, booklets
    } = importOptions;

    const params = new HttpParams()
      .set('tc_workspace', testCenterWorkspace)
      .set('server', server)
      .set('url', encodeURIComponent(url))
      .set('responses', String(responses))
      .set('logs', String(logs))
      .set('definitions', String(definitions))
      .set('units', String(units))
      .set('codings', String(codings))
      .set('player', String(player))
      .set('token', token)
      .set('testTakers', String(testTakers))
      .set('booklets', String(booklets))
      .set('testGroups', String(testGroups.join(',')))
      .set('overwriteExistingLogs', String(overwriteExistingLogs));

    return this.http
      .get<Result>(`${this.serverUrl}admin/workspace/${workspace_id}/importWorkspaceFiles`, { headers: this.authHeader, params })
      .pipe(
        catchError(() => of({
          success: false,
          testFiles: 0,
          responses: 0,
          logs: 0,
          booklets: 0,
          units: 0,
          persons: 0,
          importedGroups: []
        }))
      );
  }

  importTestcenterGroups(workspace_id: number,
                         testCenterWorkspace: string,
                         server: string,
                         url: string,
                         authToken: string
  ): Observable<TestGroupsInfoDto[]> {
    const params = new HttpParams()
      .set('tc_workspace', testCenterWorkspace)
      .set('server', server)
      .set('url', encodeURIComponent(url))
      .set('token', authToken);

    return this.http
      .get<TestGroupsInfoDto[]>(`${this.serverUrl}admin/workspace/${workspace_id}/importWorkspaceFiles/testGroups`, { headers: this.authHeader, params })
      .pipe(
        catchError(() => of([]))
      );
  }
}
