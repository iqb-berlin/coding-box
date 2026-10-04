import {
  Component, DestroyRef, OnInit, inject, signal, input
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import {
  CodingStatistics,
  JobInfo,
  JobStatus,
  PaginatedCodingList,
  TestPersonCodingService,
  WorkspaceGroupCodingStats
} from '../../services/test-person-coding.service';
import { CodingBackgroundJobsService } from '../../services/coding-background-jobs.service';
import { AppService } from '../../../core/services/app.service';
import { TestResultService } from '../../../shared/services/test-result/test-result.service';
import { BackendMessageTranslatorService } from '../../services/backend-message-translator.service';
import { TestPersonCodingJobResultDialogComponent } from '../test-person-coding-job-result-dialog/test-person-coding-job-result-dialog.component';

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
  private readonly destroyRef = inject(DestroyRef);
  private testPersonCodingService = inject(TestPersonCodingService);
  private snackBar = inject(MatSnackBar);
  private appService = inject(AppService);
  private testResultService = inject(TestResultService);
  private translateService = inject(TranslateService);
  private backendMessageTranslator = inject(BackendMessageTranslatorService);
  private dialog = inject(MatDialog);
  private codingBackgroundJobsService = inject(CodingBackgroundJobsService);
  readonly initialJobId = input<string | null>(null);
  readonly initialAutoCoderRun = input<1 | 2 | null>(null);

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

  displayedColumns: string[] = [
    'unit_key',
    'unit_alias',
    'login_name',
    'booklet_id',
    'variable_id',
    'actions'
  ];

  readonly isLoading = signal(false);

  currentPage = 1;
  pageSize = 20;

  readonly activeJobId = signal<string | null>(null);
  readonly jobStatus = signal<JobStatus | null>(null);
  jobStatusInterval: number | null = null;
  lastObservedJobId: string | null = null;
  private observedJobStatuses = new Map<string, JobStatus['status']>();
  private hasShownJobStatusPollingError = false;

  private jobsRequestId = 0;
  private latestAppliedJobsRequestId = 0;
  private groupsRequestId = 0;
  private latestAppliedGroupsRequestId = 0;
  private jobStatusPollingGeneration = 0;
  private jobStatusRequestId = 0;
  private latestAppliedJobStatusRequestId = 0;

  readonly allJobs = signal<JobInfo[]>([]);
  readonly jobsLoading = signal(false);
  jobsRefreshInterval: number | null = null;

  readonly availableGroups = signal<WorkspaceGroupCodingStats[]>([]);
  selectedGroups: string[] = [];
  readonly groupsLoading = signal(false);

  autoCoderRun: 1 | 2 = 1;
  private lastNotifiedCompletedJobId: string | null = null;

  ngOnInit(): void {
    const initialAutoCoderRun = this.initialAutoCoderRun();
    if (initialAutoCoderRun) {
      this.autoCoderRun = initialAutoCoderRun;
    }

    const initialJobId = this.initialJobId();
    if (initialJobId) {
      this.activeJobId.set(initialJobId);
      this.setFreshnessCodingGuard(initialJobId, true);
      this.startJobStatusPolling(initialJobId);
    }

    this.loadAllJobs();
    this.startJobsRefreshInterval();
    this.loadWorkspaceGroups();
  }

  loadWorkspaceGroups(): void {
    const workspaceId = this.workspaceId;
    this.groupsRequestId += 1;
    const requestId = this.groupsRequestId;
    this.groupsLoading.set(true);
    this.testPersonCodingService
      .getWorkspaceGroups(workspaceId)
      .pipe(
        tap(groups => {
          if (this.workspaceId !== workspaceId ||
            requestId < this.latestAppliedGroupsRequestId) return;
          this.latestAppliedGroupsRequestId = requestId;
          this.availableGroups.set(groups);
        }),
        finalize(() => {
          if (requestId === this.groupsRequestId) this.groupsLoading.set(false);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  ngOnDestroy(): void {
    this.stopJobStatusPolling();
    this.stopJobsRefreshInterval();
  }

  loadAllJobs(): void {
    const workspaceId = this.workspaceId;
    this.jobsRequestId += 1;
    const requestId = this.jobsRequestId;
    this.jobsLoading.set(true);
    this.testPersonCodingService
      .getAllJobs(workspaceId)
      .pipe(
        tap(jobs => {
          if (this.workspaceId !== workspaceId ||
            requestId < this.latestAppliedJobsRequestId) return;
          this.latestAppliedJobsRequestId = requestId;
          this.allJobs.set(jobs);
          if (this.activeJobId()) {
            const activeJob = jobs.find(
              job => job.jobId === this.activeJobId()
            );
            if (activeJob) {
              this.applyJobStatus(activeJob.jobId, activeJob);
            }
          }
        }),
        finalize(() => {
          if (requestId === this.jobsRequestId) this.jobsLoading.set(false);
        }),
        takeUntilDestroyed(this.destroyRef)
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
    this.statistics$ = this.testPersonCodingService.getCodingStatistics(
      this.workspaceId
    );
  }

  loadCodingList(page = 1, limit = 20): void {
    this.isLoading.set(true);
    this.currentPage = page;
    this.pageSize = limit;
    const serverUrl = window.location.origin;

    this.testPersonCodingService
      .getCodingList(this.workspaceId, '', serverUrl, page, limit)
      .pipe(
        tap(result => this.codingList$.next(result)),
        finalize(() => {
          this.isLoading.set(false);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  codeTestPersons(testPersonIds: string): void {
    if (!testPersonIds) {
      this.snackBar.open(
        this.translateService.instant(
          'test-person-coding.enter-test-person-ids'
        ),
        this.translateService.instant('close'),
        { duration: 3000 }
      );
      return;
    }

    this.isLoading.set(true);

    this.testPersonCodingService
      .codeTestPersons(this.workspaceId, testPersonIds, this.autoCoderRun)
      .pipe(
        tap(result => {
          if (result && result.jobId) {
            this.activeJobId.set(result.jobId);
            this.startJobStatusPolling(result.jobId);
            const translatedMessage = result.message ?
              this.backendMessageTranslator.translateMessage(result.message) :
              this.translateService.instant(
                'test-person-coding.background-job-started'
              );
            this.snackBar.open(
              translatedMessage,
              this.translateService.instant('close'),
              { duration: 5000 }
            );
          } else if (result) {
            if (result.message && result.totalResponses === 0) {
              this.snackBar.open(
                this.backendMessageTranslator.translateMessage(result.message),
                this.translateService.instant('close'),
                { duration: 7000 }
              );
              return;
            }

            this.snackBar.open(
              this.translateService.instant(
                'test-person-coding.responses-coded',
                { count: result.totalResponses }
              ),
              this.translateService.instant('close'),
              { duration: 3000 }
            );
            this.handleAutoCodingCompleted();
          }
        }),
        catchError(error => {
          this.snackBar.open(
            this.translateService.instant('test-person-coding.job-error', {
              error:
                error.message ||
                this.translateService.instant(
                  'test-person-coding.coding-failed'
                )
            }),
            this.translateService.instant('close'),
            { duration: 5000 }
          );
          return of(null);
        }),
        finalize(() => {
          this.isLoading.set(false);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  startJobStatusPolling(jobId: string): void {
    this.jobStatusPollingGeneration += 1;
    if (this.jobStatusInterval) {
      clearInterval(this.jobStatusInterval);
    }

    this.activeJobId.set(jobId);
    this.jobStatus.set(null);
    this.hasShownJobStatusPollingError = false;
    this.jobStatusInterval = window.setInterval(() => {
      this.loadJobStatus(jobId);
    }, 2000);
    this.loadJobStatus(jobId);
  }

  private loadJobStatus(jobId: string): void {
    const workspaceId = this.workspaceId;
    const generation = this.jobStatusPollingGeneration;
    this.jobStatusRequestId += 1;
    const requestId = this.jobStatusRequestId;
    this.testPersonCodingService
      .getJobStatus(workspaceId, jobId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(status => {
        if (this.activeJobId() !== jobId || this.workspaceId !== workspaceId ||
          generation !== this.jobStatusPollingGeneration ||
          requestId < this.latestAppliedJobStatusRequestId) return;
        this.latestAppliedJobStatusRequestId = requestId;
        if (!('status' in status)) {
          if (!this.hasShownJobStatusPollingError) {
            this.hasShownJobStatusPollingError = true;
            this.snackBar.open(
              this.translateService.instant('test-person-coding.job-error', {
                error: status.error
              }),
              this.translateService.instant('close'),
              { duration: 5000 }
            );
          }

          if (this.isFreshnessCodingJob(jobId)) {
            return;
          }

          this.stopJobStatusPolling();
          return;
        }

        this.hasShownJobStatusPollingError = false;
        this.applyJobStatus(jobId, status);
      });
  }

  private applyJobStatus(jobId: string, status: JobStatus): void {
    this.jobStatus.set(status);
    this.rememberJobStatus(jobId, status);
    this.updateFreshnessCodingGuardFromStatus(jobId, status);

    if (
      ['completed', 'failed', 'cancelled', 'paused'].includes(
        status.status
      )
    ) {
      // Invalidate other pending responses before emitting terminal feedback.
      this.stopJobStatusPolling();

      if (status.status === 'completed') {
        const warnings = status.result?.warnings || [];
        this.snackBar.open(
          this.translateService.instant(
            warnings.length > 0 ?
              'test-person-coding.job-completed-with-warnings' :
              'test-person-coding.job-completed',
            { warning: warnings.join(' ') }
          ),
          this.translateService.instant('close'),
          { duration: warnings.length > 0 ? 8000 : 3000 }
        );
        this.handleAutoCodingCompleted(jobId);
      } else if (status.status === 'failed') {
        this.snackBar.open(
          this.translateService.instant(
            'test-person-coding.job-completed-with-error',
            {
              error:
                status.error ||
                this.translateService.instant('error.unknown')
            }
          ),
          this.translateService.instant('close'),
          { duration: 5000 }
        );
      } else if (status.status === 'cancelled') {
        this.snackBar.open(
          this.translateService.instant(
            'test-person-coding.job-cancelled'
          ),
          this.translateService.instant('close'),
          { duration: 3000 }
        );
      } else if (status.status === 'paused') {
        this.snackBar.open(
          this.translateService.instant('test-person-coding.job-paused'),
          this.translateService.instant('close'),
          { duration: 3000 }
        );
      }
    }
  }

  getLastObservedJobStatus(jobId?: string | null): JobStatus['status'] | null {
    if (jobId) {
      return this.observedJobStatuses.get(jobId) ?? null;
    }

    return this.lastObservedJobId ?
      this.observedJobStatuses.get(this.lastObservedJobId) ?? null :
      null;
  }

  stopJobStatusPolling(): void {
    this.jobStatusPollingGeneration += 1;
    if (this.jobStatusInterval) {
      clearInterval(this.jobStatusInterval);
      this.jobStatusInterval = null;
    }
    this.activeJobId.set(null);
    this.jobStatus.set(null);
    this.hasShownJobStatusPollingError = false;
  }

  private rememberJobStatus(jobId: string, status: JobStatus): void {
    this.lastObservedJobId = jobId;
    this.observedJobStatuses.set(jobId, status.status);
  }

  private handleAutoCodingCompleted(jobId?: string): void {
    if (jobId) {
      if (this.lastNotifiedCompletedJobId === jobId) {
        return;
      }
      this.lastNotifiedCompletedJobId = jobId;
      this.setFreshnessCodingGuard(jobId, false);
    }

    this.loadStatistics();
    this.loadWorkspaceGroups();
    this.testPersonCodingService.notifyAutoCodingCompleted(jobId);
  }

  private updateFreshnessCodingGuardFromStatus(jobId: string, status: JobStatus): void {
    if (!this.isFreshnessCodingJob(jobId, status)) {
      return;
    }

    this.setFreshnessCodingGuard(
      jobId,
      !['completed', 'failed', 'cancelled', 'paused'].includes(status.status)
    );
  }

  private isFreshnessCodingJob(jobId: string, status?: JobStatus): boolean {
    return jobId === this.initialJobId() || status?.source === 'coding-freshness';
  }

  private setFreshnessCodingGuard(jobId: string, isRunning: boolean): void {
    this.codingBackgroundJobsService.setJobRunning(
      this.workspaceId,
      'freshness-coding',
      isRunning,
      jobId
    );
  }

  cancelJob(jobId?: string): void {
    const idToCancel = jobId || this.activeJobId();
    if (!idToCancel) return;

    this.testPersonCodingService
      .cancelJob(this.workspaceId, idToCancel)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(result => {
        if (result.success) {
          const translatedMessage =
            this.backendMessageTranslator.translateMessage(result.message);
          this.snackBar.open(
            translatedMessage,
            this.translateService.instant('close'),
            { duration: 3000 }
          );
          this.loadAllJobs();
        } else {
          const translatedErrorMessage = result.message ?
            this.backendMessageTranslator.translateMessage(result.message) :
            '';
          this.snackBar.open(
            this.translateService.instant(
              'test-person-coding.job-cancel-error',
              { message: translatedErrorMessage }
            ),
            this.translateService.instant('close'),
            { duration: 5000 }
          );
        }
      });
  }

  deleteJob(jobId: string): void {
    if (!jobId) return;

    this.testPersonCodingService
      .deleteJob(this.workspaceId, jobId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(result => {
        if (result.success) {
          const translatedMessage =
            this.backendMessageTranslator.translateMessage(result.message);
          this.snackBar.open(
            translatedMessage,
            this.translateService.instant('close'),
            { duration: 3000 }
          );
          this.loadAllJobs();
        } else {
          const translatedErrorMessage = result.message ?
            this.backendMessageTranslator.translateMessage(result.message) :
            '';
          this.snackBar.open(
            this.translateService.instant(
              'test-person-coding.job-delete-error',
              { message: translatedErrorMessage }
            ),
            this.translateService.instant('close'),
            { duration: 5000 }
          );
        }
      });
  }

  restartJob(jobId: string): void {
    if (!jobId) return;

    this.testPersonCodingService
      .restartJob(this.workspaceId, jobId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(result => {
        if (result.success) {
          const translatedMessage = result.message ?
            this.backendMessageTranslator.translateMessage(result.message) :
            this.translateService.instant('test-person-coding.job-restarted');
          this.snackBar.open(
            translatedMessage,
            this.translateService.instant('close'),
            { duration: 3000 }
          );
          if (result.jobId) {
            this.activeJobId.set(result.jobId);
            this.startJobStatusPolling(result.jobId);
            const translatedBackgroundMessage = result.message ?
              this.backendMessageTranslator.translateMessage(result.message) :
              this.translateService.instant(
                'test-person-coding.background-job-started'
              );
            this.snackBar.open(
              translatedBackgroundMessage,
              this.translateService.instant('close'),
              { duration: 5000 }
            );
          }
          this.loadAllJobs();
        } else {
          const translatedErrorMessage = result.message ?
            this.backendMessageTranslator.translateMessage(result.message) :
            '';
          this.snackBar.open(
            this.translateService.instant(
              'test-person-coding.job-restart-error',
              { message: translatedErrorMessage }
            ),
            this.translateService.instant('close'),
            { duration: 5000 }
          );
        }
      });
  }

  showJobResult(job: JobInfo): void {
    if (!job.result) {
      this.snackBar.open(
        this.translateService.instant(
          'test-person-coding.job-result-unavailable'
        ),
        this.translateService.instant('close'),
        { duration: 3000 }
      );
      return;
    }
    const formattedDuration = job.durationMs ?
      this.formatDuration(job.durationMs) :
      null;
    this.dialog.open(TestPersonCodingJobResultDialogComponent, {
      width: '600px',
      data: {
        job,
        formattedDuration,
        autoCoderRun: job.autoCoderRun
      }
    });
  }

  codeAllTestPersons(): void {
    if (this.availableGroups().length > 0) {
      this.selectedGroups = this.availableGroups().map(
        group => group.groupName
      );
      this.codeTestPersons(this.selectedGroups.join(','));
      this.snackBar.open(
        this.translateService.instant('test-person-coding.coding-all-groups', {
          count: this.selectedGroups.length
        }),
        this.translateService.instant('close'),
        { duration: 3000 }
      );
      return;
    }

    this.isLoading.set(true);
    let codingStarted = false;
    this.testResultService
      .getTestPersons(this.workspaceId)
      .pipe(
        catchError(error => {
          this.snackBar.open(
            this.translateService.instant(
              'test-person-coding.fetch-test-persons-error',
              {
                error:
                  error.message ||
                  this.translateService.instant('error.unknown')
              }
            ),
            this.translateService.instant('close'),
            { duration: 5000 }
          );
          return of([]);
        }),
        finalize(() => {
          // The coding request owns the loading state once the lookup hands over.
          if (!codingStarted) this.isLoading.set(false);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(testPersonIds => {
        if (testPersonIds.length === 0) {
          this.snackBar.open(
            this.translateService.instant('test-person-coding.no-test-persons'),
            this.translateService.instant('close'),
            { duration: 3000 }
          );
          return;
        }
        const testPersonIdsString = testPersonIds.join(',');
        codingStarted = true;
        this.codeTestPersons(testPersonIdsString);
        this.snackBar.open(
          this.translateService.instant(
            'test-person-coding.coding-test-persons-count',
            { count: testPersonIds.length }
          ),
          this.translateService.instant('close'),
          { duration: 5000 }
        );
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
    this.selectedGroups = this.availableGroups().map(group => group.groupName);
  }

  truncateText(text: string, maxLength: number): string {
    if (!text) return '';
    return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
  }
}
