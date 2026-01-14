import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
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
    return { Authorization: `Bearer ${localStorage.getItem('id_token')}` };
  }

  getResourcePackages(workspaceId: number): Observable<ResourcePackageDto[]> {
    return this.http.get<ResourcePackageDto[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/resource-packages`,
      { headers: this.authHeader }
    ).pipe(
      catchError(() => of([]))
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
      catchError(() => of(false)),
      map(() => true)
    );
  }

  downloadResourcePackage(workspaceId: number, name: string): Observable<Blob> {
    return this.http.get(
      `${this.serverUrl}admin/workspace/${workspaceId}/resource-packages/${name}`,
      { headers: this.authHeader, responseType: 'blob' }
    ).pipe(
      catchError(() => of(new Blob([])))
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
}
