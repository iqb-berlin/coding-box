import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  catchError,
  map,
  Observable,
  of,
  switchMap
} from 'rxjs';
import { FilesInListDto } from '../../../../../api-dto/files/files-in-list.dto';
import { FilesDto } from '../../../../../api-dto/files/files.dto';
import { FileValidationResultDto } from '../../../../../api-dto/files/file-validation-result.dto';
import { FileDownloadDto } from '../../../../../api-dto/files/file-download.dto';
import { SERVER_URL } from '../injection-tokens';

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

  validateFiles(workspace_id: number): Observable<boolean | FileValidationResultDto> {
    return this.http
      .get<FileValidationResultDto>(
      `${this.serverUrl}admin/workspace/${workspace_id}/files/validation`,
      { headers: this.authHeader })
      .pipe(
        catchError(() => of(false))
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

  uploadTestResults(
    workspaceId: number,
    files: FileList | null,
    resultType: 'logs' | 'responses',
    overwriteExisting: boolean = true
  ): Observable<number> {
    const formData = new FormData();
    if (files) {
      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
      }
    }
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/upload/results/${resultType}?overwriteExisting=${overwriteExisting}`;
    return this.http.post<never>(url, formData, {
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

  getUnitContentXml(workspaceId: number, unitId: number): Observable<string | null> {
    return this.http.get<{ content: string }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit/${unitId}/content`,
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
}
