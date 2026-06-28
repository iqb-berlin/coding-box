import { Injectable, OnDestroy } from '@angular/core';
import {
  BehaviorSubject,
  Observable,
  Subject,
  Subscription,
  catchError,
  interval,
  of,
  throwError
} from 'rxjs';
import {
  map,
  switchMap,
  takeUntil,
  tap
} from 'rxjs/operators';
import { CodingExportEstimate, CodingJobBackendService } from '../../../coding/services/coding-job-backend.service';
import { AppService } from '../../../core/services/app.service';

export interface ExportJob {
  jobId: string;
  workspaceId: number;
  status: 'waiting' | 'active' | 'downloading' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  progressPhase?: 'preparing' | 'counting' | 'writing' | 'finalizing' | 'completed';
  processedRows?: number;
  totalRows?: number;
  progressMessage?: string;
  exportType: string;
  displayLabelKey?: string;
  downloadFilePrefix?: string;
  result?: {
    fileName: string;
    fileSize: number;
  };
  error?: string;
  errorCode?: string;
  errorDetails?: Record<string, number | string | boolean>;
  createdAt?: number;
}

export interface ExportJobConfig {
  exportType:
  | 'aggregated'
  | 'by-coder'
  | 'by-variable'
  | 'by-variable-compact'
  | 'detailed'
  | 'coding-times'
  | 'results-by-version'
  | 'item-matrix';
  userId?: number;
  version?: 'v1' | 'v2' | 'v3';
  format?: 'csv' | 'excel';
  matrixValue?: 'code' | 'score';
  outputCommentsInsteadOfCodes?: boolean;
  includeReplayUrl?: boolean;
  includeResponseValues?: boolean;
  includeGeoGebraResponseValues?: boolean;
  includeGeoGebraFiles?: boolean;
  anonymizeCoders?: boolean;
  usePseudoCoders?: boolean;
  doubleCodingMethod?:
  | 'new-row-per-variable'
  | 'new-column-per-coder'
  | 'most-frequent';
  includeComments?: boolean;
  includeModalValue?: boolean;
  includeDoubleCoded?: boolean;
  excludeAutoCoded?: boolean;
  jobDefinitionIds?: number[];
  coderTrainingIds?: number[];
  coderIds?: number[];
  authToken?: string;
  serverUrl?: string;
  displayLabelKey?: string;
  downloadFilePrefix?: string;
}

export const REPLAY_AUTH_TOKEN_ERROR_CODE = 'replay-auth-token-failed';

export type ReplayAuthTokenError = Error & {
  code: typeof REPLAY_AUTH_TOKEN_ERROR_CODE;
  originalError?: unknown;
};

export function createReplayAuthTokenError(originalError?: unknown): ReplayAuthTokenError {
  const error = new Error('Replay auth token could not be created.') as ReplayAuthTokenError;
  error.name = 'ReplayAuthTokenError';
  error.code = REPLAY_AUTH_TOKEN_ERROR_CODE;
  error.originalError = originalError;
  return error;
}

export function isReplayAuthTokenError(error: unknown): error is ReplayAuthTokenError {
  return error instanceof Error &&
    (error as Partial<ReplayAuthTokenError>).code === REPLAY_AUTH_TOKEN_ERROR_CODE;
}

@Injectable({
  providedIn: 'root'
})
export class ExportJobService implements OnDestroy {
  private jobsSubject = new BehaviorSubject<ExportJob[]>([]);
  private pollingSubscriptions = new Map<string, Subscription>();
  private downloadSubscriptions = new Map<string, Subscription>();
  private stopPolling$ = new Subject<void>();

  readonly jobs$ = this.jobsSubject.asObservable();

  constructor(
    private codingJobBackendService: CodingJobBackendService,
    private appService: AppService
  ) { }

  get activeJobs(): ExportJob[] {
    return this.jobsSubject.value.filter(
      job => job.status === 'waiting' || job.status === 'active' || job.status === 'downloading'
    );
  }

  get completedJobs(): ExportJob[] {
    return this.jobsSubject.value.filter(job => job.status === 'completed');
  }

