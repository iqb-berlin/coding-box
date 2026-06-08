import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  BehaviorSubject, interval, Subscription, forkJoin, of, Observable
} from 'rxjs';
import {
  filter, startWith, switchMap, takeWhile, map, catchError
} from 'rxjs/operators';
import { TestResultsUploadResultDialogComponent } from '../components/test-results/test-results-upload-result-dialog.component';
import {
  TestResultsLogAnomalyDetailsDialogComponent,
  TestResultsLogAnomalyDetailsDialogResult
} from '../components/test-results/test-results-log-anomaly-details-dialog.component';
import {
  TestResultsImportProgressHandle,
  TestResultsImportProgressState
} from '../components/test-results/test-results-import-progress-dialog.component';
import { FileService } from '../../shared/services/file/file.service';
import { TestResultService, TestResultsOverviewResponse } from '../../shared/services/test-result/test-result.service';
import { TestResultsUploadResultDto, TestResultsUploadIssueDto } from '../../../../../../api-dto/files/test-results-upload-result.dto';
import { ValidationTaskStateService } from '../../shared/services/validation/validation-task-state.service';
import { TestPersonCodingService } from '../../coding/services/test-person-coding.service';
import {
  getSecondAutocodingFreshnessWarnings,
  ManualCodingCompletionOverview
} from '../../shared/utils/coding-freshness-text.util';

export interface PendingUploadBatch {
  workspaceId: number;
  jobIds: string[];
  resultType: 'logs' | 'responses';
  beforeOverview: TestResultsOverviewResponse;
  initialIssues: TestResultsUploadIssueDto[];
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

type ManualOverviewResult = {
  overview: ManualCodingCompletionOverview | null;
  loadFailed: boolean;
};

type UploadCodingContext = {
  codingFreshness: TestResultsUploadResultDto['codingFreshness'] | null;
  manualOverview: ManualOverviewResult;
};

@Injectable({
  providedIn: 'root'
})
export class TestResultsUploadStateService {
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
    this.resumeFromLocalStorage();
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
        phaseLabel: 'Verarbeitung läuft',
        message: 'Die Datei wurde angenommen. Der Server verarbeitet die Upload-Jobs.',
        percent: batch.progress,
        completed: batch.completedCount,
        total: batch.totalJobs,
        mode: 'determinate'
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
                  'Upload läuft möglicherweise weiter, aber der Status konnte gerade nicht gelesen werden.',
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
          this.updateProgressDialog(batch, {
            phase: 'processing',
            phaseLabel: 'Verarbeitung läuft',
            message: 'Der Server verarbeitet die Upload-Jobs.',
            percent: res.avgProgress,
            completed: res.completedCount,
            total: res.totalJobs,
            mode: 'determinate'
          });

