import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  Observable
} from 'rxjs';
import { UnitTagDto } from '../../../../../api-dto/unit-tags/unit-tag.dto';
import { CreateUnitTagDto } from '../../../../../api-dto/unit-tags/create-unit-tag.dto';
import { UpdateUnitTagDto } from '../../../../../api-dto/unit-tags/update-unit-tag.dto';
import { SERVER_URL } from '../injection-tokens';

@Injectable({
  providedIn: 'root'
})
export class UnitTagService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  get authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('id_token')}` };
  }

  createUnitTag(workspaceId: number, createUnitTagDto: CreateUnitTagDto): Observable<UnitTagDto> {
    return this.http.post<UnitTagDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit-tags`,
      createUnitTagDto,
      { headers: this.authHeader });
  }

  getUnitTags(workspaceId: number, unitId: number): Observable<UnitTagDto[]> {
    return this.http.get<UnitTagDto[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit-tags/unit/${unitId}`,
      { headers: this.authHeader });
  }

  getUnitTag(workspaceId: number, tagId: number): Observable<UnitTagDto> {
    return this.http.get<UnitTagDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit-tags/${tagId}`,
      { headers: this.authHeader });
  }

  updateUnitTag(workspaceId: number, tagId: number, updateUnitTagDto: UpdateUnitTagDto): Observable<UnitTagDto> {
    return this.http.patch<UnitTagDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit-tags/${tagId}`,
      updateUnitTagDto,
      { headers: this.authHeader });
  }

  deleteUnitTag(workspaceId: number, tagId: number): Observable<boolean> {
    return this.http.delete<boolean>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit-tags/${tagId}`,
      { headers: this.authHeader });
  }
}
