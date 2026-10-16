import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  catchError,
  EMPTY,
  expand,
  map,
  Observable,
  of,
  reduce,
  throwError
} from 'rxjs';
import { WorkspaceFullDto } from '../../../../../../api-dto/workspaces/workspace-full-dto';
import { CreateWorkspaceDto } from '../../../../../../api-dto/workspaces/create-workspace-dto';
import { PaginatedWorkspacesDto } from '../../../../../../api-dto/workspaces/paginated-workspaces-dto';
import { PaginatedWorkspaceUserDto } from '../../../../../../api-dto/workspaces/paginated-workspace-user-dto';
import { SERVER_URL } from '../../injection-tokens';
import { WorkspaceUserDto } from '../../../../../../api-dto/workspaces/workspace-user-dto';

export interface CoderDto extends WorkspaceUserDto {
  username: string;
}

@Injectable({
  providedIn: 'root'
})
export class WorkspaceBackendService {
  private readonly workspaceUsersPageLimit = 500;
  private readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  getAllWorkspacesList(): Observable<PaginatedWorkspacesDto> {
    return this.getAllWorkspacesListOrFail()
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

  getAllWorkspacesListOrFail(): Observable<PaginatedWorkspacesDto> {
    return this.http.get<PaginatedWorkspacesDto>(`${this.serverUrl}admin/workspace`, {}).pipe(
      expand(response => {
        const page = Number(response.page);
        const limit = Number(response.limit);
        if (response.total === 0) return EMPTY;
        if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 ||
          response.data.length === 0) {
          return throwError(() => new Error('Incomplete workspace list'));
        }
        if (page * limit >= response.total) return EMPTY;
        return this.http.get<PaginatedWorkspacesDto>(`${this.serverUrl}admin/workspace`, {
          params: new HttpParams().set('page', page + 1).set('limit', limit)
        }).pipe(map(nextPage => {
          if (Number(nextPage.page) !== page + 1 || Number(nextPage.limit) !== limit || nextPage.total !== response.total) {
            throw new Error('Workspace pagination changed while loading');
          }
          return nextPage;
        }));
      }),
      reduce((all, response) => ({
        data: [...all.data, ...response.data],
        total: response.total,
        page: 1,
        limit: all.data.length + response.data.length
      }), {
        data: [], total: 0, page: 1, limit: 0
      } as PaginatedWorkspacesDto),
      map(result => {
        if (result.data.length !== result.total || new Set(result.data.map(workspace => workspace.id)).size !== result.total) {
          throw new Error('Incomplete workspace list');
        }
        return result;
      })
    );
  }

  getWorkspaceUsers(
    workspaceId: number,
    options?: { page?: number; limit?: number }
  ): Observable<PaginatedWorkspaceUserDto> {
    return this.requestWorkspaceUsers(workspaceId, options)
      .pipe(
        catchError(() => of({
          data: [],
          total: 0,
          page: 0,
          limit: 0
        }))
      );
  }

  private requestWorkspaceUsers(
    workspaceId: number,
    options?: { page?: number; limit?: number }
  ): Observable<PaginatedWorkspaceUserDto> {
    let params = new HttpParams();
    if (options?.page) {
      params = params.set('page', options.page);
    }
    if (options?.limit) {
      params = params.set('limit', options.limit);
    }

    return this.http
      .get<PaginatedWorkspaceUserDto>(`${this.serverUrl}admin/workspace/${workspaceId}/users`,
      { params });
  }

  getAllWorkspaceUsers(workspaceId: number): Observable<WorkspaceUserDto[]> {
    return this.requestWorkspaceUsers(workspaceId, { page: 1, limit: this.workspaceUsersPageLimit }).pipe(
      expand(response => {
        const currentPage = Number(response.page);
        const currentLimit = Number(response.limit);
        const total = Number(response.total);

        return currentPage * currentLimit < total ?
          this.requestWorkspaceUsers(workspaceId, { page: currentPage + 1, limit: this.workspaceUsersPageLimit }) :
          EMPTY;
      }),
      reduce((users, response) => users.concat(response.data), [] as WorkspaceUserDto[])
    );
  }

  getWorkspaceCoders(workspaceId: number): Observable<{ data: CoderDto[], total: number }> {
    return this.http
      .get<{ data: CoderDto[], total: number }>(`${this.serverUrl}admin/workspace/${workspaceId}/coders`,
      {})
      .pipe(
        catchError(() => of({
          data: [],
          total: 0
        }))
      );
  }

  addWorkspace(workspaceData: CreateWorkspaceDto): Observable<number | null> {
    return this.http
      .post<number>(`${this.serverUrl}admin/workspace`, workspaceData, {})
      .pipe(
        catchError(() => of(null))
      );
  }

  deleteWorkspace(ids: number[]): Observable<boolean> {
    const params = new HttpParams().set('ids', ids.join(';'));
    return this.http
      .delete(`${this.serverUrl}admin/workspace`, {
        params
      })
      .pipe(
        map(() => true),
        catchError(() => of(false))
      );
  }

  changeWorkspace(workspaceData: WorkspaceFullDto): Observable<boolean> {
    return this.http
      .patch<boolean>(`${this.serverUrl}admin/workspace`, workspaceData, {})
      .pipe(
        map(() => true),
        catchError(() => of(false))
      );
  }

  setWorkspaceUsersAccessRight(workspaceId: number, userIds: number[]): Observable<boolean> {
    return this.http.post<boolean>(
      `${this.serverUrl}admin/workspace/${workspaceId}/users/`,
      userIds,
      {})
      .pipe(catchError(() => of(false)));
  }
}
