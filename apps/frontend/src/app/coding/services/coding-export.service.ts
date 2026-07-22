import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  Observable, catchError, map, of, switchMap
} from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';
import { AppService, WorkspaceTokenPolicy } from '../../core/services/app.service';
import { CodeBookContentSetting } from '../../../../../../api-dto/coding/codebook-content-setting';
import {
  DEFAULT_EXTERNAL_REPLAY_TOKEN_DURATION_DAYS,
  EXTERNAL_REPLAY_WORKSPACE_TOKEN_SCOPES
} from '../../core/services/auth-session.config';
import { WorkspaceSettingsService } from '../../ws-admin/services/workspace-settings.service';

@Injectable({
  providedIn: 'root'
})
export class CodingExportService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);
  private appService = inject(AppService);
  private workspaceSettingsService = inject(WorkspaceSettingsService);

  getCodingListAsCsv(workspace_id: number, trainingRequired?: boolean): Observable<Blob> {
    return this.getReplayExportAuthToken(
      workspace_id,
      true,
      () => this.createExternalReplayToken(workspace_id)
    ).pipe(
      switchMap(token => {
        let params = new HttpParams()
          .set('authToken', token)
          .set('serverUrl', window.location.origin);
        if (trainingRequired !== undefined) {
          params = params.set('trainingRequired', trainingRequired.toString());
        }
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

  getCodingListAsExcel(workspace_id: number, trainingRequired?: boolean): Observable<Blob> {
    return this.getReplayExportAuthToken(
      workspace_id,
      true,
      () => this.createExternalReplayToken(workspace_id)
    ).pipe(
      switchMap(token => {
        let params = new HttpParams()
          .set('authToken', token)
          .set('serverUrl', window.location.origin);
        if (trainingRequired !== undefined) {
          params = params.set('trainingRequired', trainingRequired.toString());
        }
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

  getCodingResultsByVersion(
    workspace_id: number,
    version: 'v1' | 'v2' | 'v3',
    includeReplayUrls: boolean = false,
    includeResponseValues: boolean = true,
    includeGeoGebraResponseValues: boolean = false,
    missingsProfileId?: number
  ): Observable<Blob> {
    return this.getReplayExportAuthToken(
      workspace_id,
      includeReplayUrls,
      () => this.createExternalReplayToken(workspace_id)
    ).pipe(
      switchMap(token => {
        let params = new HttpParams()
          .set('authToken', token)
          .set('serverUrl', window.location.origin)
          .set('version', version)
          .set('includeReplayUrls', includeReplayUrls ? 'true' : 'false')
          .set('includeResponseValues', includeResponseValues ? 'true' : 'false')
          .set('includeGeoGebraResponseValues', includeGeoGebraResponseValues ? 'true' : 'false');
        if (version === 'v1' && missingsProfileId !== undefined) {
          params = params.set('missingsProfileId', missingsProfileId.toString());
        }
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

  getCodingResultsByVersionAsExcel(
    workspace_id: number,
    version: 'v1' | 'v2' | 'v3',
    includeReplayUrls: boolean = false,
    includeResponseValues: boolean = true,
    includeGeoGebraFiles: boolean = false,
    includeGeoGebraResponseValues: boolean = false,
    missingsProfileId?: number
  ): Observable<Blob> {
    return this.getReplayExportAuthToken(
      workspace_id,
      includeReplayUrls,
      () => this.createExternalReplayToken(workspace_id)
    ).pipe(
      switchMap(token => {
        let params = new HttpParams()
          .set('authToken', token)
          .set('serverUrl', window.location.origin)
          .set('version', version)
          .set('includeReplayUrls', includeReplayUrls ? 'true' : 'false')
          .set('includeResponseValues', includeResponseValues ? 'true' : 'false')
          .set('includeGeoGebraFiles', includeGeoGebraFiles ? 'true' : 'false')
          .set('includeGeoGebraResponseValues', includeGeoGebraResponseValues ? 'true' : 'false');
        if (version === 'v1' && missingsProfileId !== undefined) {
          params = params.set('missingsProfileId', missingsProfileId.toString());
        }
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
      progressPhase?: 'preparing' | 'counting' | 'writing' | 'finalizing' | 'completed';
      processedRows?: number;
      totalRows?: number;
      progressMessage?: string;
      result?: {
        fileId: string;
        fileName: string;
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
      progressPhase?: 'preparing' | 'counting' | 'writing' | 'finalizing' | 'completed';
      processedRows?: number;
      totalRows?: number;
      progressMessage?: string;
      result?: {
        fileId: string;
        fileName: string;
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

  startExportJob(
    workspaceId: number,
    exportType: string,
    version?: 'v1' | 'v2' | 'v3',
    format?: 'csv' | 'json' | 'excel',
    includeReplayUrls: boolean = false,
    trainingRequired?: boolean,
    includeResponseValues: boolean = true,
    includeGeoGebraFiles: boolean = false,
    includeGeoGebraResponseValues: boolean = false,
    missingsProfileId?: number
  ): Observable<{ jobId: string; message: string }> {
    const authToken$ = this.getReplayExportAuthToken(
      workspaceId,
      exportType === 'coding-list' || includeReplayUrls,
      () => this.createExternalReplayToken(workspaceId)
    );

    return authToken$.pipe(
      switchMap(token => {
        const payload = {
          exportType,
          version,
          format,
          includeReplayUrl: includeReplayUrls,
          includeResponseValues,
          includeGeoGebraFiles,
          includeGeoGebraResponseValues,
          missingsProfileId,
          trainingRequired,
          authToken: token,
          serverUrl: window.location.origin
        };

        return this.http.post<{ jobId: string; message: string }>(
          `${this.serverUrl}admin/workspace/${workspaceId}/coding/export/start`,
          payload
        );
      })
    );
  }

  private getReplayExportAuthToken(
    workspaceId: number,
    includeReplayUrls: boolean,
    createToken: () => Observable<string>
  ): Observable<string> {
    if (!includeReplayUrls) {
      return of('');
    }

    return this.workspaceSettingsService.getReplayUrlExportMode(workspaceId)
      .pipe(
        switchMap(mode => (mode === 'auth' ? createToken() : of('')))
      );
  }

  private createExternalReplayToken(workspaceId: number): Observable<string> {
    return this.appService.getWorkspaceTokenPolicy().pipe(
      map(policy => this.getExternalReplayTokenMaxDurationDays(policy)),
      switchMap(maxDurationDays => this.workspaceSettingsService.getReplayUrlExportTokenDurationDays(
        workspaceId,
        maxDurationDays
      )),
      switchMap(durationDays => this.appService.createOwnToken(
        workspaceId,
        durationDays,
        EXTERNAL_REPLAY_WORKSPACE_TOKEN_SCOPES
      ))
    );
  }

  private getExternalReplayTokenMaxDurationDays(policy: WorkspaceTokenPolicy): number {
    const maxDurations = EXTERNAL_REPLAY_WORKSPACE_TOKEN_SCOPES
      .map(scope => policy.scopes[scope]?.maxDurationDays)
      .filter((duration): duration is number => Number.isInteger(duration) && duration >= 1);

    return maxDurations.length ?
      Math.min(...maxDurations) :
      DEFAULT_EXTERNAL_REPLAY_TOKEN_DURATION_DAYS;
  }

  getExportJobStatus(
    workspaceId: number,
    jobId: string
  ): Observable<{
      status: string;
      progress: number;
      result?: {
        fileId: string;
        fileName: string;
        fileSize: number;
        workspaceId: number;
        userId: number;
        exportType: string;
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
        fileSize: number;
        workspaceId: number;
        userId: number;
        exportType: string;
        createdAt: number;
      };
      error?: string;
    }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/export/job/${jobId}`
    );
  }

  downloadExportFile(workspaceId: number, jobId: string): Observable<Blob> {
    return this.http.get(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/export/job/${jobId}/download`,
      {
        responseType: 'blob'
      }
    );
  }

  cancelExportJob(
    workspaceId: number,
    jobId: string
  ): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/export/job/${jobId}/cancel`,
      {}
    );
  }
}
