import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import {
  BehaviorSubject,
  Observable,
  catchError,
  finalize,
  of,
  tap
} from 'rxjs';
import {
  CodingStatistics, JobInfo,
  JobStatus,
  PaginatedCodingList,
  TestPersonCodingService
} from '../../services/test-person-coding.service';
import { AppService } from '../../../services/app.service';
import { BackendService } from '../../../services/backend.service';

@Component({
  selector: 'coding-box-test-person-coding',
  templateUrl: './test-person-coding.component.html',
  styleUrls: ['./test-person-coding.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatChipsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTableModule,
    MatTabsModule,
    MatTooltipModule,
    TranslateModule
  ]
})
export class TestPersonCodingComponent implements OnInit {
  private testPersonCodingService = inject(TestPersonCodingService);
  private snackBar = inject(MatSnackBar);
  private appService = inject(AppService);
  private backendService = inject(BackendService);
  Math = Math;
  get workspaceId(): number {
    return this.appService.selectedWorkspaceId;
  }

  statistics$: Observable<CodingStatistics> | null = null;

  codingList$ = new BehaviorSubject<PaginatedCodingList>({
    data: [],
    total: 0,
    page: 1,
    limit: 20
  });

  displayedColumns: string[] = ['unit_key', 'unit_alias', 'login_name', 'booklet_id', 'variable_id', 'actions'];

  isLoading = false;

  currentPage = 1;
  pageSize = 20;

  activeJobId: string | null = null;
  jobStatus: JobStatus | null = null;
  jobStatusInterval: number | null = null;

  allJobs: JobInfo[] = [];
  jobsLoading = false;
  jobsRefreshInterval: number | null = null;

  availableGroups: string[] = [];
  selectedGroups: string[] = [];
  groupsLoading = false;

  ngOnInit(): void {
    // this.loadStatistics();
    // this.loadCodingList();
    this.loadAllJobs();
    this.startJobsRefreshInterval();
    this.loadWorkspaceGroups();
  }

  loadWorkspaceGroups(): void {
    this.groupsLoading = true;
    this.testPersonCodingService.getWorkspaceGroups(this.workspaceId)
      .pipe(
        tap(groups => {
          this.availableGroups = groups;
        }),
        finalize(() => {
          this.groupsLoading = false;
        })
      )
      .subscribe();
  }

  ngOnDestroy(): void {
    this.stopJobStatusPolling();
    this.stopJobsRefreshInterval();
  }

  loadAllJobs(): void {
    this.jobsLoading = true;
    this.testPersonCodingService.getAllJobs(this.workspaceId)
      .pipe(
        tap(jobs => {
          this.allJobs = jobs;

          // If we have an active job, update its status from the list
          if (this.activeJobId) {
            const activeJob = jobs.find(job => job.jobId === this.activeJobId);
            if (activeJob) {
              this.jobStatus = activeJob;

              // If job is completed, failed, cancelled, or paused, stop polling
              if (['completed', 'failed', 'cancelled', 'paused'].includes(activeJob.status)) {
                this.stopJobStatusPolling();

                if (activeJob.status === 'completed') {
                  this.loadStatistics();
                  this.loadCodingList(this.currentPage, this.pageSize);
                }
              }
            }
          }
        }),
        finalize(() => {
          this.jobsLoading = false;
        })
      )
      .subscribe();
  }

  startJobsRefreshInterval(): void {
    // Clear any existing interval
    this.stopJobsRefreshInterval();

    // Refresh jobs list every 5 seconds
    this.jobsRefreshInterval = window.setInterval(() => {
      this.loadAllJobs();
    }, 5000);
  }

  stopJobsRefreshInterval(): void {
    if (this.jobsRefreshInterval) {
      clearInterval(this.jobsRefreshInterval);
      this.jobsRefreshInterval = null;
    }
  }

  loadStatistics(): void {
    this.statistics$ = this.testPersonCodingService.getCodingStatistics(this.workspaceId);
  }

