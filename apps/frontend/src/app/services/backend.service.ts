import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  catchError, map, Observable, of, switchMap
} from 'rxjs';
import { logger } from 'nx/src/utils/logger';
import { CreateUserDto } from '../../../../../api-dto/user/create-user-dto';
// eslint-disable-next-line import/no-cycle
import { AppService } from './app.service';
import { UserFullDto } from '../../../../../api-dto/user/user-full-dto';
import { WorkspaceFullDto } from '../../../../../api-dto/workspaces/workspace-full-dto';
import { CreateWorkspaceDto } from '../../../../../api-dto/workspaces/create-workspace-dto';
// eslint-disable-next-line import/no-cycle
import {
  ImportOptions,
  Result,
  ServerResponse
} from '../ws-admin/components/test-center-import/test-center-import.component';
import { FilesInListDto } from '../../../../../api-dto/files/files-in-list.dto';
import { ResponseDto } from '../../../../../api-dto/responses/response-dto';
import { FilesDto } from '../../../../../api-dto/files/files.dto';
import { UserInListDto } from '../../../../../api-dto/user/user-in-list-dto';
import { UserWorkspaceAccessDto } from '../../../../../api-dto/workspaces/user-workspace-access-dto';
import { FileValidationResultDto } from '../../../../../api-dto/files/file-validation-result.dto';
import { FileDownloadDto } from '../../../../../api-dto/files/file-download.dto';
import { TestGroupsInfoDto } from '../../../../../api-dto/files/test-groups-info.dto';
import { CodingStatistics } from '../../../../../api-dto/coding/coding-statistics';
import { PaginatedWorkspacesDto } from '../../../../../api-dto/workspaces/paginated-workspaces-dto';
import { UnitTagDto } from '../../../../../api-dto/unit-tags/unit-tag.dto';
import { CreateUnitTagDto } from '../../../../../api-dto/unit-tags/create-unit-tag.dto';
import { UpdateUnitTagDto } from '../../../../../api-dto/unit-tags/update-unit-tag.dto';
import { UnitNoteDto } from '../../../../../api-dto/unit-notes/unit-note.dto';
import { CreateUnitNoteDto } from '../../../../../api-dto/unit-notes/create-unit-note.dto';
import { UpdateUnitNoteDto } from '../../../../../api-dto/unit-notes/update-unit-note.dto';
import { ResourcePackageDto } from '../../../../../api-dto/resource-package/resource-package-dto';
import { PaginatedWorkspaceUserDto } from '../../../../../api-dto/workspaces/paginated-workspace-user-dto';

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface CodingListItem {
  unit_key: string;
  unit_alias: string;
  login_name: string;
  login_code: string;
  booklet_id: string;
  variable_id: string;
  variable_page: string;
  variable_anchor: string;
  url: string;
}

interface ResponseEntity {
  id: number;
  unitId: number;
  variableId: string;
  status: string;
  value: string;
  subform: string;
  code: number;
  score: number;
  codedStatus: string;
  unit?: {
    name: string;
    alias: string;
    booklet?: {
      person?: {
        login: string;
        code: string;
      };
      bookletinfo?: {
        name: string;
      };
    };
  };
}

export interface ResponseValidationResult {
  valid: boolean;
  totalResponses: number;
  validResponses: number;
  invalidResponses: number;
  invalidGroups: string[];
  details: { group: string; exists: boolean; count: number }[];
}

@Injectable({
  providedIn: 'root'
})
export class BackendService {
  private readonly serverUrl = inject<string>('SERVER_URL' as any);
  private http = inject(HttpClient);
  appService = inject(AppService);

  authHeader = { Authorization: `Bearer ${localStorage.getItem('id_token')}` };

