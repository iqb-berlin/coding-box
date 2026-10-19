import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';

interface CodingAssignmentResponse {
  total?: number;
  data?: unknown[];
}

@Injectable({ providedIn: 'root' })
export class WorkspaceAccessService {
  private readonly http = inject(HttpClient);
  private readonly serverUrl = inject(SERVER_URL);

  hasAssignedCodingJobs(workspaceId: number): Observable<boolean> {
    const params = new HttpParams().set('limit', '1').set('assignedTo', 'me');
    return this.http.get<CodingAssignmentResponse>(
      `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job`,
      { params }
    ).pipe(map(response => (response.total ?? response.data?.length ?? 0) > 0));
  }
}
