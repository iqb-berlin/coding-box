import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  BehaviorSubject, interval, Subscription, forkJoin, of
} from 'rxjs';
import {
  filter, startWith, switchMap, takeWhile, map, catchError
} from 'rxjs/operators';
import { TestResultsUploadResultDialogComponent } from '../components/test-results/test-results-upload-result-dialog.component';
import { FileService } from '../../shared/services/file/file.service';
import { TestResultService, TestResultsOverviewResponse } from '../../shared/services/test-result/test-result.service';
import { TestResultsUploadResultDto, TestResultsUploadIssueDto } from '../../../../../../api-dto/files/test-results-upload-result.dto';

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

@Injectable({
  providedIn: 'root'
})
export class TestResultsUploadStateService {
  private fileService = inject(FileService);
  private testResultService = inject(TestResultService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  private batches$ = new BehaviorSubject<PendingUploadBatch[]>([]);
  private pollingSubscriptions = new Map<string, Subscription>();

  readonly uploadingBatches$ = this.batches$.asObservable();
  private uploadsFinishedSubject = new BehaviorSubject<number | null>(null);
  readonly uploadsFinished$ = this.uploadsFinishedSubject.asObservable().pipe(filter(wsId => wsId !== null));

  constructor() {
    this.resumeFromLocalStorage();
  }

  private getStorageKey(workspaceId: number): string {
    return `pendingUploadJobs_${workspaceId}`;
  }

  registerBatch(batch: PendingUploadBatch) {
    const currentBatches = this.batches$.value;
    this.batches$.next([...currentBatches, batch]);
    this.saveToLocalStorage(batch);
    this.startPolling(batch);
  }

  private startPolling(batch: PendingUploadBatch) {
    const batchKey = `${batch.workspaceId}_${batch.resultType}_${batch.jobIds.join(',')}`;
    if (this.pollingSubscriptions.has(batchKey)) return;

    const sub = interval(1000)
      .pipe(
        startWith(0),
        switchMap(() => forkJoin(
          batch.jobIds.map(id => this.fileService.getUploadJobStatus(batch.workspaceId, id).pipe(
            catchError(() => of({ status: 'failed', progress: 0 }))
          )
          )
        )
        ),
        map(statuses => {
          let totalProgress = 0;
          let completedCount = 0;
          const totalJobs = statuses.length;

          statuses.forEach(status => {
            if (status.status === 'completed' || status.status === 'failed') {
              completedCount += 1;
              totalProgress += 100;
            } else {
              totalProgress += status.progress || 0;
            }
          });

          return {
            avgProgress: Math.floor(totalProgress / totalJobs),
            completedCount,
            totalJobs
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
            this.finishBatch(batch);
            this.pollingSubscriptions.delete(batchKey);
          }
        }
      });

    this.pollingSubscriptions.set(batchKey, sub);
  }

  private finishBatch(batch: PendingUploadBatch) {
    this.testResultService.invalidateCache(batch.workspaceId);

    const workspaceOverview$ = this.testResultService.getWorkspaceOverview(batch.workspaceId).pipe(
      catchError(() => of(batch.beforeOverview))
    );

    const jobStatuses$ = forkJoin(
      batch.jobIds.map(id => this.fileService.getUploadJobStatus(batch.workspaceId, id).pipe(
        catchError(() => of({ status: 'failed' as const, id, progress: 0 }))
      ))
    );

    forkJoin({
      afterOverview: workspaceOverview$,
      jobStatuses: jobStatuses$
    }).subscribe(({ afterOverview, jobStatuses }) => {
      const currentAfterOverview = afterOverview || batch.beforeOverview;
      const delta = {
        testPersons: (currentAfterOverview.testPersons || 0) - (batch.beforeOverview.testPersons || 0),
        testGroups: (currentAfterOverview.testGroups || 0) - (batch.beforeOverview.testGroups || 0),
        uniqueBooklets: (currentAfterOverview.uniqueBooklets || 0) - (batch.beforeOverview.uniqueBooklets || 0),
        uniqueUnits: (currentAfterOverview.uniqueUnits || 0) - (batch.beforeOverview.uniqueUnits || 0),
        uniqueResponses: (currentAfterOverview.uniqueResponses || 0) - (batch.beforeOverview.uniqueResponses || 0)
      };

      const issues = [...batch.initialIssues];
      let importedLogs = false;
      let importedResponses = false;

      jobStatuses.forEach(jobStatus => {
        if (jobStatus.status === 'completed' && 'result' in jobStatus && jobStatus.result) {
          if (jobStatus.result.issues) {
            jobStatus.result.issues.forEach(issue => issues.push(issue));
          }
          if (jobStatus.result.importedLogs) importedLogs = true;
          if (jobStatus.result.importedResponses) importedResponses = true;
        }
      });

      const uploadResult: TestResultsUploadResultDto = {
        expected: delta,
        before: batch.beforeOverview,
        after: currentAfterOverview,
        delta: delta,
        responseStatusCounts: currentAfterOverview.responseStatusCounts || {},
        issues: issues,
        importedLogs: importedLogs || batch.resultType === 'logs',
        importedResponses: importedResponses || batch.resultType === 'responses'
      };

      this.snackBar.open(
        `Upload abgeschlossen: Δ Testpersonen ${delta.testPersons}, Δ Responses ${delta.uniqueResponses}`,
        'OK',
        { duration: 5000 }
      );

      this.dialog.open(TestResultsUploadResultDialogComponent, {
        width: '1000px',
        maxWidth: '95vw',
        data: {
          resultType: batch.resultType,
          result: uploadResult
        }
      });

      this.uploadsFinishedSubject.next(batch.workspaceId);

      const batchKey = `${batch.workspaceId}_${batch.jobIds.join(',')}`;
      const remainingBatches = this.batches$.value.filter(b => `${b.workspaceId}_${b.jobIds.join(',')}` !== batchKey
      );
      this.batches$.next(remainingBatches);

      localStorage.removeItem(this.getStorageKey(batch.workspaceId));
    });
  }

  private saveToLocalStorage(batch: PendingUploadBatch) {
    localStorage.setItem(this.getStorageKey(batch.workspaceId), JSON.stringify(batch));
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
