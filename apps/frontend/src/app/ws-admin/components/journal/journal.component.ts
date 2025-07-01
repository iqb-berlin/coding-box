import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';

import { AppService } from '../../../services/app.service';
import { JournalService, JournalEntry } from '../../../services/journal.service';

@Component({
  selector: 'coding-box-journal',
  templateUrl: './journal.component.html',
  styleUrls: ['./journal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatPaginatorModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    TranslateModule
  ]
})
export class JournalComponent implements OnInit {
  private appService = inject(AppService);
  private journalService = inject(JournalService);
  private snackBar = inject(MatSnackBar);

  journalEntries: JournalEntry[] = [];
  displayedColumns: string[] = ['timestamp', 'userId', 'actionType', 'entityType', 'entityId', 'details'];
  totalEntries = 0;
  pageSize = 20;
  pageIndex = 0;
  loading = false;

  ngOnInit(): void {
    this.loadJournalEntries();
  }

  loadJournalEntries(): void {
    this.loading = true;
    const workspaceId = this.appService.selectedWorkspaceId;

    this.journalService.getJournalEntries(workspaceId, this.pageIndex + 1, this.pageSize)
      .subscribe({
        next: response => {
          this.journalEntries = response.data;
          this.totalEntries = response.total;
          this.loading = false;
        },
        error: () => {
          this.snackBar.open('Fehler beim Laden der Journal-Einträge', 'Schließen', { duration: 3000 });
          this.loading = false;
        }
      });
  }

  handlePageEvent(event: PageEvent): void {
    this.pageSize = event.pageSize;
    this.pageIndex = event.pageIndex;
    this.loadJournalEntries();
  }

  downloadCsv(): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    this.journalService.downloadJournalEntriesAsCsv(workspaceId)
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
          this.snackBar.open('Fehler beim Herunterladen der CSV-Datei', 'Schließen', { duration: 3000 });
        }
      });
  }
}
