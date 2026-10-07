import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { WorkspaceAdmin } from '../../shared/models/test-center-authentication.model';
import { SERVER_URL } from '../../injection-tokens';

export interface ServerResponse {
  success: boolean;
  token?: string;
  message?: string;
  claims?: {
    workspaceAdmin: WorkspaceAdmin[];
  };
}

@Injectable({
  providedIn: 'root'
})
export class AuthenticationService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  authenticate(username: string, password: string, server: string, url: string): Observable<ServerResponse> {
    return this.http
      .post<ServerResponse>(`${this.serverUrl}tc_authentication`, {
        username, password, server, url
      });
  }
}