  loadCodingList(page = 1, limit = 20): void {
    this.isLoading = true;
    this.currentPage = page;
    this.pageSize = limit;

    // Get current auth token
    const authToken = localStorage.getItem('id_token') || '';
    // Get server URL for generating links
    const serverUrl = window.location.origin;

    this.testPersonCodingService.getCodingList(this.workspaceId, authToken, serverUrl, page, limit)
      .pipe(
        tap(result => this.codingList$.next(result)),
        finalize(() => {
          this.isLoading = false;
        })
      )
      .subscribe();
  }

  handlePageEvent(event: PageEvent): void {
    this.loadCodingList(event.pageIndex + 1, event.pageSize);
  }

  codeTestPersons(testPersonIds: string): void {
    if (!testPersonIds) {
      this.snackBar.open('Bitte geben Sie Testpersonen-IDs ein', 'Schließen', { duration: 3000 });
      return;
    }

    this.isLoading = true;
    this.testPersonCodingService.codeTestPersons(this.workspaceId, testPersonIds)
      .pipe(
        tap(result => {
          if (result.jobId) {
            // Background job started
            this.activeJobId = result.jobId;
            this.startJobStatusPolling(result.jobId);
            this.snackBar.open(result.message || 'Hintergrundauftrag gestartet', 'Schließen', { duration: 5000 });
          } else {
            // Immediate result
            this.snackBar.open(`${result.totalResponses} Antworten kodiert`, 'Schließen', { duration: 3000 });
            this.loadStatistics();
            this.loadCodingList(this.currentPage, this.pageSize);
          }
        }),
        catchError(error => {
          this.snackBar.open(`Fehler: ${error.message || 'Kodierung der Testpersonen fehlgeschlagen'}`, 'Schließen', { duration: 5000 });
          return of(null);
        }),
        finalize(() => {
          this.isLoading = false;
        })
      )
      .subscribe();
  }