          if (res.completedCount === res.totalJobs) {
            this.finishBatch(batch, res.jobStatuses);
            this.pollingSubscriptions.delete(batchKey);
          }
        }
      });

    this.pollingSubscriptions.set(batchKey, sub);
  }

  private finishBatch(
    batch: PendingUploadBatch,
    finalJobStatuses?: UploadJobStatus[]
  ) {
    this.updateProgressDialog(batch, {
      phase: 'refreshingOverview',
      phaseLabel: 'Übersicht wird aktualisiert',
      message: 'Die Jobs sind abgeschlossen. Lade die aktualisierten Ergebniszahlen.',
      percent: 100,
      completed: batch.totalJobs,
      total: batch.totalJobs,
      mode: 'indeterminate'
    });
    this.testResultService.invalidateCache(batch.workspaceId);
    this.validationTaskStateService.invalidateWorkspace(batch.workspaceId);

    const jobStatuses$ = this.waitForCompletedJobResults(batch, finalJobStatuses);

    jobStatuses$.subscribe(jobStatuses => {
      const issues = [...batch.initialIssues];
      let importedLogs = false;
      let importedResponses = false;
      const completedResults: TestResultsUploadResultDto[] = [];
      const hasMissingCompletedResult =
        this.hasCompletedJobsWithoutResult(jobStatuses);

      jobStatuses.forEach(jobStatus => {
        if (jobStatus.status === 'completed' && 'result' in jobStatus && jobStatus.result) {
          completedResults.push(jobStatus.result);
          if (jobStatus.result.issues) {
            jobStatus.result.issues.forEach(issue => issues.push(issue));
          }
          if (jobStatus.result.importedLogs) importedLogs = true;
          if (jobStatus.result.importedResponses) importedResponses = true;
        } else if (jobStatus.status === 'failed') {
          issues.push({
            level: 'error',
            category: 'other',
            message: `Upload-Job ${jobStatus.id || ''} ist fehlgeschlagen.`
          });
        }
      });
      if (hasMissingCompletedResult) {
        issues.push({
          level: 'warning',
          category: 'other',
          message:
            'Mindestens ein Upload-Job wurde als abgeschlossen gemeldet, aber die Ergebniszahlen waren noch nicht vollständig abrufbar. Die Anzeige verwendet deshalb die geladene Arbeitsbereichsübersicht.'
        });
      }

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
              'Die aktualisierte Arbeitsbereichsübersicht konnte noch nicht geladen werden. Die Zahlen stammen aus dem Upload-Job oder werden nach Aktualisierung sichtbar.'
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
          importedLogs: importedLogs || batch.resultType === 'logs',
          importedResponses: importedResponses || batch.resultType === 'responses',
          overviewPending,
          overviewMessage: overviewPending ?
            'Der Upload-Job ist abgeschlossen, aber die aggregierte Arbeitsbereichsübersicht konnte noch nicht zuverlässig gelesen werden. Bitte die Ansicht gleich noch einmal aktualisieren.' :
            undefined
        };

        if (batch.resultType === 'logs') {
          this.showLogUploadAnomalyFeedback(batch.workspaceId);
        } else {
          this.snackBar.open(
            overviewPending ?
              'Upload abgeschlossen; die Übersicht wird noch aktualisiert.' :
              `Upload abgeschlossen: Δ Testpersonen ${delta.testPersons}, Δ Responses ${delta.uniqueResponses}`,
            'OK',
            { duration: 5000 }
          );
        }

        this.closeProgressDialog(batch);

        this.loadUploadCodingContext(
          batch.workspaceId,
          completedResults,
          batch.resultType === 'responses'
        ).subscribe(codingContext => {
          const dialogUploadResult: TestResultsUploadResultDto = {
            ...uploadResult,
            codingFreshness: codingContext.codingFreshness || undefined
          };

          this.dialog.open(TestResultsUploadResultDialogComponent, {
            width: '90vw',
            maxWidth: '95vw',
            data: {
              resultType: batch.resultType,
              result: dialogUploadResult,
              manualAppliedResultsOverview: codingContext.manualOverview.overview,
              manualAppliedResultsOverviewLoadFailed: codingContext.manualOverview.loadFailed
            }
          });

          this.uploadsFinishedSubject.next(batch.workspaceId);

          const batchKey = this.getBatchKey(batch);
          const remainingBatches = this.batches$.value.filter(b => this.getBatchKey(b) !== batchKey);
          this.batches$.next(remainingBatches);

          localStorage.removeItem(this.getStorageKey(batch.workspaceId));
        });
      });
    });
  }

  private loadUploadCodingContext(
    workspaceId: number,
    completedResults: TestResultsUploadResultDto[],
    shouldLoadCodingFreshness: boolean
  ): Observable<UploadCodingContext> {
    const completedCodingFreshness = this.getLatestCodingFreshness(completedResults);
    const codingFreshness$ = completedCodingFreshness || !shouldLoadCodingFreshness ?
      of(completedCodingFreshness || null) :
      this.testPersonCodingService.getCodingFreshness(workspaceId)
        .pipe(catchError(() => of(null)));

    return codingFreshness$.pipe(
      switchMap(codingFreshness => {
        const manualOverview$ = this.hasSecondAutocodingFreshnessWarning(codingFreshness) ?
          this.loadManualAppliedResultsOverview(workspaceId) :
          of({
            overview: null,
            loadFailed: false
          });

        return manualOverview$.pipe(
          map(manualOverview => ({
            codingFreshness,
            manualOverview
          }))
        );
      })
    );
  }

  private getLatestCodingFreshness(
    completedResults: TestResultsUploadResultDto[]
  ): TestResultsUploadResultDto['codingFreshness'] | null {
    for (let index = completedResults.length - 1; index >= 0; index -= 1) {
      const codingFreshness = completedResults[index].codingFreshness;
      if (codingFreshness) {
        return codingFreshness;
      }
    }

    return null;
  }

  private hasSecondAutocodingFreshnessWarning(
    codingFreshness: TestResultsUploadResultDto['codingFreshness'] | null
  ): boolean {
    return getSecondAutocodingFreshnessWarnings(codingFreshness?.items || []).length > 0;
  }

  private loadManualAppliedResultsOverview(
    workspaceId: number
  ): Observable<ManualOverviewResult> {
    return this.testPersonCodingService.getAppliedResultsOverview(workspaceId)
      .pipe(
        map(overview => ({
          overview,
          loadFailed: overview === null
        })),
        catchError(() => of({
          overview: null,
          loadFailed: true
        }))
      );
  }

  private showLogUploadAnomalyFeedback(workspaceId: number): void {
    this.testResultService.getLogAnomalySummary(workspaceId).subscribe({
      next: summary => {
        const affectedBooklets = Number(summary?.affectedBooklets || 0);
        const snackBarRef = this.snackBar.open(
          affectedBooklets > 0 ?
            `Logs importiert. ${affectedBooklets} auffällige Testhefte erkannt.` :
            'Logs importiert. Keine auffälligen Testhefte erkannt.',
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
          'Logs importiert. Die Log-Qualität konnte nicht geprüft werden.',
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
      'Lade Log-Auffälligkeiten...',
      '',
      { duration: undefined }
    );

    this.testResultService.getLogAnomalyDetails(workspaceId).subscribe({
      next: details => {
        loadingSnackBar.dismiss();
        if (!details.data.length) {
          this.snackBar.open(
            'Keine Log-Auffälligkeiten gefunden.',
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
          'Log-Auffälligkeiten konnten nicht geladen werden.',
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
          phase: 'refreshingOverview',
          phaseLabel: 'Ergebnis wird gelesen',
          message:
            'Die Jobs sind abgeschlossen. Warte auf die vollständigen Ergebnisdaten.',
          percent: 100,
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
    return resultType === 'logs' ? 'Upload-Ergebnis (Logs)' : 'Upload-Ergebnis (Antworten)';
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
