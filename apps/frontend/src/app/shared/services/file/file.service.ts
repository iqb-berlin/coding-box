import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  catchError,
  map,
  Observable,
  of,
  switchMap, throwError
} from 'rxjs';
import { VariableInfo } from '@iqbspecs/variable-info/variable-info.interface';
import { FilesInListDto } from '../../../../../../../api-dto/files/files-in-list.dto';
import { FilesDto } from '../../../../../../../api-dto/files/files.dto';
import { FileValidationResultDto } from '../../../../../../../api-dto/files/file-validation-result.dto';
import { FileDownloadDto } from '../../../../../../../api-dto/files/file-download.dto';
import { TestFilesUploadResultDto } from '../../../../../../../api-dto/files/test-files-upload-result.dto';
import { TestResultsUploadResultDto } from '../../../../../../../api-dto/files/test-results-upload-result.dto';
import { TestResultsUploadJobDto } from '../../../../../../../api-dto/files/test-results-upload-job.dto';
import { BookletInfoDto } from '../../../../../../../api-dto/booklet-info/booklet-info.dto';
import { UnitInfoDto } from '../../../../../../../api-dto/unit-info/unit-info.dto';
import { SERVER_URL } from '../../../injection-tokens';

export interface BookletUnit {
  id: number;
  name: string;
  alias: string | null;
  bookletId: number;
}

