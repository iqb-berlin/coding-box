import { Inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class LogoService {
  constructor(private http: HttpClient, @Inject('SERVER_URL') private readonly serverUrl: string
  ) {}

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
}
