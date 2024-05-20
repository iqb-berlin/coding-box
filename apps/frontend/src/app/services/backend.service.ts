import { Injectable, Inject } from '@angular/core';
import { HttpClient, HttpEventType } from '@angular/common/http';
import {
  catchError, map, Observable, of
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

  login(user: CreateUserDto): Observable<string> {
    return this.http.post<string>(`${SERVER_URL}login`, user);
  }

  getAuthData(): Observable<AuthDataDto> {
    return this.http.get<AuthDataDto>(`${SERVER_URL}auth-data`);
  }

  getUsersFull(): Observable<UserFullDto[]> {
    return this.http
      .get<UserFullDto[]>(`${this.serverUrl}admin/users/full`)
      .pipe(
        catchError(() => of([]))
      );
  }

  addUser(newUser: CreateUserDto): Observable<boolean> {
    return this.http
      .post(`${this.serverUrl}admin/users`, newUser)
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  changeUserData(newData: UserFullDto): Observable<boolean> {
    return this.http
      .patch(`${this.serverUrl}admin/users`, newData)
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  deleteUsers(users: number[]): Observable<boolean> {
    return this.http
      .delete(`${this.serverUrl}admin/users/${users.join(';')}`)
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  getAllWorkspacesList(): Observable<WorkspaceInListDto[]> {
    return this.http
      .get<WorkspaceInListDto[]>(`${this.serverUrl}admin/workspace`)
      .pipe(
        catchError(() => of([]))
      );
  }

  getWorkspacesByUserList(userId:number): Observable<number[]> {
    return this.http
      .get<number[]>(`${this.serverUrl}admin/users/${userId}/workspaces`)
      .pipe(
        catchError(() => of([]))
      );
  }

  addWorkspace(workspaceData: CreateWorkspaceDto): Observable<boolean> {
    return this.http
      .post<boolean>(`${this.serverUrl}admin/workspace`, workspaceData)
      .pipe(
        catchError(() => of(false))
      );
  }

  deleteWorkspace(ids: number[]): Observable<boolean> {
    return this.http
      .delete(`${this.serverUrl}admin/workspace/${ids.join(';')}`)
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  changeWorkspace(workspaceData: WorkspaceFullDto): Observable<boolean> {
    return this.http
      .patch<boolean>(`${this.serverUrl}admin/workspace`, workspaceData)
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

  getTestFiles(workspaceId: number): Observable<any> {
    return this.http.get<FilesDto[]>(`${SERVER_URL}admin/workspace/${workspaceId}/files`);
  }

  getUnitDef(workspaceId: number, unit: string): Observable<any> {
    return this.http.get<FilesDto[]>(`${SERVER_URL}admin/workspace/${workspaceId}/${unit}/unitDef`);
  }

  getPlayer(workspaceId: number): Observable<any> {
    return this.http.get<FilesDto[]>(`${SERVER_URL}admin/workspace/${workspaceId}/player`);
  }



  getResponses(workspaceId: number, testPerson: string): Observable<any> {
    return this.http.get<FilesDto[]>(`${SERVER_URL}admin/workspace/${workspaceId}/${testPerson}/responses`);
  }

  getTestpersonUnits(workspaceId: number, testPerson: string): Observable<any> {
    return this.http.get<any[]>(`${SERVER_URL}admin/workspace/${workspaceId}/units/${testPerson}`);
  }
  getTestGroups(workspaceId: number): Observable<any> {
    return this.http.get<any[]>(`${SERVER_URL}admin/workspace/${workspaceId}/test-groups`);
  }
  getTestPersons(workspaceId: number,testGroup:string): Observable<any> {
    return this.http.get<any[]>(`${SERVER_URL}admin/workspace/${workspaceId}/test-groups/${testGroup}`);
  }

  // eslint-disable-next-line class-methods-use-this
  authenticate(username:string, password:string, server:string): Observable<any> {
    return this.http
      .post<any>(`${SERVER_URL}admin/workspace/authenticate`, { username, password, server })
      .pipe(
        catchError(() => of(false))
      );
  }

  importWorkspaceFiles(workspace: string, server:string, token:string): Observable<any> {
    return this.http
      .get<any>(`${SERVER_URL}admin/workspace/importWorkspaceFiles?workspace=${workspace}&server=${server}&token=${token}`, {})
      .pipe(
        catchError(() => of(false))
      );
  }
}
