import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of } from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';
import { MissingsProfilesDto } from '../../../../../../api-dto/coding/missings-profiles.dto';

@Injectable({
  providedIn: 'root'
})
export class MissingsProfileService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  getMissingsProfiles(workspaceId: number): Observable<{ label: string; id: number }[]> {
    return this.http
      .get<{ label: string; id: number }[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/missings-profiles`,
      {}
    )
      .pipe(
        catchError(() => of([]))
      );
  }

  getMissingsProfileDetails(workspaceId: number, id: string | number): Observable<MissingsProfilesDto | null> {
    return this.http
      .get<MissingsProfilesDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/missings-profiles/${id}`,
      {}
    )
      .pipe(
        catchError(() => of(null))
      );
  }

  createMissingsProfile(workspaceId: number, profile: MissingsProfilesDto): Observable<MissingsProfilesDto | null> {
    return this.http
      .post<MissingsProfilesDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/missings-profiles`,
      profile,
      {}
    )
      .pipe(
        catchError(() => of(null))
      );
  }

  updateMissingsProfile(workspaceId: number, label: string, profile: MissingsProfilesDto): Observable<MissingsProfilesDto | null> {
    return this.http
      .put<MissingsProfilesDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/missings-profiles/${encodeURIComponent(label)}`,
      profile,
      {}
    )
      .pipe(
        catchError(() => of(null))
      );
  }

  deleteMissingsProfile(workspaceId: number, label: string): Observable<boolean> {
    return this.http
      .delete<boolean>(
      `${this.serverUrl}admin/workspace/${workspaceId}/missings-profiles/${encodeURIComponent(label)}`,
      {}
    )
      .pipe(
        catchError(() => of(false))
      );
  }
}
