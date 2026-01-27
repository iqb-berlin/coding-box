import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  BehaviorSubject,
  Observable,
  catchError,
  finalize,
  of,
  tap
} from 'rxjs';
import { concatMap } from 'rxjs/operators';
import {
  CodingStatistics,
  JobInfo,
  JobStatus,
  PaginatedCodingList,
  TestPersonCodingService,
  WorkspaceGroupCodingStats,
  CodingStatisticsWithJob
} from '../../services/test-person-coding.service';
import { AppService } from '../../../core/services/app.service';
import { TestResultService } from '../../../shared/services/test-result/test-result.service';
import { BackendMessageTranslatorService } from '../../services/backend-message-translator.service';
import { TestPersonCodingJobResultDialogComponent } from '../test-person-coding-job-result-dialog/test-person-coding-job-result-dialog.component';
import { CodingManagementService } from '../../services/coding-management.service';

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
    MatRadioModule,
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
  private testResultService = inject(TestResultService);
  private translateService = inject(TranslateService);
  private backendMessageTranslator = inject(BackendMessageTranslatorService);
  private dialog = inject(MatDialog);
  private codingManagementService = inject(CodingManagementService);
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

  availableGroups: WorkspaceGroupCodingStats[] = [];
  selectedGroups: string[] = [];
  groupsLoading = false;

  autoCoderRun: number = 1;

  ngOnInit(): void {
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
          if (this.activeJobId) {
            const activeJob = jobs.find(job => job.jobId === this.activeJobId);
            if (activeJob) {
              this.jobStatus = activeJob;
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
    this.stopJobsRefreshInterval();
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
    const authToken = localStorage.getItem('id_token') || '';
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

  codeTestPersons(testPersonIds: string): void {
    if (!testPersonIds) {
      this.snackBar.open(this.translateService.instant('test-person-coding.enter-test-person-ids'), this.translateService.instant('close'), { duration: 3000 });
      return;
    }

    this.isLoading = true;

    const startCoding$ = () => this.testPersonCodingService.codeTestPersons(this.workspaceId, testPersonIds, this.autoCoderRun);
    let task$: Observable<CodingStatisticsWithJob | null>;

    if (this.autoCoderRun === 1) {
      task$ = of(null).pipe(
        concatMap(() => this.codingManagementService.resetCodingVersion('v2')),
        concatMap(() => this.codingManagementService.resetCodingVersion('v3')),
        concatMap(() => startCoding$())
      );
    } else {
      task$ = startCoding$();
    }

    task$.pipe(
      tap(result => {
        if (result && result.jobId) {
          this.activeJobId = result.jobId;
          this.startJobStatusPolling(result.jobId);
          const translatedMessage = result.message ? this.backendMessageTranslator.translateMessage(result.message) : this.translateService.instant('test-person-coding.background-job-started');
          this.snackBar.open(translatedMessage, this.translateService.instant('close'), { duration: 5000 });
        } else if (result) {
          this.snackBar.open(this.translateService.instant('test-person-coding.responses-coded', { count: result.totalResponses }), this.translateService.instant('close'), { duration: 3000 });
          this.loadStatistics();
          this.loadCodingList(this.currentPage, this.pageSize);
        }
      }),
      catchError(error => {
        this.snackBar.open(this.translateService.instant('test-person-coding.job-error', { error: error.message || this.translateService.instant('test-person-coding.coding-failed') }), this.translateService.instant('close'), { duration: 5000 });
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
            this.snackBar.open(this.translateService.instant('test-person-coding.job-error', { error: status.error }), this.translateService.instant('close'), { duration: 5000 });
            this.stopJobStatusPolling();
            return;
          }

          this.jobStatus = status;

          if (['completed', 'failed', 'cancelled', 'paused'].includes(status.status)) {
            this.stopJobStatusPolling();

            if (status.status === 'completed') {
              this.snackBar.open(this.translateService.instant('test-person-coding.job-completed'), this.translateService.instant('close'), { duration: 3000 });
              this.loadStatistics();
              this.loadCodingList(this.currentPage, this.pageSize);
            } else if (status.status === 'failed') {
              this.snackBar.open(this.translateService.instant('test-person-coding.job-completed-with-error', { error: status.error || this.translateService.instant('error.unknown') }), this.translateService.instant('close'), { duration: 5000 });
            } else if (status.status === 'cancelled') {
              this.snackBar.open(this.translateService.instant('test-person-coding.job-cancelled'), this.translateService.instant('close'), { duration: 3000 });
            } else if (status.status === 'paused') {
              this.snackBar.open(this.translateService.instant('test-person-coding.job-paused'), this.translateService.instant('close'), { duration: 3000 });
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
          const translatedMessage = this.backendMessageTranslator.translateMessage(result.message);
          this.snackBar.open(translatedMessage, this.translateService.instant('close'), { duration: 3000 });
          this.loadAllJobs();
        } else {
          const translatedErrorMessage = result.message ? this.backendMessageTranslator.translateMessage(result.message) : '';
          this.snackBar.open(this.translateService.instant('test-person-coding.job-cancel-error', { message: translatedErrorMessage }), this.translateService.instant('close'), { duration: 5000 });
        }
      });
  }

  deleteJob(jobId: string): void {
    if (!jobId) return;

    this.testPersonCodingService.deleteJob(this.workspaceId, jobId)
      .subscribe(result => {
        if (result.success) {
          const translatedMessage = this.backendMessageTranslator.translateMessage(result.message);
          this.snackBar.open(translatedMessage, this.translateService.instant('close'), { duration: 3000 });
          this.loadAllJobs();
        } else {
          const translatedErrorMessage = result.message ? this.backendMessageTranslator.translateMessage(result.message) : '';
          this.snackBar.open(this.translateService.instant('test-person-coding.job-delete-error', { message: translatedErrorMessage }), this.translateService.instant('close'), { duration: 5000 });
        }
      });
  }

  restartJob(jobId: string): void {
    if (!jobId) return;

    this.testPersonCodingService.restartJob(this.workspaceId, jobId)
      .subscribe(result => {
        if (result.success) {
          const translatedMessage = result.message ? this.backendMessageTranslator.translateMessage(result.message) : this.translateService.instant('test-person-coding.job-restarted');
          this.snackBar.open(translatedMessage, this.translateService.instant('close'), { duration: 3000 });
          if (result.jobId) {
            this.activeJobId = result.jobId;
            this.startJobStatusPolling(result.jobId);
            const translatedBackgroundMessage = result.message ? this.backendMessageTranslator.translateMessage(result.message) : this.translateService.instant('test-person-coding.background-job-started');
            this.snackBar.open(translatedBackgroundMessage, this.translateService.instant('close'), { duration: 5000 });
          }
          this.loadAllJobs();
        } else {
          const translatedErrorMessage = result.message ? this.backendMessageTranslator.translateMessage(result.message) : '';
          this.snackBar.open(this.translateService.instant('test-person-coding.job-restart-error', { message: translatedErrorMessage }), this.translateService.instant('close'), { duration: 5000 });
        }
      });
  }

  showJobResult(job: JobInfo): void {
    if (!job.result) {
      this.snackBar.open(this.translateService.instant('test-person-coding.job-result-unavailable'), this.translateService.instant('close'), { duration: 3000 });
      return;
    }
    const formattedDuration = job.durationMs ? this.formatDuration(job.durationMs) : null;
    this.dialog.open(TestPersonCodingJobResultDialogComponent, {
      width: '600px',
      data: {
        job,
        formattedDuration,
        autoCoderRun: (job as unknown as { autoCoderRun?: number }).autoCoderRun ?? 1
      }
    });
  }

  codeAllTestPersons(): void {
    if (this.availableGroups.length > 0) {
      this.selectedGroups = this.availableGroups.map(group => group.groupName);
      this.codeTestPersons(this.selectedGroups.join(','));
      this.snackBar.open(this.translateService.instant('test-person-coding.coding-all-groups', { count: this.selectedGroups.length }), this.translateService.instant('close'), { duration: 3000 });
      return;
    }

    this.isLoading = true;
    this.testResultService.getTestPersons(this.workspaceId)
      .pipe(
        catchError(error => {
          this.snackBar.open(this.translateService.instant('test-person-coding.fetch-test-persons-error', { error: error.message || this.translateService.instant('error.unknown') }), this.translateService.instant('close'), { duration: 5000 });
          return of([]);
        }),
        finalize(() => {
          this.isLoading = false;
        })
      )
      .subscribe(testPersonIds => {
        if (testPersonIds.length === 0) {
          this.snackBar.open(this.translateService.instant('test-person-coding.no-test-persons'), this.translateService.instant('close'), { duration: 3000 });
          return;
        }
        const testPersonIdsString = testPersonIds.join(',');
        this.codeTestPersons(testPersonIdsString);
        this.snackBar.open(this.translateService.instant('test-person-coding.coding-test-persons-count', { count: testPersonIds.length }), this.translateService.instant('close'), { duration: 5000 });
      });
  }

  formatDuration(durationMs: number): string {
    if (!durationMs) return '-';
    if (durationMs < 1000) {
      return `${Math.round(durationMs)}ms`;
    }

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

  deselectAllGroups(): void {
    this.selectedGroups = [];
  }

  selectAllGroups(): void {
    this.selectedGroups = this.availableGroups.map(group => group.groupName);
  }

  truncateText(text: string, maxLength: number): string {
    if (!text) return '';
    return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
  }
}
