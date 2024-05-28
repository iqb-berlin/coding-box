import { Injectable, Inject } from '@angular/core';
import { HttpClient, HttpEventType } from '@angular/common/http';
import {
  catchError, map, Observable, of, switchMap
} from 'rxjs';
import { CreateUserDto } from '../../../api-dto/user/create-user-dto';
import { AppService } from './app.service';
import { UserFullDto } from '../../../api-dto/user/user-full-dto';
import { WorkspaceFullDto } from '../../../api-dto/workspaces/workspace-full-dto';
import { WorkspaceInListDto } from '../../../api-dto/workspaces/workspace-in-list-dto';
import { CreateWorkspaceDto } from '../../../api-dto/workspaces/create-workspace-dto';
import { AuthDataDto } from '../../../api-dto/auth-data-dto';
import { FilesDto } from '../../../api-dto/files/files.dto';

const SERVER_URL = 'http://localhost:3333/api/';
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

  createToken(): Observable<string>{
    return this.http.get<string>(`${this.serverUrl}create-token`, { headers: this.authHeader });
  }

  keycloakLogin(user: CreateUserDto): Observable<boolean> {
    return this.http.post<string>(`${this.serverUrl}keycloak-login`, user)
      .pipe(
        catchError(() => of(false)),
        switchMap(loginToken => {
          if (typeof loginToken === 'string') {
            localStorage.setItem('id_token', loginToken);
            return this.getAuthData()
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

  login(user: CreateUserDto): Observable<string> {
    return this.http.post<string>(`${SERVER_URL}login`, user, { headers: this.authHeader });
  }

  getAuthData(): Observable<AuthDataDto> {
    return this.http.get<AuthDataDto>(`${SERVER_URL}auth-data`, { headers: this.authHeader });
  }

  getUsersFull(): Observable<UserFullDto[]> {
    return this.http
      .get<UserFullDto[]>(`${this.serverUrl}admin/users/full`, { headers: this.authHeader })
      .pipe(
        catchError(() => of([]))
      );
  }

  addUser(newUser: CreateUserDto): Observable<boolean> {
    return this.http
      .post(`${this.serverUrl}admin/users`, newUser, { headers: this.authHeader })
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  changeUserData(newData: UserFullDto): Observable<boolean> {
    return this.http
      .patch(`${this.serverUrl}admin/users`, newData, { headers: this.authHeader })
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  deleteUsers(users: number[]): Observable<boolean> {
    return this.http
      .delete(`${this.serverUrl}admin/users/${users.join(';')}`, { headers: this.authHeader })
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  getAllWorkspacesList(): Observable<WorkspaceInListDto[]> {
    return this.http
      .get<WorkspaceInListDto[]>(`${this.serverUrl}admin/workspace`, { headers: this.authHeader })
      .pipe(
        catchError(() => of([]))
      );
  }

  getWorkspacesByUserList(userId:number): Observable<number[]> {
    return this.http
      .get<number[]>(`${this.serverUrl}admin/users/${userId}/workspaces`, { headers: this.authHeader })
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

  deleteWorkspace(ids: number[]): Observable<boolean> {
    return this.http
      .delete(`${this.serverUrl}admin/workspace/${ids.join(';')}`, { headers: this.authHeader })
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  deleteTestGroups(ids: any): Observable<boolean> {
    return this.http
      .delete(`${this.serverUrl}admin/workspace/${ids.join(';')}`, { headers: this.authHeader })
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  createCodingTestGroups(ids: any): Observable<boolean> {
    return this.http
      .delete(`${this.serverUrl}admin/workspace/${ids.join(';')}`, { headers: this.authHeader })
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  changeWorkspace(workspaceData: WorkspaceFullDto): Observable<boolean> {
    return this.http
      .patch<boolean>(`${this.serverUrl}admin/workspace`, workspaceData, { headers: this.authHeader })
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  uploadTestFiles(workspaceId: number, files: FileList | null): Observable<any | number> {
    if (files) {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
      }

      return this.http.post<any>(`${SERVER_URL}admin/workspace/${workspaceId}/upload`, formData, {
        headers: this.authHeader,
        reportProgress: true,
        observe: 'events'
      }).pipe(
        map(event => {
          if (event) {
            if (event.type === HttpEventType.UploadProgress) {
              return event.total ? Math.round(100 * (event.loaded / event.total)) : event.loaded;
            }
            if (event.type === HttpEventType.Response) {
              return event.body || {
                source: 'upload-units',
                messages: [{ objectKey: '', messageKey: 'upload-units.request-error' }]
              };
            }
            return 0;
          }
          return -1;
        })
      );
    }
    return of(-1);
  }

  setUserWorkspaceAccessRight(userId: number, workspaceIds: number[]): Observable<boolean> {
    console.log('öööööö', userId, workspaceIds);
    return this.http.post<boolean>(`${SERVER_URL}admin/users/${userId}/workspaces/`, workspaceIds, { headers: this.authHeader });
  }

  getFilesList(workspaceId: number): Observable<any> {
    return this.http.get<FilesDto[]>(`${SERVER_URL}admin/workspace/${workspaceId}/files`, { headers: this.authHeader });
  }

  getUnitDef(workspaceId: number, unit: string): Observable<any> {
    return this.http.get<FilesDto[]>(`${SERVER_URL}admin/workspace/${workspaceId}/${unit}/unitDef`, { headers: this.authHeader });
  }

  getPlayer(workspaceId: number, player:string): Observable<any> {
    return this.http.get<FilesDto[]>(`${SERVER_URL}admin/workspace/${workspaceId}/player/${player}`, { headers: this.authHeader });
  }

  getResponses(workspaceId: number, testPerson: string, unitId:string): Observable<any> {
    return this.http.get<FilesDto[]>(`${SERVER_URL}admin/workspace/${workspaceId}/responses/${testPerson}/${unitId}`, { headers: this.authHeader });
  }

  getUnit(workspaceId: number, testPerson: string, unitId:string): Observable<any> {
    return this.http.get<FilesDto[]>(`${SERVER_URL}admin/workspace/${workspaceId}/unit/${testPerson}/${unitId}`, { headers: this.authHeader });
  }

  getTestpersonUnits(workspaceId: number, testPerson: string): Observable<any> {
    return this.http.get<any[]>(`${SERVER_URL}admin/workspace/${workspaceId}/units/${testPerson}`, { headers: this.authHeader });
  }

  getTestGroups(workspaceId: number): Observable<any> {
    return this.http.get<any[]>(`${SERVER_URL}admin/workspace/${workspaceId}/test-groups`, { headers: this.authHeader });
  }

  getTestPersons(workspaceId: number, testGroup:string): Observable<any> {
    return this.http.get<any[]>(`${SERVER_URL}admin/workspace/${workspaceId}/test-groups/${testGroup}`, { headers: this.authHeader });
  }

  // eslint-disable-next-line class-methods-use-this
  authenticate(username:string, password:string, server:string): Observable<any> {
    return this.http
      .post<any>(`${SERVER_URL}admin/workspace/authenticate`, { username, password, server })
      .pipe(
        catchError(() => of(false))
      );
  }

  importWorkspaceFiles(workspace: string,
                       server:string,
                       token:string,
                       importOptions:any): Observable<any> {
    const {
      units, responses, definitions, player
    } = importOptions;
    return this.http
      // eslint-disable-next-line max-len
      .get<boolean>(`${SERVER_URL}admin/workspace/importWorkspaceFiles?workspace=${workspace}&server=${server}&responses=${responses}&definitions=${definitions}&units=${units}&player=${player}&token=${token}`, { headers: this.authHeader })
      .pipe(
        catchError(() => of(false))
      );
  }
}
