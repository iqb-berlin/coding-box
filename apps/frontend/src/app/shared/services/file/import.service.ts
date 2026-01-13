import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { catchError, Observable, of } from 'rxjs';
import { SERVER_URL } from '../../../injection-tokens';
import { TestGroupsInfoDto } from '../../../../../../../api-dto/files/test-groups-info.dto';
import { TestFilesUploadResultDto } from '../../../../../../../api-dto/files/test-files-upload-result.dto';

export type ImportOptions = {
  responses: string;
  definitions: string;
  units: string;
  player: string;
  codings: string;
  logs: string;
  testTakers: string;
  booklets: string;
};

export type Result = {
  success: boolean;
  testFiles: number;
  responses: number;
  logs: number;
  booklets: number;
  units: number;
  persons: number;
  importedGroups: string[];
  filesPlayer?: number;
  filesUnits?: number;
  filesDefinitions?: number;
  filesCodings?: number;
  filesBooklets?: number;
  filesTestTakers?: number;
  testFilesUploadResult?: TestFilesUploadResultDto;
};

@Injectable({
  providedIn: 'root'
})
export class ImportService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  importWorkspaceFiles(
    workspace_id: number,
    testCenterWorkspace: string,
    server: string,
    url: string,
    token: string,
    importOptions: ImportOptions,
    testGroups: string[],
    overwriteExistingLogs: boolean = false,
    overwriteFileIds?: string[]
  ): Observable<Result> {
    const {
      units,
      responses,
      definitions,
      player,
      codings,
      logs,
      testTakers,
      booklets
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
      .set('overwriteExistingLogs', String(overwriteExistingLogs))
      .set('overwriteFileIds', String((overwriteFileIds || []).join(';')));

    return this.http
      .get<Result>(
      `${this.serverUrl}admin/workspace/${workspace_id}/importWorkspaceFiles`,
      { params }
    )
      .pipe(
        catchError(() => of({
          success: false,
          testFiles: 0,
          responses: 0,
          logs: 0,
          booklets: 0,
          units: 0,
          persons: 0,
          importedGroups: [],
          filesPlayer: 0,
          filesUnits: 0,
          filesDefinitions: 0,
          filesCodings: 0,
          filesBooklets: 0,
          filesTestTakers: 0
        })
        )
      );
  }

  importTestcenterGroups(
    workspace_id: number,
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
      .get<TestGroupsInfoDto[]>(
      `${this.serverUrl}admin/workspace/${workspace_id}/importWorkspaceFiles/testGroups`,
      { params }
    )
      .pipe(catchError(() => of([])));
  }
}