  startJobStatusPolling(jobId: string): void {
    if (this.jobStatusInterval) {
      clearInterval(this.jobStatusInterval);
    }

    this.jobStatusInterval = window.setInterval(() => {
      this.testPersonCodingService.getJobStatus(this.workspaceId, jobId)
        .subscribe(status => {
          if ('error' in status) {
            this.snackBar.open(`Fehler: ${status.error}`, 'Schließen', { duration: 5000 });
            this.stopJobStatusPolling();
            return;
          }

          this.jobStatus = status;

          if (['completed', 'failed', 'cancelled', 'paused'].includes(status.status)) {
            this.stopJobStatusPolling();

            if (status.status === 'completed') {
              this.snackBar.open('Kodierungsauftrag erfolgreich abgeschlossen', 'Schließen', { duration: 3000 });
              this.loadStatistics();
              this.loadCodingList(this.currentPage, this.pageSize);
            } else if (status.status === 'failed') {
              this.snackBar.open(`Kodierungsauftrag fehlgeschlagen: ${status.error || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
            } else if (status.status === 'cancelled') {
              this.snackBar.open('Kodierungsauftrag wurde abgebrochen', 'Schließen', { duration: 3000 });
            } else if (status.status === 'paused') {
              this.snackBar.open('Kodierungsauftrag wurde pausiert', 'Schließen', { duration: 3000 });
            }
          }
        });
    }, 2000);
  }

  stopJobStatusPolling(): void {
    if (this.jobStatusInterval) {
      clearInterval(this.jobStatusInterval);
      this.jobStatusInterval = null;
    }
    this.activeJobId = null;
    this.jobStatus = null;
  }

  cancelJob(jobId?: string): void {
    const idToCancel = jobId || this.activeJobId;
    if (!idToCancel) return;

    this.testPersonCodingService.cancelJob(this.workspaceId, idToCancel)
      .subscribe(result => {
        if (result.success) {
          this.snackBar.open(result.message, 'Schließen', { duration: 3000 });
          // Refresh the jobs list
          this.loadAllJobs();
        } else {
          this.snackBar.open(`Fehler beim Abbrechen des Auftrags: ${result.message}`, 'Schließen', { duration: 5000 });
        }
      });
  }

  deleteJob(jobId: string): void {
    if (!jobId) return;

    this.testPersonCodingService.deleteJob(this.workspaceId, jobId)
      .subscribe(result => {
        if (result.success) {
          this.snackBar.open(result.message, 'Schließen', { duration: 3000 });
          this.loadAllJobs();
        } else {
          this.snackBar.open(`Fehler beim Löschen des Auftrags: ${result.message}`, 'Schließen', { duration: 5000 });
        }
      });
  }

  restartJob(jobId: string): void {
    if (!jobId) return;

    this.testPersonCodingService.restartJob(this.workspaceId, jobId)
      .subscribe(result => {
        if (result.success) {
          this.snackBar.open(result.message || 'Auftrag wurde neu gestartet', 'Schließen', { duration: 3000 });
          if (result.jobId) {
            // If a new job was created, start polling its status
            this.activeJobId = result.jobId;
            this.startJobStatusPolling(result.jobId);
          }
          this.loadAllJobs();
        } else {
          this.snackBar.open(`Fehler beim Neustarten des Auftrags: ${result.message}`, 'Schließen', { duration: 5000 });
        }
      });
  }

  showJobResult(job: JobInfo): void {
    if (!job.result) {
      this.snackBar.open('Keine Ergebnisse für diesen Auftrag verfügbar', 'Schließen', { duration: 3000 });
      return;
    }

    let message = `Auftrags-ID: ${job.jobId}\n\n`;

    if (job.groupNames) {
      message += `Kodierte Gruppen: ${job.groupNames}\n\n`;
    }

    if (job.durationMs) {
      message += `Dauer: ${this.formatDuration(job.durationMs)}\n\n`;
    }

    message += `Gesamtantworten: ${job.result.totalResponses}\n\n`;
    message += 'Statuszähler:\n';

    for (const [status, count] of Object.entries(job.result.statusCounts)) {
      message += `${status || 'Unbekannt'}: ${count}\n`;
    }

    this.snackBar.open(message, 'Schließen', { duration: 10000 });
  }

  codeAllTestPersons(): void {
    if (this.availableGroups.length > 0) {
      this.selectedGroups = [...this.availableGroups];
      this.codeTestPersons(this.selectedGroups.join(','));
      this.snackBar.open(`Kodiere Testpersonen aus allen ${this.selectedGroups.length} Gruppen`, 'Schließen', { duration: 3000 });
      return;
    }

    this.isLoading = true;
    this.backendService.getTestPersons(this.workspaceId)
      .pipe(
        catchError(error => {
          this.snackBar.open(`Fehler beim Abrufen der Testpersonen: ${error.message || 'Unbekannter Fehler'}`, 'Schließen', { duration: 5000 });
          return of([]);
        }),
        finalize(() => {
          this.isLoading = false;
        })
      )
      .subscribe(testPersonIds => {
        if (testPersonIds.length === 0) {
          this.snackBar.open('Keine Testpersonen für diesen Arbeitsbereich gefunden', 'Schließen', { duration: 3000 });
          return;
        }

        const testPersonIdsString = testPersonIds.join(',');
        this.codeTestPersons(testPersonIdsString);

        // Show message about how many test persons are being coded
        this.snackBar.open(`Kodiere ${testPersonIds.length} Testpersonen`, 'Schließen', { duration: 5000 });
      });
  }

  formatDuration(durationMs: number): string {
    if (!durationMs) return '-';

    const seconds = Math.floor((durationMs / 1000) % 60);
    const minutes = Math.floor((durationMs / (1000 * 60)) % 60);
    const hours = Math.floor((durationMs / (1000 * 60 * 60)));

    const parts: string[] = [];

    if (hours > 0) {
      parts.push(`${hours}h`);
    }

    if (minutes > 0 || hours > 0) {
      parts.push(`${minutes}m`);
    }

    parts.push(`${seconds}s`);

    return parts.join(' ');
  }

  truncateText(text: string, maxLength: number): string {
    if (!text) return '';
    return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
  }
}
