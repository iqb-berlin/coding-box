import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AppLogoDto } from '../../../../../api-dto/app-logo-dto';

@Injectable({
  providedIn: 'root'
})
export class LogoService {
  private http = inject(HttpClient);
  private readonly serverUrl = inject<string>('SERVER_URL' as any);

  authHeader = { Authorization: `Bearer ${localStorage.getItem('id_token')}` };

  /**
   * Uploads a logo file to the server
   * @param file The logo file to upload
   * @returns An Observable with the path to the uploaded file
   */
  uploadLogo(file: File): Observable<{ path: string }> {
    const formData = new FormData();
    formData.append('logo', file);

    return this.http.post<{ path: string }>(`${this.serverUrl}/admin/logo/upload`, formData, { headers: this.authHeader });
  }

  /**
   * Deletes the custom logo and reverts to the default one
   * @returns An Observable with the success status
   */
  deleteLogo(): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.serverUrl}/admin/logo`, { headers: this.authHeader });
  }

  /**
   * Saves logo settings to the server
   * @param logoSettings The logo settings to save
   * @returns An Observable with the success status
   */
  saveLogoSettings(logoSettings: AppLogoDto): Observable<{ success: boolean }> {
    return this.http.put<{ success: boolean }>(`${this.serverUrl}/admin/logo/settings`, logoSettings, { headers: this.authHeader });
  }

  /**
   * Gets logo settings from the server
   * @returns An Observable with the logo settings
   */
  getLogoSettings(): Observable<AppLogoDto> {
    return this.http.get<AppLogoDto>(`${this.serverUrl}/admin/logo/settings`, { headers: this.authHeader });
  }
}
