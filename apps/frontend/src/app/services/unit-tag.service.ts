import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  Observable
} from 'rxjs';
import { UnitTagDto } from '../../../../../api-dto/unit-tags/unit-tag.dto';
import { CreateUnitTagDto } from '../../../../../api-dto/unit-tags/create-unit-tag.dto';
import { SERVER_URL } from '../injection-tokens';

@Injectable({
  providedIn: 'root'
})
export class UnitTagService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  createUnitTag(workspaceId: number, createUnitTagDto: CreateUnitTagDto): Observable<UnitTagDto> {
    return this.http.post<UnitTagDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit-tags`,
      createUnitTagDto,
      {});
  }

  deleteUnitTag(workspaceId: number, tagId: number): Observable<boolean> {
    return this.http.delete<boolean>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit-tags/${tagId}`,
      {});
  }
}
