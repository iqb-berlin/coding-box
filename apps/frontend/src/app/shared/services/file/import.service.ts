import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { catchError, Observable, of } from 'rxjs';
import { SERVER_URL } from '../../../injection-tokens';
import { TestGroupsInfoDto } from '../../../../../../../api-dto/files/test-groups-info.dto';
import { ImportOptionsDto as ImportOptions, ImportResultDto as Result } from '../../../../../../../api-dto/files/import-options.dto';
import { ImportWorkspaceFilesProgressDto } from '../../../../../../../api-dto/files/import-workspace-progress.dto';
import { TestGroupsLoadProgressDto } from '../../../../../../../api-dto/files/test-groups-load-progress.dto';

export { ImportOptions, Result };

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
    overwriteFileIds?: string[],
    importRunId?: string
  ): Observable<Result> {
    const {
      units,
      responses,
      definitions,
      player,
      codings,
      metadata,
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
      .set('metadata', String(metadata))
      .set('testGroups', String(testGroups.join(',')))
      .set('overwriteExistingLogs', String(overwriteExistingLogs))
      .set('overwriteFileIds', String((overwriteFileIds || []).join(';')))
      .set('importRunId', String(importRunId || ''));

    return this.http
      .get<Result>(
      `${this.serverUrl}admin/workspace/${workspace_id}/importWorkspaceFiles`,
      { params }
    );
  }

  getImportWorkspaceFilesProgress(
    workspace_id: number,
    importRunId: string
  ): Observable<ImportWorkspaceFilesProgressDto | null> {
    const params = new HttpParams().set('importRunId', importRunId);
    return this.http
      .get<ImportWorkspaceFilesProgressDto>(
      `${this.serverUrl}admin/workspace/${workspace_id}/importWorkspaceFiles/progress`,
      { params }
    )
      .pipe(catchError(() => of(null)));
  }

  importTestcenterGroups(
    workspace_id: number,
    testCenterWorkspace: string,
    server: string,
    url: string,
    authToken: string,
    importRunId?: string
  ): Observable<TestGroupsInfoDto[]> {
    let params = new HttpParams()
      .set('tc_workspace', testCenterWorkspace)
      .set('server', server)
      .set('url', encodeURIComponent(url))
      .set('token', authToken);

    if (importRunId) {
      params = params.set('importRunId', importRunId);
    }

    return this.http
      .get<TestGroupsInfoDto[]>(
      `${this.serverUrl}admin/workspace/${workspace_id}/importWorkspaceFiles/testGroups`,
      { params }
    );
  }

  getTestGroupsLoadProgress(
    workspace_id: number,
    importRunId: string
  ): Observable<TestGroupsLoadProgressDto | null> {
    const params = new HttpParams().set('importRunId', importRunId);
    return this.http
      .get<TestGroupsLoadProgressDto>(
      `${this.serverUrl}admin/workspace/${workspace_id}/importWorkspaceFiles/testGroups/progress`,
      { params }
    )
      .pipe(catchError(() => of(null)));
  }
}