  getDirectDownloadLink(): string {
    return `${this.serverUrl}packages/`;
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

  getAllWorkspacesList(): Observable<PaginatedWorkspacesDto> {
    return this.http
      .get<PaginatedWorkspacesDto>(`${this.serverUrl}admin/workspace`,
      { headers: this.authHeader })
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

  getWorkspacesByUserList(userId:number): Observable<number[]> {
    return this.http
      .get<number[]>(`${this.serverUrl}admin/users/${userId}/workspaces`,
      { headers: this.authHeader })
      .pipe(
        catchError(() => of([]))
      );
  }

  getWorkspaceUsers(workspaceId:number): Observable<PaginatedWorkspaceUserDto> {
    return this.http
      .get<PaginatedWorkspaceUserDto>(`${this.serverUrl}admin/workspace/${workspaceId}/users`,
      { headers: this.authHeader })
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
      .post<boolean>(`${this.serverUrl}admin/workspace`, workspaceData, { headers: this.authHeader })
      .pipe(
        catchError(() => of(false))
      );
  }

  deleteWorkspace(ids: number[]): Observable<boolean> {
    const params = new HttpParams().set('ids', ids.join(';'));
    return this.http
      .delete(`${this.serverUrl}admin/workspace`, {
        headers: this.authHeader,
        params
      })
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

  validateFiles(workspace_id:number): Observable<boolean | FileValidationResultDto> {
    return this.http
      .get<FileValidationResultDto>(
      `${this.serverUrl}admin/workspace/${workspace_id}/files/validation`,
      { headers: this.authHeader })
      .pipe(
        catchError(() => of(false)),
        map(res => res)
      );
  }

  validateResponsesAgainstTesttakers(workspace_id:number): Observable<ResponseValidationResult> {
    return this.http
      .get<ResponseValidationResult>(
      `${this.serverUrl}admin/workspace/${workspace_id}/responses/validation`,
      { headers: this.authHeader })
      .pipe(
        catchError(() => of({
          valid: false,
          totalResponses: 0,
          validResponses: 0,
          invalidResponses: 0,
          invalidGroups: [],
          details: []
        })),
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

  codeTestPersons(workspace_id:number, testPersonIds: number[]): Observable<{
    totalResponses: number;
    statusCounts: {
      [key: string]: number;
    };
  }> {
    const params = new HttpParams().set('testPersons', testPersonIds.join(','));
    return this.http
      .get<{
      totalResponses: number;
      statusCounts: {
        [key: string]: number;
      };
    }>(
      `${this.serverUrl}admin/workspace/${workspace_id}/coding`,
      { headers: this.authHeader, params })
      .pipe(
        catchError(() => of({ totalResponses: 0, statusCounts: {} })),
        map(res => res)
      );
  }

  getCodingList(workspace_id:number, page: number = 1, limit: number = 100): Observable<PaginatedResponse<CodingListItem>> {
    const identity = this.appService.loggedUser?.sub || '';
    return this.appService.createToken(workspace_id, identity, 60).pipe(
      catchError(() => of('')),
      switchMap(token => {
        const params = new HttpParams()
          .set('page', page.toString())
          .set('limit', limit.toString())
          .set('identity', identity)
          .set('authToken', token)
          .set('serverUrl', window.location.origin);
        return this.http
          .get<PaginatedResponse<CodingListItem>>(
          `${this.serverUrl}admin/workspace/${workspace_id}/coding/coding-list`,
          { headers: this.authHeader, params }
        )
          .pipe(
            catchError(() => of({
              data: [],
              total: 0,
              page,
              limit
            })),
            map(res => res)
          );
      })
    );
  }

  getCodingListAsCsv(workspace_id: number): Observable<ArrayBuffer> {
    return this.http.get(
      `${this.serverUrl}admin/workspace/${workspace_id}/coding/coding-list/csv`,
      {
        headers: this.authHeader,
        responseType: 'arraybuffer'
      }
    );
  }

  getCodingListAsExcel(workspace_id: number): Observable<ArrayBuffer> {
    return this.http.get(
      `${this.serverUrl}admin/workspace/${workspace_id}/coding/coding-list/excel`,
      {
        headers: this.authHeader,
        responseType: 'arraybuffer'
      }
    );
  }

  getCodingStatistics(workspace_id:number): Observable<CodingStatistics> {
    return this.http
      .get<CodingStatistics>(
      `${this.serverUrl}admin/workspace/${workspace_id}/coding/statistics`,
      { headers: this.authHeader })
      .pipe(
        catchError(() => of({ totalResponses: 0, statusCounts: {} })),
        map(res => res)
      );
  }

  getResponsesByStatus(workspace_id:number, status: string, page: number = 1, limit: number = 100): Observable<PaginatedResponse<ResponseEntity>> {
    const params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString());

    return this.http
      .get<PaginatedResponse<ResponseEntity>>(
      `${this.serverUrl}admin/workspace/${workspace_id}/coding/responses/${status}`,
      { headers: this.authHeader, params }
    )
      .pipe(
        catchError(() => of({
          data: [],
          total: 0,
          page,
          limit
        })),
        map(res => res)
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

  uploadTestFiles(workspaceId: number, files: FileList | null): Observable<FileValidationResultDto | boolean> {
    const formData = new FormData();
    if (files) {
      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
      }
    }
    return this.http.post<FileValidationResultDto | boolean>( // Return type updated in post
      `${this.serverUrl}admin/workspace/${workspaceId}/upload`,
      formData,
      {
        headers: this.authHeader
      }
    ).pipe(
      catchError(() => of(false))
    );
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

  // Unit Tags API methods

  createUnitTag(workspaceId: number, createUnitTagDto: CreateUnitTagDto): Observable<UnitTagDto> {
    return this.http.post<UnitTagDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit-tags`,
      createUnitTagDto,
      { headers: this.authHeader });
  }

  getUnitTags(workspaceId: number, unitId: number): Observable<UnitTagDto[]> {
    return this.http.get<UnitTagDto[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit-tags/unit/${unitId}`,
      { headers: this.authHeader });
  }

  getUnitTag(workspaceId: number, tagId: number): Observable<UnitTagDto> {
    return this.http.get<UnitTagDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit-tags/${tagId}`,
      { headers: this.authHeader });
  }

  updateUnitTag(workspaceId: number, tagId: number, updateUnitTagDto: UpdateUnitTagDto): Observable<UnitTagDto> {
    return this.http.patch<UnitTagDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit-tags/${tagId}`,
      updateUnitTagDto,
      { headers: this.authHeader });
  }

  deleteUnitTag(workspaceId: number, tagId: number): Observable<boolean> {
    return this.http.delete<boolean>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit-tags/${tagId}`,
      { headers: this.authHeader });
  }

  createUnitNote(workspaceId: number, createUnitNoteDto: CreateUnitNoteDto): Observable<UnitNoteDto> {
    return this.http.post<UnitNoteDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit-notes`,
      createUnitNoteDto,
      { headers: this.authHeader });
  }

  getUnitNotes(workspaceId: number, unitId: number): Observable<UnitNoteDto[]> {
    return this.http.get<UnitNoteDto[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit-notes/unit/${unitId}`,
      { headers: this.authHeader });
  }

  getUnitNote(workspaceId: number, noteId: number): Observable<UnitNoteDto> {
    return this.http.get<UnitNoteDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit-notes/${noteId}`,
      { headers: this.authHeader });
  }

  updateUnitNote(workspaceId: number, noteId: number, updateUnitNoteDto: UpdateUnitNoteDto): Observable<UnitNoteDto> {
    return this.http.patch<UnitNoteDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit-notes/${noteId}`,
      updateUnitNoteDto,
      { headers: this.authHeader });
  }

  deleteUnitNote(workspaceId: number, noteId: number): Observable<boolean> {
    return this.http.delete<boolean>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit-notes/${noteId}`,
      { headers: this.authHeader });
  }

  setWorkspaceUsersAccessRight(workspaceId: number, userIds: number[]): Observable<boolean> {
    return this.http.post<boolean>(
      `${this.serverUrl}admin/workspace/${workspaceId}/users/`,
      userIds,
      { headers: this.authHeader });
  }

  getFilesList(
    workspaceId: number,
    page: number = 1,
    limit: number = 10000,
    fileType?: string,
    fileSize?: string,
    searchText?: string
  ): Observable<PaginatedResponse<FilesInListDto>> {
    let params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString());
    if (fileType) params = params.set('fileType', fileType);
    if (fileSize) params = params.set('fileSize', fileSize);
    if (searchText) params = params.set('searchText', searchText);

    return this.http.get<PaginatedResponse<FilesInListDto>>(
      `${this.serverUrl}admin/workspace/${workspaceId}/files`,
      { headers: this.authHeader, params }
    );
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

  getTestPersons(workspaceId: number): Observable<number[]> {
    return this.http.get<number[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-groups`,
      { headers: this.authHeader });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getTestResults(workspaceId: number, page: number, limit: number): Observable<any> {
    const params = {
      page: page.toString(),
      limit: limit.toString()
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.http.get<any>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-results/`,
      {
        headers: this.authHeader,
        params: params
      }
    ).pipe(
      catchError(() => {
        logger.error('Error fetching test data');
        return of({ results: [], total: 0 });
      }),
      map(result => result || { results: [], total: 0 })
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  getResourcePackages(workspaceId:number): Observable<ResourcePackageDto[]> {
    return this.http.get<ResourcePackageDto[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/resource-packages`,
      { headers: this.authHeader }
    ).pipe(
      catchError(() => of([]))
    );
  }

  deleteResourcePackages(workspaceId:number, ids: number[]): Observable<boolean> {
    const params = new HttpParams()
      .set('id', ids.join(','))
      .set('workspaceId', workspaceId);
    return this.http.delete(
      `${this.serverUrl}admin/workspace/${workspaceId}/resource-packages`,
      { headers: this.authHeader, params }
    ).pipe(
      catchError(() => of(false)),
      map(() => true)
    );
  }

  downloadResourcePackage(workspaceId:number, name: string): Observable<Blob> {
    return this.http.get(
      `${this.serverUrl}admin/workspace/${workspaceId}/resource-packages/${name}`,
      { headers: this.authHeader, responseType: 'blob' }
    ).pipe(
      catchError(() => of(new Blob([])))
    );
  }

  uploadResourcePackage(workspaceId:number, file: File): Observable<number> {
    const formData = new FormData();
    formData.append('resourcePackage', file);

    return this.http.post<number>(
      `${this.serverUrl}admin/workspace/${workspaceId}/resource-packages`,
      formData,
      { headers: this.authHeader }
    ).pipe(
      catchError(() => of(-1))
    );
  }

  getBaseVariables(): Observable<{ id: string; type: string; format: string; nullable: string }[]> {
    return this.http
      .get<{ id: string; type: string; format: string; nullable: string }[]>(
      `${this.serverUrl}admin/unit-xml-parser/base-variables`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of([]))
      );
  }
}
