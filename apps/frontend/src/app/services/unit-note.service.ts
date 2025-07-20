import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  Observable
} from 'rxjs';
import { UnitNoteDto } from '../../../../../api-dto/unit-notes/unit-note.dto';
import { CreateUnitNoteDto } from '../../../../../api-dto/unit-notes/create-unit-note.dto';
import { UpdateUnitNoteDto } from '../../../../../api-dto/unit-notes/update-unit-note.dto';
import { SERVER_URL } from '../injection-tokens';

@Injectable({
  providedIn: 'root'
})
export class UnitNoteService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  get authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('id_token')}` };
  }

  createUnitNote(workspaceId: number, createUnitNoteDto: CreateUnitNoteDto): Observable<UnitNoteDto> {
    return this.http.post<UnitNoteDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit-notes`,
      createUnitNoteDto,
      { headers: this.authHeader });
  }

  getUnitNotes(workspaceId: number, unitId: number): Observable<UnitNoteDto[]> {
    return this.http.get<UnitNoteDto[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit-notes/unit/${unitId}`,
      { headers: this.authHeader });
  }

  getNotesForMultipleUnits(workspaceId: number, unitIds: number[]): Observable<{ [unitId: number]: UnitNoteDto[] }> {
    return this.http.post<{ [unitId: number]: UnitNoteDto[] }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit-notes/units/notes`,
      { unitIds },
      { headers: this.authHeader });
  }

  getUnitNote(workspaceId: number, noteId: number): Observable<UnitNoteDto> {
    return this.http.get<UnitNoteDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit-notes/${noteId}`,
      { headers: this.authHeader });
  }

  updateUnitNote(workspaceId: number, noteId: number, updateUnitNoteDto: UpdateUnitNoteDto): Observable<UnitNoteDto> {
    return this.http.patch<UnitNoteDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit-notes/${noteId}`,
      updateUnitNoteDto,
      { headers: this.authHeader });
  }

  deleteUnitNote(workspaceId: number, noteId: number): Observable<boolean> {
    return this.http.delete<boolean>(
      `${this.serverUrl}admin/workspace/${workspaceId}/unit-notes/${noteId}`,
      { headers: this.authHeader });
  }
}
