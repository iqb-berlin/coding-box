import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpEvent, HttpParams } from '@angular/common/http';
import {
  catchError,
  map,
  Observable,
  of
} from 'rxjs';
import { ResourcePackageDto } from '../../../../../../../api-dto/resource-package/resource-package-dto';
import { SERVER_URL } from '../../../injection-tokens';

@Injectable({
  providedIn: 'root'
})
export class ResourcePackageService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  get authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('auth_token')}` };
  }

  getResourcePackages(workspaceId: number): Observable<ResourcePackageDto[]> {
    return this.http.get<ResourcePackageDto[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/resource-packages`,
      { headers: this.authHeader }
    );
  }

  deleteResourcePackages(workspaceId: number, ids: number[]): Observable<boolean> {
    const params = new HttpParams()
      .set('id', ids.join(','))
      .set('workspaceId', workspaceId);
    return this.http.delete(
      `${this.serverUrl}admin/workspace/${workspaceId}/resource-packages`,
      { headers: this.authHeader, params }
    ).pipe(
      map(() => true),
      catchError(() => of(false))
    );
  }

  downloadResourcePackage(workspaceId: number, name: string): Observable<Blob> {
    return this.http.get(
      `${this.serverUrl}admin/workspace/${workspaceId}/resource-packages/${name}`,
      { headers: this.authHeader, responseType: 'blob' }
    );
  }

  downloadResourcePackageWithProgress(workspaceId: number, name: string): Observable<HttpEvent<Blob>> {
    return this.http.get(
      `${this.serverUrl}admin/workspace/${workspaceId}/resource-packages/${name}`,
      {
        headers: this.authHeader,
        responseType: 'blob',
        reportProgress: true,
        observe: 'events'
      }
    );
  }

  uploadResourcePackage(workspaceId: number, file: File): Observable<number> {
    const formData = new FormData();
    formData.append('resourcePackage', file);

    return this.http.post<number>(
      `${this.serverUrl}admin/workspace/${workspaceId}/resource-packages`,
      formData,
      { headers: this.authHeader }
    ).pipe(
      catchError(() => of(-1))
    );
  }

  uploadResourcePackageWithProgress(workspaceId: number, file: File): Observable<HttpEvent<number>> {
    const formData = new FormData();
    formData.append('resourcePackage', file);

    return this.http.post<number>(
      `${this.serverUrl}admin/workspace/${workspaceId}/resource-packages`,
      formData,
      {
        headers: this.authHeader,
        reportProgress: true,
        observe: 'events'
      }
    );
  }

  installGeoGebraPackage(workspaceId: number): Observable<HttpEvent<ResourcePackageDto>> {
    return this.http.post<ResourcePackageDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/resource-packages/geogebra/install`,
      {},
      {
        headers: this.authHeader,
        reportProgress: true,
        observe: 'events'
      }
    );
  }
}
