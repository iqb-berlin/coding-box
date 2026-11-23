import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  BehaviorSubject, defer, interval, Subscription, forkJoin, of, Observable
} from 'rxjs';
import {
  filter, finalize, shareReplay, startWith, switchMap, take, takeWhile, tap, map, catchError
} from 'rxjs/operators';
import { injectUiTranslator } from '../../shared/utils/ui-translator';
import { TestResultsUploadResultDialogComponent } from '../components/test-results/test-results-upload-result-dialog.component';
import {
  TestResultsLogAnomalyDetailsDialogComponent,
  TestResultsLogAnomalyDetailsDialogResult
} from '../components/test-results/test-results-log-anomaly-details-dialog.component';
import {
  TestResultsImportProgressHandle,
  TestResultsImportProgressDialogComponent,
  TestResultsImportProgressState
} from '../components/test-results/test-results-import-progress-dialog.component';
import { FileService } from '../../shared/services/file/file.service';
import { TestResultService, TestResultsOverviewResponse } from '../../shared/services/test-result/test-result.service';
import { TestResultsUploadResultDto, TestResultsUploadIssueDto } from '../../../../../../api-dto/files/test-results-upload-result.dto';
import { TestResultsUploadJobDto } from '../../../../../../api-dto/files/test-results-upload-job.dto';
import { ValidationTaskStateService } from '../../shared/services/validation/validation-task-state.service';
import { TestPersonCodingService } from '../../coding/services/test-person-coding.service';
import { loadUploadCodingContext } from './test-results-upload-coding-context';

export interface PendingUploadBatch {
  workspaceId: number;
  jobIds: string[];
  resultType: 'logs' | 'responses';
  beforeOverview: TestResultsOverviewResponse;
  initialIssues: TestResultsUploadIssueDto[];
  /** File-read progress reported by the queue. Completion is tracked separately. */
  progress: number;
  completedCount: number;
  totalJobs: number;
}

type UploadJobStatus = {
  id?: string;
  status:
  | 'completed'
  | 'waiting'
  | 'active'
  | 'delayed'
  | 'failed'
  | 'paused'
  | 'poll-error';
  progress: number;
  result?: TestResultsUploadResultDto;
  error?: unknown;
};

type ImportSummaryNumberKey =
  | 'responseRows'
  | 'logRows'
  | 'bookletLogRows'
  | 'unitLogRows'
  | 'savedResponses'
  | 'deletedResponses'
  | 'skippedExistingUnits'
  | 'skippedExistingResponses'
  | 'addedUnits'
  | 'changedUnits'
  | 'savedLogs'
  | 'skippedRows'
  | 'skippedLogs';

@Injectable({
  providedIn: 'root'
})
export class TestResultsUploadStateService {
  private readonly uiTranslate = injectUiTranslator();

