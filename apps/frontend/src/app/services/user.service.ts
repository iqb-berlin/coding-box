import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  catchError,
  map,
  Observable,
  of
} from 'rxjs';
import { CreateUserDto } from '../../../../../api-dto/user/create-user-dto';
import { UserFullDto } from '../../../../../api-dto/user/user-full-dto';
import { UserInListDto } from '../../../../../api-dto/user/user-in-list-dto';
import { UserWorkspaceAccessDto } from '../../../../../api-dto/workspaces/user-workspace-access-dto';
import { SERVER_URL } from '../injection-tokens';

@Injectable({
  providedIn: 'root'
})
export class UserService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  getUsers(workspaceId: number): Observable<UserInListDto[]> {
    return this.http
      .get<UserInListDto[]>(`${this.serverUrl}admin/users/access/${workspaceId}`, {});
  }

  saveUsers(workspaceId: number, users: UserWorkspaceAccessDto[]): Observable<UserWorkspaceAccessDto[]> {
    return this.http
      .patch<UserWorkspaceAccessDto[]>(`${this.serverUrl}admin/users/access/${workspaceId}`,
      users,
      {});
  }

  getUsersFull(): Observable<UserFullDto[]> {
    return this.http
      .get<UserFullDto[]>(
      `${this.serverUrl}admin/users/full`,
      {})
      .pipe(
        catchError(() => of([]))
      );
  }

  addUser(newUser: CreateUserDto): Observable<boolean> {
    return this.http
      .post(
        `${this.serverUrl}admin/users`,
        newUser,
        {}
      )
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  changeUserData(userId: number, newData: UserFullDto): Observable<boolean> {
    return this.http
      .patch(
        `${this.serverUrl}admin/users/${userId}`,
        newData,
        {})
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  deleteUsers(users: number[]): Observable<boolean> {
    return this.http
      .delete(`${this.serverUrl}admin/users/${users.join(';')}`,
        {})
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  getWorkspacesByUserList(userId: number): Observable<number[]> {
    return this.http
      .get<number[]>(`${this.serverUrl}admin/users/${userId}/workspaces`,
      {})
      .pipe(
        catchError(() => of([]))
      );
  }

  setUserWorkspaceAccessRight(userId: number, workspaceIds: number[]): Observable<boolean> {
    return this.http.post<boolean>(
      `${this.serverUrl}admin/users/${userId}/workspaces/`,
      workspaceIds,
      {});
  }
}
