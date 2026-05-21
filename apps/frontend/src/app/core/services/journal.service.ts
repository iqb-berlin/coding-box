import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';
import { suppressGlobalHttpErrorContext } from '../interceptors/http-error-context';
import {
  AuditJournalEntryDto,
  AuditJournalQueryDto,
  PaginatedAuditJournalEntriesDto
} from '../../../../../../api-dto/audit-journal/audit-journal.dto';

export type JournalEntry = AuditJournalEntryDto;
export type PaginatedJournalEntries = PaginatedAuditJournalEntriesDto;
export type JournalFilters = Omit<AuditJournalQueryDto, 'page' | 'limit'>;

export interface JournalRequestOptions {
  suppressGlobalError?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class JournalService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  /**
   * Get journal entries for a workspace
   * @param workspaceId The ID of the workspace
   * @param page The page number
   * @param limit The number of entries per page
   * @returns An Observable of paginated journal entries
   */
  getJournalEntries(
    workspaceId: number,
    page: number = 1,
    limit: number = 20,
    filters: JournalFilters = {},
    options: JournalRequestOptions = {}
  ): Observable<PaginatedJournalEntries> {
    return this.http.get<PaginatedJournalEntries>(
      `${this.serverUrl}admin/workspace/${workspaceId}/journal`,
      this.createListRequestOptions(page, limit, filters, options)
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
    details: Record<string, unknown> | string
  ): Observable<JournalEntry> {
    return this.http.post<JournalEntry>(
      `${this.serverUrl}admin/workspace/${workspaceId}/journal`,
      {
        action_type: actionType,
        entity_type: entityType,
        entityType,
        entity_id: entityId,
        entityId,
        details
      }
    );
  }

  /**
   * Download journal entries as CSV
   * @param workspaceId The ID of the workspace
   * @returns An Observable of the CSV data as a Blob
   */
  downloadJournalEntriesAsCsv(
    workspaceId: number,
    options: JournalRequestOptions = {}
  ): Observable<Blob> {
    const requestOptions: { responseType: 'blob'; context?: HttpContext } = {
      responseType: 'blob'
    };

    if (options.suppressGlobalError) {
      requestOptions.context = suppressGlobalHttpErrorContext();
    }

    return this.http.get(
      `${this.serverUrl}admin/workspace/${workspaceId}/journal/csv`,
      requestOptions
    );
  }

  private createListRequestOptions(
    page: number,
    limit: number,
    filters: JournalFilters,
    options: JournalRequestOptions
  ): { params: HttpParams; context?: HttpContext } {
    const requestOptions: { params: HttpParams; context?: HttpContext } = {
      params: this.createParams(page, limit, filters)
    };

    if (options.suppressGlobalError) {
      requestOptions.context = suppressGlobalHttpErrorContext();
    }

    return requestOptions;
  }

  private createParams(page: number, limit: number, filters: JournalFilters): HttpParams {
    let params = new HttpParams()
      .set('page', String(page))
      .set('limit', String(limit));

    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    });

    return params;
  }
}
