import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  catchError,
  map,
  Observable,
  of
} from 'rxjs';
import type { RequestBody } from '../../../../../../../api-dto/request-contracts';
import type { TestcenterInstanceDto } from '../../../../../../../api-dto/testcenter/testcenter-instance.dto';
import { UserFullDto } from '../../../../../../../api-dto/user/user-full-dto';
import { UserInListDto } from '../../../../../../../api-dto/user/user-in-list-dto';
import { SERVER_URL } from '../../../injection-tokens';
import {
  suppressGlobalAndForbiddenHttpErrorContext, suppressGlobalHttpErrorContext
} from '../../../core/interceptors/http-error-context';
import { ServerResponse } from '../../../core/services/authentication.service';

@Injectable({
  providedIn: 'root'
})
export class UserBackendService {
  private readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  getTestcenterInstances(): Observable<TestcenterInstanceDto[]> {
    return this.http.get<TestcenterInstanceDto[]>(`${this.serverUrl}testcenter/instances`);
  }

  getUsers(workspaceId: number, background = false): Observable<UserInListDto[]> {
    return this.http
      .get<UserInListDto[]>(`${this.serverUrl}admin/users/access/${workspaceId}`, {
        context: background ? suppressGlobalHttpErrorContext() : undefined
      });
  }

  saveUsers(workspaceId: number, users: RequestBody<'UsersController_updateUsersAccess'>): Observable<boolean> {
    return this.http
      .patch<boolean>(`${this.serverUrl}admin/users/access/${workspaceId}`,
        users,
        {})
      .pipe(catchError(() => of(false)));
  }

  getUsersFull(background = false): Observable<UserFullDto[]> {
    return this.http
      .get<UserFullDto[]>(
        `${this.serverUrl}admin/users/full`,
        { context: background ? suppressGlobalHttpErrorContext() : undefined });
  }

  getUsersForWorkspaceSelection(workspaceId: number, background = false): Observable<UserFullDto[]> {
    return this.http
      .get<UserFullDto[]>(`${this.serverUrl}admin/users/directory/${workspaceId}`, {
        context: background ? suppressGlobalHttpErrorContext() : undefined
      });
  }

  addUser(newUser: RequestBody<'CreateUserDto'>): Observable<boolean> {
    return this.http
      .post(
        `${this.serverUrl}admin/users`,
        newUser,
        {}
      )
      .pipe(
        map(() => true),
        catchError(() => of(false))
      );
  }

  changeUserData(userId: number, newData: RequestBody<'UserFullDto'>): Observable<boolean> {
    return this.http
      .patch(
        `${this.serverUrl}admin/users/${userId}`,
        newData,
        {})
      .pipe(
        map(() => true),
        catchError(() => of(false))
      );
  }

  deleteUsers(users: number[]): Observable<boolean> {
    return this.http
      .delete(`${this.serverUrl}admin/users/${users.join(';')}`,
        {})
      .pipe(
        map(() => true),
        catchError(() => of(false))
      );
  }

  getWorkspacesByUserList(userId: number): Observable<number[]> {
    return this.requestWorkspacesByUserList(userId)
      .pipe(
        catchError(() => of([]))
      );
  }

  getWorkspacesByUserListOrFail(userId: number): Observable<number[]> {
    return this.requestWorkspacesByUserList(userId);
  }

  private requestWorkspacesByUserList(userId: number): Observable<number[]> {
    return this.http
      .get<number[]>(`${this.serverUrl}admin/users/${userId}/workspaces`,
        {});
  }

  setUserWorkspaceAccessRight(userId: number, workspaceIds: number[]): Observable<boolean> {
    return this.http.post<boolean>(
      `${this.serverUrl}admin/users/${userId}/workspaces/`,
      workspaceIds,
      {})
      .pipe(catchError(() => of(false)));
  }

  authenticate(username: string, password: string, server: string, url: string): Observable<ServerResponse> {
    return this.http
      .post<ServerResponse>(`${this.serverUrl}tc_authentication`, {
        username,
        password,
        server,
        url
      }, { context: suppressGlobalAndForbiddenHttpErrorContext() });
  }
}
