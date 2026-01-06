import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SERVER_URL } from '../injection-tokens';
import { UnitVariableDetailsDto } from '../models/unit-variable-details.dto';
import { FilesDto } from '../../../../../api-dto/files/files.dto';

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

  getUnitVariables(workspaceId: number): Observable<UnitVariableDetailsDto[]> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/files/unit-variables`;
    return this.http.get<UnitVariableDetailsDto[]>(url, {});
  }
}
