import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, timer } from 'rxjs';
import { switchMap, takeWhile } from 'rxjs/operators';
import { SERVER_URL } from '../../injection-tokens';
import {
  ContentPoolAcpListResponse,
  ContentPoolImportAcpProgress,
  ContentPoolImportAcpRequest,
  ContentPoolImportAcpResponse,
  ContentPoolImportAcpStartResponse,
  ContentPoolSettings,
  ContentPoolUploadFilesProgress,
  ContentPoolUploadFilesRequest,
  ContentPoolUploadFilesStartResponse
} from '../models/content-pool.model';

@Injectable({
  providedIn: 'root'
})
export class ContentPoolIntegrationService {
  private readonly http = inject(HttpClient);

  private readonly serverUrl = inject(SERVER_URL);

  private get authHeader() {
    return {};
  }

  getWorkspaceConfig(workspaceId: number): Observable<ContentPoolSettings> {
    return this.http.get<ContentPoolSettings>(
      `${this.serverUrl}admin/workspace/${workspaceId}/content-pool/config`,
      { headers: this.authHeader }
    );
  }

  listAccessibleAcps(workspaceId: number): Observable<ContentPoolAcpListResponse> {
    return this.http.post<ContentPoolAcpListResponse>(
      `${this.serverUrl}admin/workspace/${workspaceId}/content-pool/acps`,
      {},
      { headers: this.authHeader }
    );
  }

  importAcp(
    workspaceId: number,
    request: ContentPoolImportAcpRequest
  ): Observable<ContentPoolImportAcpResponse> {
    return this.http.post<ContentPoolImportAcpResponse>(
      `${this.serverUrl}admin/workspace/${workspaceId}/content-pool/import-acp`,
      request,
      { headers: this.authHeader }
    );
  }

  startImportAcp(
    workspaceId: number,
    request: ContentPoolImportAcpRequest
  ): Observable<ContentPoolImportAcpStartResponse> {
    return this.http.post<ContentPoolImportAcpStartResponse>(
      `${this.serverUrl}admin/workspace/${workspaceId}/content-pool/import-acp/start`,
      request,
      { headers: this.authHeader }
    );
  }

  getImportAcpProgress(
    workspaceId: number,
    jobId: string
  ): Observable<ContentPoolImportAcpProgress> {
    return this.http.get<ContentPoolImportAcpProgress>(
      `${this.serverUrl}admin/workspace/${workspaceId}/content-pool/import-acp/${jobId}/progress`,
      { headers: this.authHeader }
    );
  }

  importAcpWithProgress(
    workspaceId: number,
    request: ContentPoolImportAcpRequest,
    pollIntervalMs = 500
  ): Observable<ContentPoolImportAcpProgress> {
    return this.startImportAcp(workspaceId, request).pipe(
      switchMap(({ jobId }) => timer(0, pollIntervalMs).pipe(
        switchMap(() => this.getImportAcpProgress(workspaceId, jobId)),
        takeWhile(
          progress => (
            progress.status === 'pending' ||
            progress.status === 'running'
          ),
          true
        )
      ))
    );
  }

  startUploadFilesToAcp(
    workspaceId: number,
    request: ContentPoolUploadFilesRequest
  ): Observable<ContentPoolUploadFilesStartResponse> {
    return this.http.post<ContentPoolUploadFilesStartResponse>(
      `${this.serverUrl}admin/workspace/${workspaceId}/content-pool/upload-files/start`,
      request,
      { headers: this.authHeader }
    );
  }

  getUploadFilesToAcpProgress(
    workspaceId: number,
    jobId: string
  ): Observable<ContentPoolUploadFilesProgress> {
    return this.http.get<ContentPoolUploadFilesProgress>(
      `${this.serverUrl}admin/workspace/${workspaceId}/content-pool/upload-files/${jobId}/progress`,
      { headers: this.authHeader }
    );
  }

  uploadFilesToAcpWithProgress(
    workspaceId: number,
    request: ContentPoolUploadFilesRequest,
    pollIntervalMs = 500
  ): Observable<ContentPoolUploadFilesProgress> {
    return this.startUploadFilesToAcp(workspaceId, request).pipe(
      switchMap(({ jobId }) => timer(0, pollIntervalMs).pipe(
        switchMap(() => this.getUploadFilesToAcpProgress(workspaceId, jobId)),
        takeWhile(
          progress => (
            progress.status === 'pending' ||
            progress.status === 'running'
          ),
          true
        )
      ))
    );
  }
}
