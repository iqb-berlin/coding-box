import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  catchError,
  map,
  Observable,
  of
} from 'rxjs';
import { WorkspaceFullDto } from '../../../../../api-dto/workspaces/workspace-full-dto';
import { CreateWorkspaceDto } from '../../../../../api-dto/workspaces/create-workspace-dto';
import { PaginatedWorkspacesDto } from '../../../../../api-dto/workspaces/paginated-workspaces-dto';
import { PaginatedWorkspaceUserDto } from '../../../../../api-dto/workspaces/paginated-workspace-user-dto';
import { SERVER_URL } from '../injection-tokens';

@Injectable({
  providedIn: 'root'
})
export class WorkspaceBackendService {
  private readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  getAllWorkspacesList(): Observable<PaginatedWorkspacesDto> {
    return this.http
      .get<PaginatedWorkspacesDto>(`${this.serverUrl}admin/workspace`,
      {})
      .pipe(
        catchError(() => {
          const defaultResponse: PaginatedWorkspacesDto = {
            data: [],
            total: 0,
            page: 0,
            limit: 0
          };
          return of(defaultResponse);
        })
      );
  }

  getWorkspaceUsers(workspaceId: number): Observable<PaginatedWorkspaceUserDto> {
    return this.http
      .get<PaginatedWorkspaceUserDto>(`${this.serverUrl}admin/workspace/${workspaceId}/users`,
      {})
      .pipe(
        catchError(() => of({
          data: [],
          total: 0,
          page: 0,
          limit: 0
        }))
      );
  }

  addWorkspace(workspaceData: CreateWorkspaceDto): Observable<boolean> {
    return this.http
      .post<boolean>(`${this.serverUrl}admin/workspace`, workspaceData, {})
      .pipe(
        catchError(() => of(false))
      );
  }

  deleteWorkspace(ids: number[]): Observable<boolean> {
    const params = new HttpParams().set('ids', ids.join(';'));
    return this.http
      .delete(`${this.serverUrl}admin/workspace`, {
        params
      })
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  changeWorkspace(workspaceData: WorkspaceFullDto): Observable<boolean> {
    return this.http
      .patch<boolean>(`${this.serverUrl}admin/workspace`, workspaceData, {})
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  setWorkspaceUsersAccessRight(workspaceId: number, userIds: number[]): Observable<boolean> {
    return this.http.post<boolean>(
      `${this.serverUrl}admin/workspace/${workspaceId}/users/`,
      userIds,
      {});
  }
}