  private readonly destroyRef = inject(DestroyRef);
  private fileService = inject(FileService);
  private testResultService = inject(TestResultService);
  private testPersonCodingService = inject(TestPersonCodingService);
  private validationTaskStateService = inject(ValidationTaskStateService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  private batches$ = new BehaviorSubject<PendingUploadBatch[]>([]);
  private pollingSubscriptions = new Map<string, Subscription>();
  private pollingErrorCounts = new Map<string, number>();
  private pollingErrorNotifications = new Set<string>();
  private progressHandles = new Map<string, TestResultsImportProgressHandle>();
  private readonly maxSilentPollingErrors = 5;

  readonly uploadingBatches$ = this.batches$.asObservable();
  private uploadsFinishedSubject = new BehaviorSubject<number | null>(null);
  readonly uploadsFinished$ = this.uploadsFinishedSubject.asObservable().pipe(filter(wsId => wsId !== null));

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.pollingSubscriptions.forEach(subscription => subscription.unsubscribe());
      this.pollingSubscriptions.clear();
      this.progressHandles.forEach(handle => {
        handle.dialogRef.close();
        handle.state$.complete();
      });
      this.progressHandles.clear();
    });
    this.resumeFromLocalStorage();
  }

  startChunkedUpload(
    workspaceId: number,
    file: File,
    resultType: 'logs' | 'responses',
    options: Parameters<FileService['uploadTestResultsChunked']>[3],
    beforeOverview: TestResultsOverviewResponse
  ): Observable<TestResultsUploadJobDto[]> {
    return defer(() => {
      const title = resultType === 'logs' ? this.uiTranslate('ui-text.test-results-upload-state.logs-title') : this.uiTranslate('ui-text.test-results-upload-state.responses-title');
      const icon = resultType === 'logs' ? 'article' : 'upload_file';
      const uploadState = (percent: number): TestResultsImportProgressState => (percent >= 100 ? {
        title,
        icon,
        phase: 'preparingUpload',
        phaseLabel: this.uiTranslate('ui-text.test-results-upload-state.preparing-upload'),
        message: this.uiTranslate('ui-text.test-results-upload-state.transfer-complete'),
        mode: 'indeterminate'
      } : {
        title,
        icon,
        phase: 'uploading',
        phaseLabel: this.uiTranslate('ui-text.test-results-upload-state.uploading-file'),
        message: resultType === 'logs' ?
          this.uiTranslate('ui-text.test-results-upload-state.chunked-logs-hint') : this.uiTranslate('ui-text.test-results-upload-state.chunked-responses-hint'),
        percent,
        mode: 'determinate'
      });
      const state$ = new BehaviorSubject(uploadState(0));
      const dialogRef = this.dialog.open(TestResultsImportProgressDialogComponent, {
        width: '560px',
        maxWidth: '95vw',
        disableClose: true,
        closeOnNavigation: false,
        data: { state$ }
      });
      let registered = false;
      return defer(() => this.fileService.uploadTestResultsChunked(
        workspaceId, file, resultType, options, percent => state$.next(uploadState(percent))
      )).pipe(
        take(1),
        tap(jobs => {
          this.registerBatch({
            workspaceId,
            jobIds: jobs.map(job => job.jobId),
            resultType,
            beforeOverview,
            initialIssues: [],
            progress: 0,
            completedCount: 0,
            totalJobs: jobs.length
          }, { dialogRef, state$ });
          registered = true;
        }),
        finalize(() => {
          if (!registered) {
            dialogRef.close();
            state$.complete();
          }
        })
      );
    }).pipe(
      tap({
        error: error => this.snackBar.open(
          this.uiTranslate('ui-text.test-results-upload-state.start-failed', { message: error.message }), this.uiTranslate('ws-admin.export-options.item-dataset-diagnostics-severity-error'), { duration: 5000 }
        )
      }),
      takeUntilDestroyed(this.destroyRef),
      // Upload, progress UI and accepted-job handoff belong to this root provider.
      shareReplay({ bufferSize: 1, refCount: false })
    );
  }

  private getStorageKey(workspaceId: number): string {
    return `pendingUploadJobs_${workspaceId}`;
  }

  registerBatch(
    batch: PendingUploadBatch,
    progressHandle?: TestResultsImportProgressHandle
  ) {
    if (progressHandle) {
      this.progressHandles.set(this.getBatchKey(batch), progressHandle);
      this.updateProgressDialog(batch, {
        phase: 'processing',
        phaseLabel: this.uiTranslate('ui-text.test-results-upload-state.processing'),
        message: this.uiTranslate('ui-text.test-results-upload-state.accepted'),
        completed: batch.completedCount,
        total: batch.totalJobs,
        mode: 'indeterminate'
      });
    }

    const currentBatches = this.batches$.value;
    this.batches$.next([...currentBatches, batch]);
    this.saveToLocalStorage(batch);
    this.startPolling(batch);
  }

  private startPolling(batch: PendingUploadBatch) {
    const batchKey = this.getBatchKey(batch);
    if (this.pollingSubscriptions.has(batchKey)) return;

    const sub = interval(1000)
      .pipe(
        startWith(0),
        switchMap(() => forkJoin(
          batch.jobIds.map(id => this.fileService.getUploadJobStatus(batch.workspaceId, id).pipe(
            catchError(error => of({
              id,
              status: 'poll-error' as const,
              progress: 0,
              error
            }))
          )
          )
        )
        ),
        map(statuses => {
          let totalProgress = 0;
          let completedCount = 0;
          const totalJobs = statuses.length;
          const currentBatch = this.batches$.value.find(b => this.isSameBatch(b, batch));
          const fallbackProgress = currentBatch?.progress || batch.progress || 0;
          const normalizedStatuses = statuses.map((status, index): UploadJobStatus => {
            const jobId = batch.jobIds[index];
            const errorKey = `${batchKey}:${jobId}`;

            if (status.status === 'poll-error') {
              const errorCount = (this.pollingErrorCounts.get(errorKey) || 0) + 1;
              this.pollingErrorCounts.set(errorKey, errorCount);

              if (
                errorCount >= this.maxSilentPollingErrors &&
                !this.pollingErrorNotifications.has(errorKey)
              ) {
                this.pollingErrorNotifications.add(errorKey);
                this.snackBar.open(
                  this.uiTranslate('ui-text.test-results-upload-state.status-unavailable'),
                  'OK',
                  { duration: 6000 }
                );
              }

              return {
                ...status,
                id: jobId,
                progress: fallbackProgress
              };
            }

            this.pollingErrorCounts.delete(errorKey);
            this.pollingErrorNotifications.delete(errorKey);

            return {
              ...status,
              id: String(status.id ?? jobId),
              progress: Number(status.progress || 0)
            };
          });

          normalizedStatuses.forEach(status => {
            if (status.status === 'completed' || status.status === 'failed') {
              completedCount += 1;
              totalProgress += 100;
            } else {
              totalProgress += status.progress || 0;
            }
          });

          return {
            avgProgress: totalJobs > 0 ? Math.floor(totalProgress / totalJobs) : 0,
            completedCount,
            totalJobs,
            jobStatuses: normalizedStatuses
          };
        }),
        takeWhile(res => res.completedCount < res.totalJobs, true)
      )
      .subscribe({
        next: res => {
          const currentBatches = this.batches$.value.map(b => {
            if (b.workspaceId === batch.workspaceId && JSON.stringify(b.jobIds) === JSON.stringify(batch.jobIds)) {
              return { ...b, progress: res.avgProgress, completedCount: res.completedCount };
            }
            return b;
          });
          this.batches$.next(currentBatches);
          if (res.completedCount === res.totalJobs) {
            this.finishBatch(batch, res.jobStatuses);
            this.pollingSubscriptions.delete(batchKey);
            return;
          }

          this.updateProcessingProgressDialog(batch, res.avgProgress, res.completedCount, res.totalJobs);
        }
      });

    this.pollingSubscriptions.set(batchKey, sub);
  }

  private updateProcessingProgressDialog(
    batch: PendingUploadBatch,
    readProgress: number,
    completed: number,
    total: number
  ): void {
    const isReadingFile = readProgress > 0 && readProgress < 100;
    this.updateProgressDialog(batch, {
      phase: isReadingFile ? 'readingFile' : 'processing',
      phaseLabel: isReadingFile ?
        this.uiTranslate('ui-text.test-results-upload-state.reading-file') :
        this.uiTranslate('ui-text.test-results-upload-state.processing'),
      message: this.uiTranslate('ui-text.test-results-upload-state.processing-jobs'),
      percent: isReadingFile ? readProgress : undefined,
      completed,
      total,
      mode: isReadingFile ? 'determinate' : 'indeterminate'
    });
  }

  private finishBatch(
    batch: PendingUploadBatch,
    finalJobStatuses?: UploadJobStatus[]
  ) {
    this.testResultService.invalidateCache(batch.workspaceId);
    this.testPersonCodingService.invalidateCodingStatusCache(batch.workspaceId);
    this.validationTaskStateService.invalidateWorkspace(batch.workspaceId);

    const jobStatuses$ = this.waitForCompletedJobResults(batch, finalJobStatuses);

    jobStatuses$.subscribe(jobStatuses => {
      this.updateProgressDialog(batch, {
        phase: 'refreshingOverview',
        phaseLabel: this.uiTranslate('ui-text.test-results-upload-result-dialog.refreshing-overview'),
        message: this.uiTranslate('ui-text.test-results-upload-state.completed-refreshing'),
        completed: batch.totalJobs,
        total: batch.totalJobs,
        mode: 'indeterminate'
      });

      const { issues, completedResults, hasMissingCompletedResult } = this.collectJobResults(batch, jobStatuses);
      const lastCompletedResult = completedResults[completedResults.length - 1];
      const expected = completedResults.length > 0 ?
        completedResults.reduce(
          (sum, result) => this.addStats(sum, result.expected),
          this.emptyStats()
        ) :
        this.emptyStats();
      const jobDelta = completedResults.reduce(
        (sum, result) => this.addStats(sum, result.delta),
        this.emptyStats()
      );
      this.pollWorkspaceOverviewAfterUpload(
        batch,
        expected,
        jobDelta,
        completedResults,
        hasMissingCompletedResult
      ).subscribe(overviewResult => {
        const overviewPending =
          !overviewResult.loaded ||
          this.shouldTreatOverviewAsPending(
            batch,
            overviewResult.changed,
            expected,
            jobDelta,
            completedResults,
            hasMissingCompletedResult
          );
        const currentAfterOverview =
          overviewPending && lastCompletedResult?.after ?
            lastCompletedResult.after :
            overviewResult.overview ||
            lastCompletedResult?.after ||
            batch.beforeOverview;

        if (overviewPending) {
          issues.push({
            level: 'warning',
            category: 'other',
            message:
              this.uiTranslate('ui-text.test-results-upload-state.overview-pending')
          });
        }

        const effectiveExpected = completedResults.length > 0 ?
          expected :
          this.statsDelta(currentAfterOverview, batch.beforeOverview);

        const overviewDelta = overviewResult.overview ?
          this.statsDelta(currentAfterOverview, batch.beforeOverview) :
          this.emptyStats();
        const delta =
          overviewPending && this.hasNonZeroStats(jobDelta) ?
            jobDelta :
            overviewDelta;

        const uploadResult: TestResultsUploadResultDto = {
          expected: effectiveExpected,
          before: batch.beforeOverview,
          after: currentAfterOverview,
          delta,
          responseStatusCounts:
            overviewResult.overview?.responseStatusCounts ||
            lastCompletedResult?.responseStatusCounts ||
            this.mergeStatusCounts(completedResults),
          issues: issues,
          importSummary: this.mergeImportSummaries(completedResults),
          logMetrics: this.mergeLogMetrics(completedResults),
          importedLogs: batch.resultType === 'logs' || completedResults.some(result => result.importedLogs),
          importedResponses: batch.resultType === 'responses' || completedResults.some(result => result.importedResponses),
          overviewPending,
          overviewMessage: overviewPending ?
            this.uiTranslate('ui-text.test-results-upload-state.aggregated-overview-pending') :
            undefined
        };

        this.showUploadResult(batch, uploadResult, completedResults);
      });
    });
  }

  private collectJobResults(batch: PendingUploadBatch, jobStatuses: UploadJobStatus[]) {
    const issues = [...batch.initialIssues];
    const completedResults: TestResultsUploadResultDto[] = [];
    const hasMissingCompletedResult = this.hasCompletedJobsWithoutResult(jobStatuses);

    for (const jobStatus of jobStatuses) {
      if (jobStatus.status === 'completed' && jobStatus.result) {
        completedResults.push(jobStatus.result);
        // Import reports can contain too many issues to spread into a single call.
        for (const issue of jobStatus.result.issues || []) issues.push(issue);
      } else if (jobStatus.status === 'failed') {
        issues.push({
          level: 'error',
          category: 'other',
          message: this.uiTranslate('ui-text.test-results-upload-state.job-failed', { value1: jobStatus.id || '' })
        });
      }
    }
    if (hasMissingCompletedResult) {
      issues.push({
        level: 'warning',
        category: 'other',
        message: this.uiTranslate('ui-text.test-results-upload-state.partial-overview')
      });
    }
    return { issues, completedResults, hasMissingCompletedResult };
  }

  private showUploadResult(
    batch: PendingUploadBatch,
    uploadResult: TestResultsUploadResultDto,
    completedResults: TestResultsUploadResultDto[]
  ): void {
    this.updateProgressDialog(batch, {
      phase: 'preparingResult',
      phaseLabel: this.uiTranslate('ui-text.test-results-upload-state.preparing-result'),
      message: this.uiTranslate('ui-text.test-results-upload-state.loading-result-details'),
      completed: batch.totalJobs,
      total: batch.totalJobs,
      mode: 'indeterminate'
    });
    loadUploadCodingContext(
      this.testPersonCodingService,
      batch.workspaceId,
      completedResults,
      batch.resultType === 'responses'
    ).subscribe(codingContext => {
      this.closeProgressDialog(batch);
      this.dialog.open(TestResultsUploadResultDialogComponent, {
        width: '90vw',
        maxWidth: '95vw',
        data: {
          resultType: batch.resultType,
          result: { ...uploadResult, codingFreshness: codingContext.codingFreshness || undefined },
          manualAppliedResultsOverview: codingContext.manualOverview.overview,
          manualAppliedResultsOverviewLoadFailed: codingContext.manualOverview.loadFailed
        }
      });

      if (batch.resultType === 'logs') {
        this.showLogUploadAnomalyFeedback(batch.workspaceId);
      } else {
        const { delta, overviewPending } = uploadResult;
        this.snackBar.open(
          overviewPending ?
            this.uiTranslate('ui-text.test-results-upload-state.completed-overview-pending') :
            this.uiTranslate('ui-text.test-results-upload-state.completed-delta', { testPersons: delta.testPersons, uniqueResponses: delta.uniqueResponses }),
          'OK',
          { duration: 5000 }
        );
      }

      this.uploadsFinishedSubject.next(batch.workspaceId);

      const batchKey = this.getBatchKey(batch);
      const remainingBatches = this.batches$.value.filter(b => this.getBatchKey(b) !== batchKey);
      this.batches$.next(remainingBatches);
      localStorage.removeItem(this.getStorageKey(batch.workspaceId));
    });
  }

  private showLogUploadAnomalyFeedback(workspaceId: number): void {
    this.testResultService.getLogAnomalySummary(workspaceId).subscribe({
      next: summary => {
        const affectedBooklets = Number(summary?.affectedBooklets || 0);
        const snackBarRef = this.snackBar.open(
          affectedBooklets > 0 ?
            this.uiTranslate('ui-text.test-results-upload-state.log-anomalies-found', { affectedBooklets: affectedBooklets }) :
            this.uiTranslate('ui-text.test-results-upload-state.no-log-anomalies'),
          affectedBooklets > 0 ? 'anzeigen' : 'OK',
          { duration: affectedBooklets > 0 ? 8000 : 5000 }
        );

        if (affectedBooklets > 0) {
          snackBarRef.onAction().subscribe(() => {
            this.openLogAnomalyDetailsDialog(workspaceId, affectedBooklets);
          });
        }
      },
      error: () => {
        this.snackBar.open(
          this.uiTranslate('ui-text.test-results-upload-state.log-quality-unavailable'),
          'OK',
          { duration: 6000 }
        );
      }
    });
  }

  private openLogAnomalyDetailsDialog(
    workspaceId: number,
    affectedBooklets: number
  ): void {
    const loadingSnackBar = this.snackBar.open(
      this.uiTranslate('ui-text.test-results.loading-log-anomalies'),
      '',
      { duration: undefined }
    );

    this.testResultService.getLogAnomalyDetails(workspaceId).subscribe({
      next: details => {
        loadingSnackBar.dismiss();
        if (!details.data.length) {
          this.snackBar.open(
            this.uiTranslate('ui-text.test-results.no-log-anomaly-details'),
            'OK',
            { duration: 4000 }
          );
          return;
        }

        const dialogRef = this.dialog.open<
          TestResultsLogAnomalyDetailsDialogComponent,
          {
            affectedBooklets: number;
            rows: typeof details.data;
            truncated: boolean;
          },
        TestResultsLogAnomalyDetailsDialogResult | undefined
        >(TestResultsLogAnomalyDetailsDialogComponent, {
          width: '900px',
          maxWidth: '95vw',
          data: {
            affectedBooklets,
            rows: details.data,
            truncated: details.total > details.data.length
          }
        });

        dialogRef.afterClosed().subscribe(result => {
          if (result?.showTable) {
            this.testResultService.requestFlatResponseFilters(
              workspaceId,
              { logAnomalies: 'any' },
              { forceShowLogAnomalies: true }
            );
          }
        });
      },
      error: () => {
        loadingSnackBar.dismiss();
        this.snackBar.open(
          this.uiTranslate('ui-text.test-results.log-anomalies-load-failed'),
          'OK',
          { duration: 4000 }
        );
      }
    });
  }

  private fetchJobStatuses(batch: PendingUploadBatch): Observable<UploadJobStatus[]> {
    return forkJoin(
      batch.jobIds.map(id => this.fileService.getUploadJobStatus(batch.workspaceId, id).pipe(
        catchError(error => of({
          id,
          status: 'poll-error' as const,
          progress: 0,
          error
        }))
      ))
    ).pipe(
      map(statuses => statuses.map((status, index): UploadJobStatus => ({
        ...status,
        id: String(status.id ?? batch.jobIds[index]),
        status: status.status as UploadJobStatus['status'],
        progress: Number(status.progress || 0)
      })))
    );
  }

  private waitForCompletedJobResults(
    batch: PendingUploadBatch,
    initialStatuses?: UploadJobStatus[]
  ): Observable<UploadJobStatus[]> {
    const maxAttempts = 8;
    const retryDelayMs = 500;

    return new Observable(subscriber => {
      let attempts = 0;
      let timeoutId: number | undefined;
      let innerSubscription: Subscription | undefined;
      let fetchLatestStatuses!: () => void;

      const finishOrRetry = (statuses: UploadJobStatus[]) => {
        if (
          !this.hasCompletedJobsWithoutResult(statuses) ||
          attempts >= maxAttempts
        ) {
          subscriber.next(statuses);
          subscriber.complete();
          return;
        }

        attempts += 1;
        this.updateProgressDialog(batch, {
          phase: 'preparingResult',
          phaseLabel: this.uiTranslate('ui-text.test-results-upload-state.reading-result'),
          message:
            this.uiTranslate('ui-text.test-results-upload-state.waiting-for-results'),
          completed: batch.totalJobs,
          total: batch.totalJobs,
          mode: 'indeterminate'
        });
        timeoutId = window.setTimeout(fetchLatestStatuses, retryDelayMs);
      };

      fetchLatestStatuses = () => {
        innerSubscription = this.fetchJobStatuses(batch).subscribe({
          next: finishOrRetry,
          error: error => subscriber.error(error)
        });
      };

      if (initialStatuses) {
        finishOrRetry(initialStatuses);
      } else {
        fetchLatestStatuses();
      }

      return () => {
        if (timeoutId !== undefined) {
          window.clearTimeout(timeoutId);
        }
        innerSubscription?.unsubscribe();
      };
    });
  }

  private saveToLocalStorage(batch: PendingUploadBatch) {
    localStorage.setItem(this.getStorageKey(batch.workspaceId), JSON.stringify(batch));
  }

  private getBatchKey(batch: Pick<PendingUploadBatch, 'workspaceId' | 'resultType' | 'jobIds'>): string {
    return `${batch.workspaceId}_${batch.resultType}_${batch.jobIds.join(',')}`;
  }

  private updateProgressDialog(
    batch: PendingUploadBatch,
    patch: Omit<TestResultsImportProgressState, 'title' | 'icon'> & Partial<Pick<TestResultsImportProgressState, 'title' | 'icon'>>
  ): void {
    const handle = this.progressHandles.get(this.getBatchKey(batch));
    if (!handle) return;

    handle.state$.next({
      title: patch.title || this.getProgressTitle(batch.resultType),
      icon: patch.icon || this.getProgressIcon(batch.resultType),
      ...patch
    });
  }

  private closeProgressDialog(batch: PendingUploadBatch): void {
    const batchKey = this.getBatchKey(batch);
    const handle = this.progressHandles.get(batchKey);
    if (!handle) return;

    handle.dialogRef.close();
    handle.state$.complete();
    this.progressHandles.delete(batchKey);
  }

  private getProgressTitle(resultType: 'logs' | 'responses'): string {
    return resultType === 'logs' ? this.uiTranslate('ui-text.test-results-upload-state.logs-title') : this.uiTranslate('ui-text.test-results-upload-state.responses-title');
  }

  private getProgressIcon(resultType: 'logs' | 'responses'): string {
    return resultType === 'logs' ? 'article' : 'upload_file';
  }

  private pollWorkspaceOverviewAfterUpload(
    batch: PendingUploadBatch,
    expected: TestResultsUploadResultDto['expected'],
    jobDelta: TestResultsUploadResultDto['delta'],
    completedResults: TestResultsUploadResultDto[],
    hasMissingCompletedResult: boolean = false
  ): Observable<{
    overview: TestResultsOverviewResponse | null;
    loaded: boolean;
    changed: boolean;
  }> {
    const shouldWaitForOverviewChange =
      batch.resultType === 'responses' &&
      (
        this.hasNonZeroStats(jobDelta) ||
        this.hasSuspiciousZeroJobStats(completedResults) ||
        (
          this.isEmptyStats(batch.beforeOverview) &&
          (expected.uniqueResponses || 0) > 0
        ) ||
        (
          hasMissingCompletedResult &&
          this.isEmptyStats(batch.beforeOverview)
        )
      );
    const attempts = shouldWaitForOverviewChange ? 12 : 1;
    return new Observable(subscriber => {
      let attempt = 0;
      let lastOverview: TestResultsOverviewResponse | null = null;
      let timeoutId: number | undefined;
      let innerSubscription: Subscription | undefined;

      const emitFinal = () => {
        subscriber.next({
          overview: lastOverview,
          loaded: !!lastOverview,
          changed: lastOverview ?
            this.hasOverviewChanged(lastOverview, batch.beforeOverview) :
            false
        });
        subscriber.complete();
      };

      const poll = () => {
        innerSubscription = this.testResultService
          .getWorkspaceOverview(batch.workspaceId)
          .subscribe({
            next: overview => {
              if (overview) {
                lastOverview = overview;
                const changed = this.hasOverviewChanged(overview, batch.beforeOverview);

                if (!shouldWaitForOverviewChange || changed) {
                  subscriber.next({ overview, loaded: true, changed });
                  subscriber.complete();
                  return;
                }
              }

              attempt += 1;
              if (attempt >= attempts) {
                emitFinal();
                return;
              }

              timeoutId = window.setTimeout(poll, 1000);
            },
            error: () => {
              attempt += 1;
              if (attempt >= attempts) {
                emitFinal();
                return;
              }

              timeoutId = window.setTimeout(poll, 1000);
            }
          });
      };

      poll();

      return () => {
        if (timeoutId !== undefined) {
          window.clearTimeout(timeoutId);
        }
        innerSubscription?.unsubscribe();
      };
    });
  }

  private shouldTreatOverviewAsPending(
    batch: PendingUploadBatch,
    overviewChanged: boolean,
    expected: TestResultsUploadResultDto['expected'],
    jobDelta: TestResultsUploadResultDto['delta'],
    completedResults: TestResultsUploadResultDto[],
    hasMissingCompletedResult: boolean = false
  ): boolean {
    if (batch.resultType !== 'responses' || overviewChanged) return false;

    return this.hasNonZeroStats(jobDelta) ||
      this.hasSuspiciousZeroJobStats(completedResults) ||
      (
        this.isEmptyStats(batch.beforeOverview) &&
        (expected.uniqueResponses || 0) > 0
      ) ||
      (
        hasMissingCompletedResult &&
        this.isEmptyStats(batch.beforeOverview)
      );
  }

  private isSameBatch(a: PendingUploadBatch, b: PendingUploadBatch): boolean {
    return a.workspaceId === b.workspaceId &&
      JSON.stringify(a.jobIds) === JSON.stringify(b.jobIds);
  }

  private emptyStats(): TestResultsUploadResultDto['expected'] {
    return {
      testPersons: 0,
      testGroups: 0,
      uniqueBooklets: 0,
      uniqueUnits: 0,
      uniqueResponses: 0
    };
  }

  private addStats(
    a: TestResultsUploadResultDto['expected'],
    b: Partial<TestResultsUploadResultDto['expected']> | undefined
  ): TestResultsUploadResultDto['expected'] {
    return {
      testPersons: (a.testPersons || 0) + (b?.testPersons || 0),
      testGroups: (a.testGroups || 0) + (b?.testGroups || 0),
      uniqueBooklets: (a.uniqueBooklets || 0) + (b?.uniqueBooklets || 0),
      uniqueUnits: (a.uniqueUnits || 0) + (b?.uniqueUnits || 0),
      uniqueResponses: (a.uniqueResponses || 0) + (b?.uniqueResponses || 0)
    };
  }

  private statsDelta(
    after: Partial<TestResultsOverviewResponse>,
    before: Partial<TestResultsOverviewResponse>
  ): TestResultsUploadResultDto['expected'] {
    return {
      testPersons: (after.testPersons || 0) - (before.testPersons || 0),
      testGroups: (after.testGroups || 0) - (before.testGroups || 0),
      uniqueBooklets: (after.uniqueBooklets || 0) - (before.uniqueBooklets || 0),
      uniqueUnits: (after.uniqueUnits || 0) - (before.uniqueUnits || 0),
      uniqueResponses: (after.uniqueResponses || 0) - (before.uniqueResponses || 0)
    };
  }

  private hasOverviewChanged(
    after: Partial<TestResultsOverviewResponse>,
    before: Partial<TestResultsOverviewResponse>
  ): boolean {
    return this.hasNonZeroStats(this.statsDelta(after, before));
  }

  private hasNonZeroStats(stats?: Partial<TestResultsUploadResultDto['expected']>): boolean {
    return (stats?.testPersons || 0) !== 0 ||
      (stats?.testGroups || 0) !== 0 ||
      (stats?.uniqueBooklets || 0) !== 0 ||
      (stats?.uniqueUnits || 0) !== 0 ||
      (stats?.uniqueResponses || 0) !== 0;
  }

  private isEmptyStats(stats?: Partial<TestResultsUploadResultDto['expected']>): boolean {
    return !this.hasNonZeroStats(stats);
  }

  private hasSuspiciousZeroJobStats(
    results: TestResultsUploadResultDto[]
  ): boolean {
    return results.some(result => this.hasNonZeroStats(result.expected) &&
      this.isEmptyStats(result.before) &&
      this.isEmptyStats(result.after)
    );
  }

  private hasCompletedJobsWithoutResult(statuses: UploadJobStatus[]): boolean {
    return statuses.some(status => status.status === 'completed' && !status.result);
  }

  private mergeStatusCounts(
    results: TestResultsUploadResultDto[]
  ): Record<string, number> {
    return results.reduce<Record<string, number>>((acc, result) => {
      Object.entries(result.responseStatusCounts || {}).forEach(([status, count]) => {
        acc[status] = (acc[status] || 0) + Number(count || 0);
      });
      return acc;
    }, {});
  }

  private mergeImportSummaries(
    results: TestResultsUploadResultDto[]
  ): TestResultsUploadResultDto['importSummary'] | undefined {
    const summaries = results
      .map(result => result.importSummary)
      .filter((summary): summary is NonNullable<TestResultsUploadResultDto['importSummary']> => !!summary);

    if (summaries.length === 0) return undefined;

    const issueCounts = summaries.reduce<Record<string, number>>(
      (acc, summary) => {
        Object.entries(summary.issueCounts || {}).forEach(([category, count]) => {
          acc[category] = (acc[category] || 0) + Number(count || 0);
        });
        return acc;
      },
      {}
    );

    return {
      totalRows: summaries.reduce((sum, summary) => sum + Number(summary.totalRows || 0), 0),
      overwriteMode: this.mergeSingleValue(summaries, 'overwriteMode'),
      scope: this.mergeSingleValue(summaries, 'scope'),
      responseRows: this.sumOptional(summaries, 'responseRows'),
      logRows: this.sumOptional(summaries, 'logRows'),
      bookletLogRows: this.sumOptional(summaries, 'bookletLogRows'),
      unitLogRows: this.sumOptional(summaries, 'unitLogRows'),
      savedResponses: this.sumOptional(summaries, 'savedResponses'),
      deletedResponses: this.sumOptional(summaries, 'deletedResponses'),
      skippedExistingUnits: this.sumOptional(summaries, 'skippedExistingUnits'),
      skippedExistingResponses: this.sumOptional(summaries, 'skippedExistingResponses'),
      addedUnits: this.sumOptional(summaries, 'addedUnits'),
      changedUnits: this.sumOptional(summaries, 'changedUnits'),
      savedLogs: this.sumOptional(summaries, 'savedLogs'),
      skippedRows: this.sumOptional(summaries, 'skippedRows'),
      skippedLogs: this.sumOptional(summaries, 'skippedLogs'),
      issueCounts: Object.keys(issueCounts).length ?
        issueCounts as NonNullable<TestResultsUploadResultDto['importSummary']>['issueCounts'] :
        undefined
    };
  }

  private sumOptional(
    summaries: NonNullable<TestResultsUploadResultDto['importSummary']>[],
    key: ImportSummaryNumberKey
  ): number | undefined {
    const hasValue = summaries.some(summary => summary[key] !== undefined);
    if (!hasValue) return undefined;
    return summaries.reduce((sum, summary) => sum + Number(summary[key] || 0), 0);
  }

  private mergeSingleValue<
    K extends 'overwriteMode' | 'scope'
  >(
    summaries: NonNullable<TestResultsUploadResultDto['importSummary']>[],
    key: K
  ): NonNullable<TestResultsUploadResultDto['importSummary']>[K] | undefined {
    const values = Array.from(new Set(
      summaries
        .map(summary => summary[key])
        .filter((value): value is NonNullable<NonNullable<TestResultsUploadResultDto['importSummary']>[K]> => !!value)
    ));

    return values.length === 1 ? values[0] : undefined;
  }

  private mergeLogMetrics(
    results: TestResultsUploadResultDto[]
  ): TestResultsUploadResultDto['logMetrics'] | undefined {
    const metrics = results
      .map(result => result.logMetrics)
      .filter((metric): metric is NonNullable<TestResultsUploadResultDto['logMetrics']> => !!metric);

    if (metrics.length === 0) return undefined;

    return {
      bookletsWithLogs: metrics.reduce((sum, metric) => sum + metric.bookletsWithLogs, 0),
      totalBooklets: metrics.reduce((sum, metric) => sum + metric.totalBooklets, 0),
      unitsWithLogs: metrics.reduce((sum, metric) => sum + metric.unitsWithLogs, 0),
      totalUnits: metrics.reduce((sum, metric) => sum + metric.totalUnits, 0),
      bookletDetails: metrics.flatMap(metric => metric.bookletDetails || []),
      unitDetails: metrics.flatMap(metric => metric.unitDetails || [])
    };
  }

  private resumeFromLocalStorage() {
    // Bullseye: We need to find all keys matching pendingUploadJobs_*
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('pendingUploadJobs_')) {
        try {
          const batch = JSON.parse(localStorage.getItem(key)!) as PendingUploadBatch;
          this.registerBatch(batch);
        } catch (e) {
          localStorage.removeItem(key);
        }
      }
    }
  }
}