  get failedJobs(): ExportJob[] {
    return this.jobsSubject.value.filter(job => job.status === 'failed');
  }

  get cancelledJobs(): ExportJob[] {
    return this.jobsSubject.value.filter(job => job.status === 'cancelled');
  }

  startJob(workspaceId: number, config: ExportJobConfig): Observable<ExportJob> {
    return this.withReplayAuthToken(workspaceId, config).pipe(
      switchMap(preparedConfig => {
        const requestConfig = { ...preparedConfig };
        delete requestConfig.displayLabelKey;
        delete requestConfig.downloadFilePrefix;
        return this.codingJobBackendService.startExportJob(workspaceId, requestConfig);
      }),
      map((response: { jobId: string }) => ({
        jobId: response.jobId,
        workspaceId,
        status: 'waiting' as const,
        progress: 0,
        exportType: config.exportType,
        displayLabelKey: config.displayLabelKey,
        downloadFilePrefix: config.downloadFilePrefix,
        createdAt: Date.now()
      })),
      tap(job => {
        this.addJob(job);
        this.startPollingForJob(workspaceId, job.jobId);
      })
    );
  }

  estimateJob(workspaceId: number, config: ExportJobConfig): Observable<CodingExportEstimate> {
    return this.codingJobBackendService.estimateExportJob(workspaceId, config);
  }

  private withReplayAuthToken(
    workspaceId: number,
    config: ExportJobConfig
  ): Observable<ExportJobConfig> {
    if (!config.includeReplayUrl || config.authToken) {
      return of(config);
    }

    return this.appService.createOwnToken(workspaceId, 60).pipe(
      map(authToken => ({
        ...config,
        authToken,
        serverUrl: config.serverUrl || window.location.origin
      })),
      catchError(error => throwError(() => createReplayAuthTokenError(error)))
    );
  }

  private addJob(job: ExportJob): void {
    const currentJobs = this.jobsSubject.value;
    this.jobsSubject.next([...currentJobs, job]);
  }

  private updateJob(jobId: string, updates: Partial<ExportJob>): void {
    const currentJobs = this.jobsSubject.value;
    const updatedJobs = currentJobs.map(job => {
      if (job.jobId === jobId) {
        return { ...job, ...updates };
      }
      return job;
    });
    this.jobsSubject.next(updatedJobs);
  }

  private startPollingForJob(workspaceId: number, jobId: string): void {
    if (this.pollingSubscriptions.has(jobId)) {
      return;
    }

    const subscription = interval(2000)
      .pipe(
        takeUntil(this.stopPolling$),
        switchMap(() => this.codingJobBackendService.getExportJobStatus(workspaceId, jobId)
        )
      )
      .subscribe({
        next: (status: unknown) => {
          const statusAny = status as unknown as {
            status?: string;
            progress?: number;
            progressPhase?: ExportJob['progressPhase'];
            processedRows?: number;
            totalRows?: number;
            progressMessage?: string;
            result?: { fileName?: string; fileSize?: number };
            error?: string;
            errorCode?: string;
            errorDetails?: Record<string, number | string | boolean>;
          };

          if (!statusAny.status && statusAny.error) {
            this.updateJob(jobId, {
              status: 'failed',
              error: statusAny.error
            });
            this.stopPollingForJob(jobId);
            return;
          }

          const mappedStatus = this.mapStatus(statusAny.status || '');
          const result = statusAny.result ?
            {
              fileName: statusAny.result.fileName || '',
              fileSize: statusAny.result.fileSize || 0
            } :
            undefined;
          this.updateJob(jobId, {
            status: mappedStatus,
            progress: statusAny.progress || 0,
            progressPhase: statusAny.progressPhase,
            processedRows: statusAny.processedRows,
            totalRows: statusAny.totalRows,
            progressMessage: statusAny.progressMessage,
            result,
            error: statusAny.error,
            errorCode: statusAny.errorCode,
            errorDetails: statusAny.errorDetails
          });

          // Stop polling when job is done
          if (
            mappedStatus === 'completed' ||
            mappedStatus === 'failed' ||
            mappedStatus === 'cancelled'
          ) {
            this.stopPollingForJob(jobId);
          }
        },
        error: () => {
          this.updateJob(jobId, {
            status: 'failed',
            error: 'Failed to get job status'
          });
          this.stopPollingForJob(jobId);
        }
      });

    this.pollingSubscriptions.set(jobId, subscription);
  }