export interface GithubReleaseShort {
  version: string;
  url: string;
  name: string;
  published_at: string;
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

@Injectable({
  providedIn: 'root'
})
export class FileService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  get authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('id_token')}` };
  }

  getDirectDownloadLink(): string {
    return `${this.serverUrl}packages/`;
  }

  getFilesList(
    workspaceId: number,
    page: number = 1,
    limit: number = 10000,
    fileType?: string,
    fileSize?: string,
    searchText?: string
  ): Observable<PaginatedResponse<FilesInListDto> & { fileTypes: string[] }> {
    let params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString());
    if (fileType) params = params.set('fileType', fileType);
    if (fileSize) params = params.set('fileSize', fileSize);
    if (searchText) params = params.set('searchText', searchText);

    return this.http.get<PaginatedResponse<FilesInListDto> & { fileTypes: string[] }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/files`,
      { headers: this.authHeader, params }
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
          params: { fileIds: batch.join(',') }
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

  validateFiles(workspace_id: number): Observable<boolean | FileValidationResultDto> {
    return this.http
      .get<FileValidationResultDto>(
      `${this.serverUrl}admin/workspace/${workspace_id}/files/validation`,
      { headers: this.authHeader })
      .pipe(
        catchError(() => of(false))
      );
  }

  uploadTestFiles(
    workspaceId: number,
    files: FileList | FormData | null,
    overwriteExisting: boolean = false,
    overwriteFileIds?: string[]
  ): Observable<TestFilesUploadResultDto> {
    let formData: FormData;

    if (files instanceof FormData) {
      formData = files;
    } else {
      formData = new FormData();
      if (files) {
        for (let i = 0; i < files.length; i++) {
          formData.append('files', files[i]);
        }
      }
    }

    const overwriteIdsQuery = (overwriteFileIds && overwriteFileIds.length > 0) ?
      `&overwriteFileIds=${encodeURIComponent(overwriteFileIds.join(','))}` :
      '';
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/upload?overwriteExisting=${overwriteExisting}${overwriteIdsQuery}`;
    return this.http.post<TestFilesUploadResultDto>(url, formData, {
      headers: this.authHeader
    });
  }

  uploadTestResults(
    workspaceId: number,
    files: FileList | null,
    resultType: 'logs' | 'responses',
    overwriteExisting: boolean = true,
    overwriteMode: 'skip' | 'merge' | 'replace' = 'skip',
    scope: string = 'person',
    filters?: { groupName?: string; bookletName?: string; unitNameOrAlias?: string; variableId?: string; subform?: string }
  ): Observable<TestResultsUploadJobDto[]> {
    const formData = new FormData();
    if (files) {
      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
      }
    }
    const q = new URLSearchParams();
    q.set('overwriteExisting', String(overwriteExisting));
    q.set('overwriteMode', overwriteMode);
    q.set('scope', scope);
    if (filters?.groupName) q.set('groupName', filters.groupName);
    if (filters?.bookletName) q.set('bookletName', filters.bookletName);
    if (filters?.unitNameOrAlias) q.set('unitNameOrAlias', filters.unitNameOrAlias);
    if (filters?.variableId) q.set('variableId', filters.variableId);
    if (filters?.subform) q.set('subform', filters.subform);
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/upload/results/${resultType}?${q.toString()}`;
    return this.http.post<TestResultsUploadJobDto[]>(url, formData, {
      headers: this.authHeader
    });
  }

  getUploadJobStatus(workspaceId: number, jobId: string): Observable<{
    id: string;
    status: 'completed' | 'waiting' | 'active' | 'delayed' | 'failed' | 'paused';
    progress: number;
    result?: TestResultsUploadResultDto;
    error?: unknown;
  }> {
    return this.http.get<{
      id: string;
      status: 'completed' | 'waiting' | 'active' | 'delayed' | 'failed' | 'paused';
      progress: number;
      result?: TestResultsUploadResultDto;
      error?: unknown;
    }>(`${this.serverUrl}admin/workspace/${workspaceId}/upload/status/${jobId}`, {
      headers: this.authHeader
    });
  }

  getUnitDef(workspaceId: number, unit: string, authToken?: string): Observable<FilesDto[]> {
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : this.authHeader;
    return this.http.get<FilesDto[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/${unit}/unitDef`,
      { headers });
  }

  getPlayer(workspaceId: number, player: string, authToken?: string): Observable<FilesDto[]> {
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : this.authHeader;
    return this.http.get<FilesDto[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/player/${player}`,
      { headers });
  }

  getUnit(workspaceId: number,
          unitId: string,
          authToken?: string
  ): Observable<FilesDto[]> {
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : this.authHeader;
    return this.http.get<FilesDto[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit/${unitId}`,
      { headers });
  }

  getUnitContentXml(workspaceId: number, unitId: string): Observable<string | null> {
    return this.http.get<{ content: string }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit/${unitId}/content`,
      { headers: this.authHeader }
    ).pipe(
      map(response => response.content),
      catchError(() => of(null))
    );
  }

  getTestTakerContentXml(workspaceId: number, testTakerId: string): Observable<string | null> {
    return this.http.get<{ content: string }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/files/testtakers/${testTakerId}/content`,
      { headers: this.authHeader }
    ).pipe(
      map(response => response.content),
      catchError(() => of(null))
    );
  }

  getCodingSchemeFile(workspaceId: number, codingSchemeRef: string): Observable<FileDownloadDto | null> {
    return this.http.get<FileDownloadDto | null>(
      `${this.serverUrl}admin/workspace/${workspaceId}/files/coding-scheme/${codingSchemeRef}`,
      { headers: this.authHeader }
    ).pipe(
      catchError(() => of(null))
    );
  }

  createDummyTestTakerFile(workspaceId: number): Observable<boolean> {
    return this.http.post<boolean>(
      `${this.serverUrl}admin/workspace/${workspaceId}/files/create-dummy-testtaker`,
      {},
      { headers: this.authHeader }
    ).pipe(
      catchError(() => of(false))
    );
  }

  getBookletUnits(workspaceId: number, bookletId: string, authToken?: string): Observable<BookletUnit[]> {
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : this.authHeader;
    return this.http.get<BookletUnit[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/booklet/${bookletId}/units`,
      { headers }
    ).pipe(
      catchError(() => of([]))
    );
  }

  getBookletInfo(workspaceId: number, bookletId: string, authToken?: string): Observable<BookletInfoDto> {
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : this.authHeader;
    return this.http.get<BookletInfoDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/booklet/${bookletId}/info`,
      { headers }
    ).pipe(
      catchError(error => throwError(() => error))
    );
  }

  getUnitInfo(workspaceId: number, unitId: string, authToken?: string): Observable<UnitInfoDto> {
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : this.authHeader;
    return this.http.get<UnitInfoDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit/${unitId}/info`,
      { headers }
    ).pipe(
      catchError(error => throwError(() => error))
    );
  }

  getUnitsWithFileIds(workspaceId: number): Observable<{ id: number; unitId: string; fileName: string; data: string }[]> {
    return this.http.get<{ id: number; unitId: string; fileName: string; data: string }[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/files/units-with-file-ids`,
      { headers: this.authHeader }
    ).pipe(
      catchError(() => of([]))
    );
  }

  getVariableInfoForScheme(workspaceId: number, schemeFileId: string): Observable<VariableInfo[]> {
    return this.http.get<VariableInfo[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/files/variable-info/${schemeFileId}`,
      { headers: this.authHeader }
    ).pipe(
      catchError(() => of([]))
    );
  }

  getItemIdsFromMetadata(workspaceId: number): Observable<{ fileId: string; id: number; items: string[] }[]> {
    return this.http.get<{ fileId: string; id: number; items: string[] }[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/files/item-ids`,
      { headers: this.authHeader }
    ).pipe(
      catchError(() => of([]))
    );
  }

  getGithubReleases(workspaceId: number, type: 'aspect-player' | 'schemer'): Observable<GithubReleaseShort[]> {
    return this.http.get<GithubReleaseShort[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/github/releases/${type}`,
      { headers: this.authHeader }
    );
  }

  installGithubRelease(workspaceId: number, url: string): Observable<boolean> {
    return this.http.post<boolean>(
      `${this.serverUrl}admin/workspace/${workspaceId}/github/install`,
      { url },
      { headers: this.authHeader }
    );
  }
}
