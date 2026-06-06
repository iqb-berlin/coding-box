import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpEvent } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SERVER_URL } from '../../../injection-tokens';
import { UnitVariableDetailsDto } from '../../../models/unit-variable-details.dto';
import { FilesDto } from '../../../../../../../api-dto/files/files.dto';

@Injectable({
  providedIn: 'root'
})
export class FileBackendService {
  private readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  getVocs(workspaceId: number, vocs: string): Observable<FilesDto[]> {
    return this.http.get<FilesDto[]>(`${this.serverUrl}admin/workspace/${workspaceId}/vocs/${vocs}`, {});
  }

  downloadWorkspaceFilesAsZip(
    workspaceId: number,
    fileTypes?: string[]
  ): Observable<Blob> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/files/download-zip`;
    const body = fileTypes && fileTypes.length > 0 ? { fileTypes } : {};
    return this.http.post(url, body, {
      responseType: 'blob'
    });
  }

  downloadWorkspaceFilesAsZipWithProgress(
    workspaceId: number,
    fileTypes?: string[]
  ): Observable<HttpEvent<Blob>> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/files/download-zip`;
    const body = fileTypes && fileTypes.length > 0 ? { fileTypes } : {};
    return this.http.post(url, body, {
      responseType: 'blob',
      reportProgress: true,
      observe: 'events'
    });
  }

  getUnitVariables(workspaceId: number): Observable<UnitVariableDetailsDto[]> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/files/unit-variables`;
    return this.http.get<UnitVariableDetailsDto[]>(url, {});
  }

  getReplayAnchorOverrides(workspaceId: number): Observable<ReplayAnchorOverride[]> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/files/replay-anchor-overrides`;
    return this.http.get<ReplayAnchorOverride[]>(url, {});
  }

  saveReplayAnchorOverride(
    workspaceId: number,
    override: ReplayAnchorOverride
  ): Observable<ReplayAnchorOverride> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/files/replay-anchor-overrides`;
    return this.http.put<ReplayAnchorOverride>(url, override);
  }

  deleteReplayAnchorOverride(
    workspaceId: number,
    unitName: string,
    variableId: string
  ): Observable<{ deleted: boolean }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/files/replay-anchor-overrides`;
    return this.http.delete<{ deleted: boolean }>(url, {
      params: { unitName, variableId }
    });
  }
}

export interface ReplayAnchorOverride {
  unitName: string;
  variableId: string;
  replayAnchor: string;
}