  private mapStatus(status: string): ExportJob['status'] {
    switch (status) {
      case 'pending':
        return 'waiting';
      case 'processing':
        return 'active';
      case 'waiting':
      case 'delayed':
        return 'waiting';
      case 'active':
        return 'active';
      case 'completed':
        return 'completed';
      case 'failed':
        return 'failed';
      case 'cancelled':
        return 'cancelled';
      case 'paused':
        return 'waiting';
      default:
        return 'waiting';
    }
  }

  private stopPollingForJob(jobId: string): void {
    const subscription = this.pollingSubscriptions.get(jobId);
    if (subscription) {
      subscription.unsubscribe();
      this.pollingSubscriptions.delete(jobId);
    }
  }

  removeJob(jobId: string): void {
    this.stopPollingForJob(jobId);
    this.stopDownloadForJob(jobId);
    const currentJobs = this.jobsSubject.value;
    this.jobsSubject.next(currentJobs.filter(job => job.jobId !== jobId));
  }

  cancelJob(job: ExportJob): void {
    if (job.status === 'downloading') {
      this.stopDownloadForJob(job.jobId);
      this.updateJob(job.jobId, { status: 'completed', progress: 100 });
      return;
    }

    this.codingJobBackendService.cancelExportJob(job.workspaceId, job.jobId).subscribe({
      next: (response: { success: boolean }) => {
        if (response.success) {
          // Stop polling for this job
          this.stopPollingForJob(job.jobId);
          // Update job status to cancelled
          this.updateJob(job.jobId, { status: 'cancelled' });
        }
      },
      error: () => {
        // On error, still try to stop polling
        this.stopPollingForJob(job.jobId);
      }
    });
  }

  downloadFile(
    workspaceId: number,
    jobId: string,
    exportType: string,
    fileName?: string,
    downloadFilePrefix?: string
  ): void {
    if (this.downloadSubscriptions.has(jobId)) {
      return;
    }

    this.updateJob(jobId, { status: 'downloading', progress: 0 });
    const subscription = this.codingJobBackendService.downloadExportFile(workspaceId, jobId).subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const ext = this.getDownloadExtension(exportType, fileName);
        const date = new Date().toISOString().slice(0, 10);
        a.download = `export-${downloadFilePrefix || exportType}-${date}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        this.downloadSubscriptions.delete(jobId);
        this.updateJob(jobId, { status: 'completed', progress: 100 });
      },
      error: () => {
        this.downloadSubscriptions.delete(jobId);
        this.updateJob(jobId, { status: 'completed', progress: 100 });
      }
    });
    this.downloadSubscriptions.set(jobId, subscription);
    if (subscription.closed) {
      this.downloadSubscriptions.delete(jobId);
    }
  }

  private stopDownloadForJob(jobId: string): void {
    const subscription = this.downloadSubscriptions.get(jobId);
    if (subscription) {
      subscription.unsubscribe();
      this.downloadSubscriptions.delete(jobId);
    }
  }

  private getDownloadExtension(exportType: string, fileName?: string): string {
    const fileExtension = fileName?.split('.').pop()?.toLowerCase();
    if (fileExtension && ['csv', 'xlsx', 'json', 'zip'].includes(fileExtension)) {
      return fileExtension;
    }
    return exportType === 'detailed' || exportType === 'by-variable-compact' ? 'csv' : 'xlsx';
  }

  ngOnDestroy(): void {
    this.stopPolling$.next();
    this.stopPolling$.complete();
    this.pollingSubscriptions.forEach(sub => sub.unsubscribe());
    this.pollingSubscriptions.clear();
    this.downloadSubscriptions.forEach(sub => sub.unsubscribe());
    this.downloadSubscriptions.clear();
  }
}
