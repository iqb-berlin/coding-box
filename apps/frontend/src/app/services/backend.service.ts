import { Injectable, Inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  catchError, map, Observable, of, switchMap
} from 'rxjs';
import { logger } from 'nx/src/utils/logger';
import { CreateUserDto } from '../../../../../api-dto/user/create-user-dto';
import { AppService } from './app.service';
import { UserFullDto } from '../../../../../api-dto/user/user-full-dto';
import { WorkspaceFullDto } from '../../../../../api-dto/workspaces/workspace-full-dto';
import { WorkspaceInListDto } from '../../../../../api-dto/workspaces/workspace-in-list-dto';
import { CreateWorkspaceDto } from '../../../../../api-dto/workspaces/create-workspace-dto';
import { AuthDataDto } from '../../../../../api-dto/auth-data-dto';
// eslint-disable-next-line import/no-cycle
import {
  ImportOptions,
  Result,
  ServerResponse
} from '../ws-admin/components/test-center-import/test-center-import.component';
import { TestGroupsInListDto } from '../../../../../api-dto/test-groups/testgroups-in-list.dto';
import { FilesInListDto } from '../../../../../api-dto/files/files-in-list.dto';
import { ResponseDto } from '../../../../../api-dto/responses/response-dto';
import { FilesDto } from '../../../../../api-dto/files/files.dto';
import { UserInListDto } from '../../../../../api-dto/user/user-in-list-dto';
import { UserWorkspaceAccessDto } from '../../../../../api-dto/workspaces/user-workspace-access-dto';
import { FilesValidationDto } from '../../../../../api-dto/files/files-validation.dto';
import { FileDownloadDto } from '../../../../../api-dto/files/file-download.dto';
import { TestGroupsInfoDto } from '../../../../../api-dto/files/test-groups-info.dto';

@Injectable({
  providedIn: 'root'
})
export class BackendService {
  constructor(
    @Inject('SERVER_URL') private readonly serverUrl: string,
    private http: HttpClient, public appService: AppService
  ) {
  }

  authHeader = { Authorization: `Bearer ${localStorage.getItem('id_token')}` };

  getDirectDownloadLink(): string {
    return `${this.serverUrl}packages/`;
  }

  createToken(workspace_id:number, identity:string, duration: number): Observable<string> {
    return this.http.get<string>(
      `${this.serverUrl}admin/workspace/${workspace_id}/${identity}/token/${duration}`,
      { headers: this.authHeader }
    );
  }

  keycloakLogin(user: CreateUserDto): Observable<boolean> {
    return this.http.post<string>(`${this.serverUrl}keycloak-login`, user)
      .pipe(
        catchError(() => of(false)),
        switchMap(loginToken => {
          if (typeof loginToken === 'string') {
            localStorage.setItem('id_token', loginToken);
            return this.getAuthData(user.identity || '')
              .pipe(
                map(authData => {
                  this.appService.updateAuthData(authData);
                  return true;
                }),
                catchError(() => of(false))
              );
          }
          return of(loginToken);
        })
      );
  }

  getUsers(workspaceId:number): Observable<UserInListDto[]> {
    return this.http
      .get<UserInListDto[]>(`${this.serverUrl}admin/users/access/${workspaceId}`, { headers: this.authHeader });
  }

  saveUsers(workspaceId:number, users:UserWorkspaceAccessDto[]): Observable<UserWorkspaceAccessDto[]> {
    return this.http
      .patch<UserWorkspaceAccessDto[]>(`${this.serverUrl}admin/users/access/${workspaceId}`,
      users,
      { headers: this.authHeader });
  }

  getAuthData(id:string): Observable<AuthDataDto> {
    return this.http.get<AuthDataDto>(
      `${this.serverUrl}auth-data?identity=${id}`,
      { headers: this.authHeader });
  }

  getUsersFull(): Observable<UserFullDto[]> {
    return this.http
      .get<UserFullDto[]>(
      `${this.serverUrl}admin/users/full`,
      { headers: this.authHeader })
      .pipe(
        catchError(() => of([]))
      );
  }

