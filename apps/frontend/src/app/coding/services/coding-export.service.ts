import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  Observable, catchError, of, switchMap
} from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';
import { AppService } from '../../core/services/app.service';
import { CodeBookContentSetting } from '../../../../../../api-dto/coding/codebook-content-setting';

@Injectable({
  providedIn: 'root'
})
export class CodingExportService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);
  private appService = inject(AppService);

  getCodingListAsCsv(workspace_id: number): Observable<Blob> {
    const identity = this.appService.loggedUser?.sub || '';
    return this.appService.createToken(workspace_id, identity, 60).pipe(
      catchError(() => of('')),
      switchMap(token => {
        const params = new HttpParams()
          .set('authToken', token)
          .set('serverUrl', window.location.origin);
        return this.http.get(
          `${this.serverUrl}admin/workspace/${workspace_id}/coding/coding-list`,
          {
            params,
            responseType: 'blob' as 'json'
          }
        ) as unknown as Observable<Blob>;
      })
    );
  }

  getCodingListAsExcel(workspace_id: number): Observable<Blob> {
    const identity = this.appService.loggedUser?.sub || '';
    return this.appService.createToken(workspace_id, identity, 60).pipe(
      catchError(() => of('')),
      switchMap(token => {
        const params = new HttpParams()
          .set('authToken', token)
          .set('serverUrl', window.location.origin);
        return this.http.get(
          `${this.serverUrl}admin/workspace/${workspace_id}/coding/coding-list/excel`,
          {
            params,
            responseType: 'blob' as 'json'
          }
        ) as unknown as Observable<Blob>;
      })
    );
  }

  getCodingResultsByVersion(workspace_id: number, version: 'v1' | 'v2' | 'v3', includeReplayUrls: boolean = false): Observable<Blob> {
    const identity = this.appService.loggedUser?.sub || '';
    return this.appService.createToken(workspace_id, identity, 60).pipe(
      catchError(() => of('')),
      switchMap(token => {
        const params = new HttpParams()
          .set('authToken', token)
          .set('serverUrl', window.location.origin)
          .set('version', version)
          .set('includeReplayUrls', includeReplayUrls ? 'true' : 'false');
        return this.http.get(
          `${this.serverUrl}admin/workspace/${workspace_id}/coding/results-by-version`,
          {
            params,
            responseType: 'blob' as 'json'
          }
        ) as unknown as Observable<Blob>;
      })
    );
  }

  getCodingResultsByVersionAsExcel(workspace_id: number, version: 'v1' | 'v2' | 'v3', includeReplayUrls: boolean = false): Observable<Blob> {
    const identity = this.appService.loggedUser?.sub || '';
    return this.appService.createToken(workspace_id, identity, 60).pipe(
      catchError(() => of('')),
      switchMap(token => {
        const params = new HttpParams()
          .set('authToken', token)
          .set('serverUrl', window.location.origin)
          .set('version', version)
          .set('includeReplayUrls', includeReplayUrls ? 'true' : 'false');
        return this.http.get(
          `${this.serverUrl}admin/workspace/${workspace_id}/coding/results-by-version/excel`,
          {
            params,
            responseType: 'blob' as 'json'
          }
        ) as unknown as Observable<Blob>;
      })
    );
  }

  getCodingBook(
    workspaceId: number,
    missingsProfile: string,
    contentOptions: CodeBookContentSetting,
    unitList: number[]
  ): Observable<Blob | null> {
    const payload = {
      missingsProfile,
      contentOptions,
      unitList: Array.isArray(unitList) ? unitList : [unitList]
    };

    return this.http
      .post(
        `${this.serverUrl}admin/workspace/${workspaceId}/coding/codebook`,
        payload,
        {
          responseType: 'blob'
        }
      )
      .pipe(
        catchError(() => of(null))
      );
  }

  startCodebookJob(
    workspaceId: number,
    missingsProfile: string,
    contentOptions: CodeBookContentSetting,
    unitList: number[]
  ): Observable<{ jobId: string; message: string }> {
    const payload = {
      missingsProfile,
      contentOptions,
      unitList: Array.isArray(unitList) ? unitList : [unitList]
    };

    return this.http.post<{ jobId: string; message: string }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/codebook/job`,
      payload
    );
  }

  getCodebookJobStatus(
    workspaceId: number,
    jobId: string
  ): Observable<{
      status: string;
      progress: number;
      result?: {
        fileId: string;
        fileName: string;
        filePath: string;
        fileSize: number;
        workspaceId: number;
        exportFormat: string;
        createdAt: number;
      };
      error?: string;
    }> {
    return this.http.get<{
      status: string;
      progress: number;
      result?: {
        fileId: string;
        fileName: string;
        filePath: string;
        fileSize: number;
        workspaceId: number;
        exportFormat: string;
        createdAt: number;
      };
      error?: string;
    }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/codebook/job/${jobId}`
    );
  }

  downloadCodebookFile(workspaceId: number, jobId: string): Observable<Blob> {
    return this.http.get(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/codebook/job/${jobId}/download`,
      {
        responseType: 'blob'
      }
    );
  }
}
