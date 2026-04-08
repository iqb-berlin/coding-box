import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';
import { ProcessDto } from '../../../../../../api-dto/workspaces/process-dto';

@Injectable({
  providedIn: 'root'
})
export class WorkspaceProcessesService {
  private http = inject(HttpClient);
  private rawServerUrl = inject(SERVER_URL);

  private get serverUrl(): string {
    return this.rawServerUrl.endsWith('/') ? this.rawServerUrl.slice(0, -1) : this.rawServerUrl;
  }

  getProcesses(workspaceId: number): Observable<ProcessDto[]> {
    return this.http.get<ProcessDto[]>(`${this.serverUrl}/admin/workspace/${workspaceId}/processes`);
  }

  deleteProcess(workspaceId: number, queueName: string, id: string): Observable<boolean> {
    return this.http.delete<boolean>(`${this.serverUrl}/admin/workspace/${workspaceId}/processes/${queueName}/${id}`);
  }
}
