import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';
import { ContentPoolSettings } from '../../ws-admin/models/content-pool.model';

@Injectable({
  providedIn: 'root'
})
export class SystemSettingsService {
  private readonly http = inject(HttpClient);

  private readonly serverUrl = inject(SERVER_URL);

  private get authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('id_token')}` };
  }

  getContentPoolSettings(): Observable<ContentPoolSettings> {
    return this.http.get<ContentPoolSettings>(
      `${this.serverUrl}admin/content-pool/settings`,
      {
        headers: this.authHeader
      }
    );
  }

  updateContentPoolSettings(
    settings: ContentPoolSettings
  ): Observable<ContentPoolSettings> {
    return this.http.put<ContentPoolSettings>(
      `${this.serverUrl}admin/content-pool/settings`,
      settings,
      {
        headers: this.authHeader
      }
    );
  }
}
