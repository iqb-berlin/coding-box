import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AppService } from '../../../core/services/app.service';
import { AppHttpError } from '../../../core/interceptors/app-http-error.class';
import { JournalFilters, JournalService, JournalEntry } from '../../../core/services/journal.service';
import {
  auditEventResults,
  auditEventTypes
} from '../../../../../../../api-dto/audit-journal/audit-journal.dto';

@Component({
  selector: 'coding-box-journal',
  templateUrl: './journal.component.html',
  styleUrls: ['./journal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTableModule,
    MatPaginatorModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    TranslateModule
  ]
})
export class JournalComponent implements OnInit {
  private appService = inject(AppService);
  private journalService = inject(JournalService);
  private snackBar = inject(MatSnackBar);
  private translateService = inject(TranslateService);

  journalEntries: JournalEntry[] = [];
  displayedColumns: string[] = [
    'timestamp',
    'actor',
    'eventType',
    'result',
    'entityType',
    'entityId',
    'summary',
    'details'
  ];

  totalEntries = 0;
  pageSize = 20;
  pageIndex = 0;
  loading = false;
  loadError = false;
  loadErrorMessage = '';
  loadErrorRequestId = '';
  eventTypes = auditEventTypes;
  resultTypes = auditEventResults;
  filters: JournalFilters = {};

  ngOnInit(): void {
    this.loadJournalEntries();
  }

  loadJournalEntries(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.journalEntries = [];
      this.totalEntries = 0;
      this.loadError = false;
      this.loadErrorMessage = '';
      this.loadErrorRequestId = '';
      return;
    }

    this.loading = true;
    this.loadError = false;
    this.loadErrorMessage = '';
    this.loadErrorRequestId = '';

    this.journalService.getJournalEntries(
      workspaceId,
      this.pageIndex + 1,
      this.pageSize,
      this.filters,
      { suppressGlobalError: true }
    )
      .subscribe({
        next: response => {
          this.journalEntries = response.data;
          this.totalEntries = response.total;
          this.loadError = false;
          this.loading = false;
        },
        error: error => {
          this.journalEntries = [];
          this.totalEntries = 0;
          this.loadError = true;
          this.setLoadErrorDetails(error);
          this.loading = false;
        }
      });
  }

  handlePageEvent(event: PageEvent): void {
    this.pageSize = event.pageSize;
    this.pageIndex = event.pageIndex;
    this.loadJournalEntries();
  }

  applyFilters(): void {
    this.pageIndex = 0;
    this.loadJournalEntries();
  }

  clearFilters(): void {
    this.filters = {};
    this.pageIndex = 0;
    this.loadJournalEntries();
  }

  downloadCsv(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.journalService.downloadJournalEntriesAsCsv(workspaceId, { suppressGlobalError: true })
      .subscribe({
        next: blob => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `journal_entries_workspace_${workspaceId}.csv`;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        },
        error: () => {
          this.snackBar.open(
            this.translateService.instant('journal.download-error'),
            this.translateService.instant('close'),
            { duration: 3000 }
          );
        }
      });
  }

  getActorLabel(entry: JournalEntry): string {
    if (entry.actorId) {
      return entry.actorId;
    }
    if (entry.actorUserId) {
      return String(entry.actorUserId);
    }
    return entry.actorType;
  }

  formatDetails(details: Record<string, unknown> | null): string {
    if (!details) {
      return '';
    }
    return JSON.stringify(details);
  }

  private extractRequestId(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) {
      return '';
    }

    const requestIdFromHeader = error.headers.get('X-Request-Id');
    if (requestIdFromHeader) {
      return requestIdFromHeader;
    }

    const requestIdFromBody = error.error?.requestId;
    return typeof requestIdFromBody === 'string' ? requestIdFromBody : '';
  }

  private setLoadErrorDetails(error: unknown): void {
    if (error instanceof HttpErrorResponse) {
      const httpError = new AppHttpError(error);
      this.loadErrorMessage = httpError.userMessage;
      this.loadErrorRequestId = httpError.requestId;
      return;
    }

    this.loadErrorMessage = this.translateService.instant('journal.load-error-message');
    this.loadErrorRequestId = this.extractRequestId(error);
  }
}
