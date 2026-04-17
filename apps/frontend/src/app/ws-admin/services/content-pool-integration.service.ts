import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';
import {
  ContentPoolAcpListResponse,
  ContentPoolReplaceCodingSchemeRequest,
  ContentPoolReplaceCodingSchemeResponse,
  ContentPoolSettings
} from '../models/content-pool.model';

@Injectable({
  providedIn: 'root'
})
export class ContentPoolIntegrationService {
  private readonly http = inject(HttpClient);

  private readonly serverUrl = inject(SERVER_URL);

  private get authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('id_token')}` };
  }

  getWorkspaceConfig(workspaceId: number): Observable<ContentPoolSettings> {
    return this.http.get<ContentPoolSettings>(
      `${this.serverUrl}admin/workspace/${workspaceId}/content-pool/config`,
      { headers: this.authHeader }
    );
  }

  listAccessibleAcps(
    workspaceId: number,
    username: string,
    password: string
  ): Observable<ContentPoolAcpListResponse> {
    return this.http.post<ContentPoolAcpListResponse>(
      `${this.serverUrl}admin/workspace/${workspaceId}/content-pool/acps`,
      { username, password },
      { headers: this.authHeader }
    );
  }

  replaceCodingScheme(
    workspaceId: number,
    request: ContentPoolReplaceCodingSchemeRequest
  ): Observable<ContentPoolReplaceCodingSchemeResponse> {
    return this.http.post<ContentPoolReplaceCodingSchemeResponse>(
      `${this.serverUrl}admin/workspace/${workspaceId}/content-pool/replace-coding-scheme`,
      request,
      { headers: this.authHeader }
    );
  }
}
