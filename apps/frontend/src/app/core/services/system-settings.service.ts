import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';
import {
  ContentPoolConnectionTestRequest,
  ContentPoolConnectionTestResponse,
  ContentPoolSettings,
  ContentPoolSettingsUpdate
} from '../../ws-admin/models/content-pool.model';
import { LegalNoticeDto, UpdateLegalNoticeDto } from '../../../../../../api-dto/legal-notice/legal-notice.dto';

@Injectable({
  providedIn: 'root'
})
export class SystemSettingsService {
  private readonly http = inject(HttpClient);

  private readonly serverUrl = inject(SERVER_URL);

  private get authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('auth_token')}` };
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
    settings: ContentPoolSettingsUpdate
  ): Observable<ContentPoolSettings> {
    return this.http.put<ContentPoolSettings>(
      `${this.serverUrl}admin/content-pool/settings`,
      settings,
      {
        headers: this.authHeader
      }
    );
  }

  testContentPoolConnection(
    settings: ContentPoolConnectionTestRequest
  ): Observable<ContentPoolConnectionTestResponse> {
    return this.http.post<ContentPoolConnectionTestResponse>(
      `${this.serverUrl}admin/content-pool/settings/test`,
      settings,
      {
        headers: this.authHeader
      }
    );
  }

  getLegalNotice(): Observable<LegalNoticeDto> {
    return this.http.get<LegalNoticeDto>(
      `${this.serverUrl}legal-notice`
    );
  }

  updateLegalNotice(
    legalNotice: UpdateLegalNoticeDto
  ): Observable<LegalNoticeDto> {
    return this.http.put<LegalNoticeDto>(
      `${this.serverUrl}legal-notice`,
      legalNotice,
      {
        headers: this.authHeader
      }
    );
  }

  resetLegalNotice(): Observable<LegalNoticeDto> {
    return this.http.delete<LegalNoticeDto>(
      `${this.serverUrl}legal-notice`,
      {
        headers: this.authHeader
      }
    );
  }
}
