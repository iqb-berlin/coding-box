import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of } from 'rxjs';
import { SERVER_URL } from '../injection-tokens';

export interface JournalEntry {
  id: number;
  timestamp: Date;
  user_id: string;
  action_type: string;
  entity_type: string;
  entity_id: string;
  details: string;
}

export interface PaginatedJournalEntries {
  data: JournalEntry[];
  total: number;
  page: number;
  limit: number;
}

@Injectable({
  providedIn: 'root'
})
export class JournalService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  authHeader = { Authorization: `Bearer ${localStorage.getItem('id_token')}` };

  /**
   * Get journal entries for a workspace
   * @param workspaceId The ID of the workspace
   * @param page The page number
   * @param limit The number of entries per page
   * @returns An Observable of paginated journal entries
   */
  getJournalEntries(workspaceId: number, page: number = 1, limit: number = 20): Observable<PaginatedJournalEntries> {
    return this.http.get<PaginatedJournalEntries>(
      `${this.serverUrl}admin/workspace/${workspaceId}/journal?page=${page}&limit=${limit}`,
      { headers: this.authHeader }
    ).pipe(
      catchError(() => of({
        data: [],
        total: 0,
        page,
        limit
      }))
    );
  }

  /**
   * Create a journal entry
   * @param workspaceId The ID of the workspace
   * @param actionType The type of action (e.g., 'create', 'update', 'delete')
   * @param entityType The type of entity (e.g., 'unit', 'response', 'file')
   * @param entityId The ID of the entity
   * @param details Additional details about the action
   * @returns An Observable of the created journal entry
   */
  createJournalEntry(
    workspaceId: number,
    actionType: string,
    entityType: string,
    entityId: string,
    details: string
  ): Observable<JournalEntry> {
    return this.http.post<JournalEntry>(
      `${this.serverUrl}admin/workspace/${workspaceId}/journal`,
      {
        action_type: actionType,
        entity_type: entityType,
        entity_id: entityId,
        details
      },
      { headers: this.authHeader }
    ).pipe(
      catchError(() => of({
        id: 0,
        timestamp: new Date(),
        user_id: '',
        action_type: actionType,
        entity_type: entityType,
        entity_id: entityId,
        details
      }))
    );
  }

  /**
   * Download journal entries as CSV
   * @param workspaceId The ID of the workspace
   * @returns An Observable of the CSV data as a Blob
   */
  downloadJournalEntriesAsCsv(workspaceId: number): Observable<Blob> {
    return this.http.get(
      `${this.serverUrl}admin/workspace/${workspaceId}/journal/csv`,
      {
        headers: this.authHeader,
        responseType: 'blob'
      }
    ).pipe(
      catchError(() => of(new Blob([])))
    );
  }
}