  addUser(newUser: CreateUserDto): Observable<boolean> {
    return this.http
      .post(
        `${this.serverUrl}admin/users`,
        newUser,
        { headers: this.authHeader }
      )
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  changeUserData(userId:number, newData: UserFullDto): Observable<boolean> {
    return this.http
      .patch(
        `${this.serverUrl}admin/users/${userId}`,
        newData,
        { headers: this.authHeader })
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  deleteUsers(users: number[]): Observable<boolean> {
    return this.http
      .delete(`${this.serverUrl}admin/users/${users.join(';')}`,
        { headers: this.authHeader })
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  getAllWorkspacesList(): Observable<WorkspaceInListDto[]> {
    return this.http
      .get<WorkspaceInListDto[]>(`${this.serverUrl}admin/workspace`,
      { headers: this.authHeader })
      .pipe(
        catchError(() => of([]))
      );
  }

  getWorkspacesByUserList(userId:number): Observable<number[]> {
    return this.http
      .get<number[]>(`${this.serverUrl}admin/users/${userId}/workspaces`,
      { headers: this.authHeader })
      .pipe(
        catchError(() => of([]))
      );
  }

  getWorkspaceUsers(workspaceId:number): Observable<{ userId:number, workspaceId:number }[]> {
    return this.http
      .get<{ userId:number, workspaceId:number }[]>(`${this.serverUrl}admin/workspace/${workspaceId}/users`,
      { headers: this.authHeader })
      .pipe(
        catchError(() => of([]))
      );
  }

  addWorkspace(workspaceData: CreateWorkspaceDto): Observable<boolean> {
    return this.http
      .post<boolean>(`${this.serverUrl}admin/workspace`, workspaceData, { headers: this.authHeader })
      .pipe(
        catchError(() => of(false))
      );
  }

  // Todo: Use queryParams for ids
  deleteWorkspace(ids: number[]): Observable<boolean> {
    return this.http
      .delete(`${this.serverUrl}admin/workspace/${ids.join(';')}`,
        { headers: this.authHeader })
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  deleteFiles(workspaceId: number, fileIds: number[]): Observable<boolean> {
    const batchSize = 100;
    const batches = [];

    for (let i = 0; i < fileIds.length; i += batchSize) {
      batches.push(fileIds.slice(i, i + batchSize));
    }

    return batches.reduce<Observable<boolean>>((acc, batch) => acc.pipe(
      switchMap(() => this.http
        .delete(`${this.serverUrl}admin/workspace/${workspaceId}/files`, {
          headers: this.authHeader,
          params: { fileIds: batch.join(';') }
        })
        .pipe(
          map(() => true),
          catchError(() => of(false))
        )
      )
    ), of(true));
  }

  downloadFile(workspaceId: number, fileId: number): Observable<FileDownloadDto> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/files/${fileId}/download`;
    return this.http.get<FileDownloadDto>(url, { headers: this.authHeader });
  }

  validateFiles(workspace_id:number): Observable<boolean | FilesValidationDto[]> {
    return this.http
      .get<FilesValidationDto[]>(
      `${this.serverUrl}admin/workspace/${workspace_id}/files/validation`,
      { headers: this.authHeader })
      .pipe(
        catchError(() => of(false)),
        map(res => res)
      );
  }

  deleteTestPersons(workspace_id:number, testPersonIds: number[]): Observable<boolean> {
    const params = new HttpParams().set('testPersons', testPersonIds.join(','));
    return this.http
      .delete(
        `${this.serverUrl}admin/workspace/${workspace_id}/test-results`,
        { headers: this.authHeader, params })
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  codeTestPersons(workspace_id:number, testPersonIds: number[]): Observable<boolean> {
    const params = new HttpParams().set('testPersons', testPersonIds.join(','));
    return this.http
      .get<boolean>(
      `${this.serverUrl}admin/workspace/${workspace_id}/coding`,
      { headers: this.authHeader, params })
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  changeWorkspace(workspaceData: WorkspaceFullDto): Observable<boolean> {
    return this.http
      .patch<boolean>(`${this.serverUrl}admin/workspace`, workspaceData, { headers: this.authHeader })
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  uploadTestFiles(workspaceId: number, files: FileList | null): Observable<number> {
    const formData = new FormData();
    if (files) {
      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
      }
    }
    return this.http.post<never>(`${this.serverUrl}admin/workspace/${workspaceId}/upload`, formData, {
      headers: this.authHeader
    });
  }

  uploadTestResults(workspaceId: number, files: FileList | null, resultType: 'logs' | 'responses'): Observable<number> {
    const formData = new FormData();
    if (files) {
      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
      }
    }
    return this.http.post<never>(`${this.serverUrl}admin/workspace/${workspaceId}/upload/results/${resultType}`, formData, {
      headers: this.authHeader
    });
  }

  setUserWorkspaceAccessRight(userId: number, workspaceIds: number[]): Observable<boolean> {
    return this.http.post<boolean>(
      `${this.serverUrl}admin/users/${userId}/workspaces/`,
      workspaceIds,
      { headers: this.authHeader });
  }

  setWorkspaceUsersAccessRight(workspaceId: number, userIds: number[]): Observable<boolean> {
    return this.http.post<boolean>(
      `${this.serverUrl}admin/workspace/${workspaceId}/users/`,
      userIds,
      { headers: this.authHeader });
  }

  getFilesList(workspaceId: number): Observable<FilesInListDto[]> {
    return this.http.get<FilesInListDto[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/files`,
      { headers: this.authHeader });
  }

  getUnitDef(workspaceId: number, unit: string, authToken?:string): Observable<FilesDto[]> {
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : this.authHeader;
    return this.http.get<FilesDto[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/${unit}/unitDef`,
      { headers });
  }

  getPlayer(workspaceId: number, player:string, authToken?:string): Observable<FilesDto[]> {
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : this.authHeader;
    return this.http.get<FilesDto[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/player/${player}`,
      { headers });
  }

  getResponses(workspaceId: number, testPerson: string, unitId:string, authToken?:string
  ): Observable<ResponseDto[]> {
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : this.authHeader;
    return this.http.get<ResponseDto[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/responses/${testPerson}/${unitId}`,
      { headers });
  }

  getUnit(workspaceId: number,
          testPerson: string,
          unitId:string,
          authToken?:string
  ): Observable<FilesDto[]> {
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : this.authHeader;
    return this.http.get<FilesDto[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit/${testPerson}/${unitId}`,
      { headers });
  }

  getResponsesUnitIds(workspaceId: number, testPerson: string): Observable<{ unit_id:string }[]> {
    return this.http.get<{ unit_id:string }[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/units/${testPerson}`,
      { headers: this.authHeader });
  }

  getTestGroups(workspaceId: number): Observable<TestGroupsInListDto[]> {
    return this.http.get<TestGroupsInListDto[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-groups`,
      { headers: this.authHeader });
  }

  getTestPersons(workspaceId: number, testGroup:string): Observable<string[]> {
    return this.http.get<string[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-groups/${testGroup}`,
      { headers: this.authHeader });
  }

  getTestResults(workspaceId: number, page: number, limit: number): Observable<any> {
    const params = {
      page: page.toString(),
      limit: limit.toString()
    };

    return this.http.get<any>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-results/`,
      {
        headers: this.authHeader,
        params: params
      }
    ).pipe(
      catchError(() => {
        logger.error('Fehler beim Abrufen der Testdaten:');
        return of({ results: [], total: 0 });
      }),
      map(result => result || { results: [], total: 0 })
    );
  }

  getPersonTestResults(workspaceId: number, personId: number): Observable<any> {
    return this.http.get<Promise<{
      id: number;
      personid: number;
      name: string;
      size: number;
      logs: { id: number; bookletid: number; ts: string; parameter: string, key: string }[];
      units: {
        id: number;
        bookletid: number;
        name: string;
        alias: string | null;
        results: { id: number; unitid: number }[];
        logs: { id: number; unitid: number; ts: string; key: string; parameter: string }[];
      }[];
    }[]>[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-results/${personId}`,
      { headers: this.authHeader }
    );
  }

  authenticate(username:string, password:string, server:string, url:string): Observable<ServerResponse > {
    return this.http
      .post<ServerResponse>(`${this.serverUrl}tc_authentication`, {
      username, password, server, url
    });
  }

  importWorkspaceFiles(workspace_id: number,
                       testCenterWorkspace: string,
                       server:string,
                       url:string,
                       token:string,
                       importOptions:ImportOptions,
                       testGroups: string[]
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
      .set('testGroups', String(testGroups.join(',')));

    return this.http
      .get<Result>(`${this.serverUrl}admin/workspace/${workspace_id}/importWorkspaceFiles`, { headers: this.authHeader, params })
      .pipe(
        catchError(() => of({
          success: false, testFiles: 0, responses: 0, logs: 0
        }))
      );
  }

  importTestcenterGroups(workspace_id: number,
                         testCenterWorkspace: string,
                         server:string,
                         url:string,
                         authToken:string
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
