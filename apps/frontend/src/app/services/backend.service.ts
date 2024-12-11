import { Injectable, Inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  catchError, map, Observable, of, switchMap
} from 'rxjs';
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

  createToken(workspace_id:number, user:string, duration: number): Observable<string> {
    return this.http.get<string>( // TODO push
      `${this.serverUrl}admin/workspace/${workspace_id}/${user}/token/${duration}`,
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
                  this.appService.authData = authData;
                  return true;
                }),
                catchError(() => of(false))
              );
          }
          return of(loginToken);
        })
      );
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

  // Todo: Use queryParams for fileIds
  deleteFiles(workspace_id:number, fileIds: number[]): Observable<boolean> {
    return this.http
      .delete(
        `${this.serverUrl}admin/workspace/${workspace_id}/files/${fileIds.join(';')}`,
        { headers: this.authHeader })
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  // Todo: Use queryParams for testGroups
  deleteTestGroups(workspace_id:number, testGroups: string[]): Observable<boolean> {
    return this.http
      .delete(
        `${this.serverUrl}admin/workspace/${workspace_id}/test-groups/${testGroups.join(';')}`,
        { headers: this.authHeader })
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  // Todo: Use queryParams for ids
  createCodingTestGroups(ids: TestGroupsInListDto[]): Observable<boolean> {
    return this.http
      .delete(`${this.serverUrl}admin/workspace/${ids.join(';')}`, { headers: this.authHeader })
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
                       importOptions:ImportOptions): Observable<Result> {
    const {
      units, responses, definitions, player, codings, logs, testTakers, booklets
    } = importOptions;
    return this.http
      // eslint-disable-next-line max-len
      .get<Result>(`${this.serverUrl}admin/workspace/${workspace_id}/importWorkspaceFiles?tc_workspace=${testCenterWorkspace}&server=${server}&url=${encodeURIComponent(url)}&responses=${responses}&logs=${logs}&definitions=${definitions}&units=${units}&codings=${codings}&player=${player}&token=${token}&testTakers=${testTakers}&booklets=${booklets}`, { headers: this.authHeader })
      .pipe(
        catchError(() => of({
          success: false, testFiles: 0, responses: 0, logs: 0
        }))
      );
  }
}
