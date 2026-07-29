import { Injectable, OnDestroy } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import {
  BehaviorSubject,
  defer,
  EMPTY,
  Observable,
  Subject,
  Subscription,
  catchError,
  interval,
  of,
  throwError
} from 'rxjs';
import {
  finalize, map, switchMap, takeUntil, tap
} from 'rxjs/operators';
import {
  CodingExportEstimate,
  CodingJobBackendService
} from '../../../coding/services/coding-job-backend.service';
import {
  AppService,
  WorkspaceTokenPolicy
} from '../../../core/services/app.service';
import {
  DEFAULT_EXTERNAL_REPLAY_TOKEN_DURATION_DAYS,
  EXTERNAL_REPLAY_WORKSPACE_TOKEN_SCOPES
} from '../../../core/services/auth-session.config';
import { WorkspaceSettingsService } from '../../../ws-admin/services/workspace-settings.service';
import type { PsychometricDomainCandidatesDto } from '../../../../../../../api-dto/coding/psychometric-discrimination.dto';
import {
  BackgroundExportRequest,
  ExportJobDisplayVariantDto,
  ExportJobErrorMetadataDto,
  ExportJobListItemDto,
  ExportJobProgressPhaseDto,
  ExportJobStateDto,
  ExportJobStatusDto,
  ITEM_MATRIX_UNRESOLVED_CELLS_ERROR_CODE,
  ItemDatasetOptionsDto,
  ItemMatrixExportDiagnosticsDto
} from '../../../../../../../api-dto/coding/export-request.dto';

interface ExportJobBase {
  jobId: string;
  workspaceId: number;
  status:
  'waiting' | 'active' | 'downloading' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  progressPhase?: ExportJobProgressPhaseDto;
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
  createdAt?: number;
}

export type ExportJob = ExportJobBase & ExportJobErrorMetadataDto;

export type ExportJobConfig = BackgroundExportRequest & {
  userId?: number;
  displayLabelKey?: string;
  downloadFilePrefix?: string;
};

export const REPLAY_AUTH_TOKEN_ERROR_CODE = 'replay-auth-token-failed';

export type ReplayAuthTokenError = Error & {
  code: typeof REPLAY_AUTH_TOKEN_ERROR_CODE;
  originalError?: unknown;
};

export function createReplayAuthTokenError(
  originalError?: unknown
): ReplayAuthTokenError {
  const error = new Error(
    'Replay auth token could not be created.'
  ) as ReplayAuthTokenError;
  error.name = 'ReplayAuthTokenError';
  error.code = REPLAY_AUTH_TOKEN_ERROR_CODE;
  error.originalError = originalError;
  return error;
}

export function isReplayAuthTokenError(
  error: unknown
): error is ReplayAuthTokenError {
  return (
    error instanceof Error &&
    (error as Partial<ReplayAuthTokenError>).code ===
      REPLAY_AUTH_TOKEN_ERROR_CODE
  );
}

@Injectable({
  providedIn: 'root'
})
export class ExportJobService implements OnDestroy {
  private jobsSubject = new BehaviorSubject<ExportJob[]>([]);
  private pollingSubscriptions = new Map<string, Subscription>();
  private downloadSubscriptions = new Map<string, Subscription>();
  private incompleteDownloadCancellations = new Map<string, Subject<void>>();
  private itemMatrixExpirationTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
  >();

  private restoreVersions = new Map<number, number>();

  private stopPolling$ = new Subject<void>();

  readonly jobs$ = this.jobsSubject.asObservable();

  constructor(
    private codingJobBackendService: CodingJobBackendService,
    private appService: AppService,
    private workspaceSettingsService: WorkspaceSettingsService
  ) {}

  get activeJobs(): ExportJob[] {
    return this.jobsSubject.value.filter(
      job => job.status === 'waiting' ||
        job.status === 'active' ||
        job.status === 'downloading'
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

  restoreWorkspaceJobs(workspaceId: number): Observable<ExportJob[]> {
    const restoreVersion = (this.restoreVersions.get(workspaceId) || 0) + 1;
    this.restoreVersions.set(workspaceId, restoreVersion);
    const jobIdsAtStart = new Set(
      this.jobsSubject.value
        .filter(job => job.workspaceId === workspaceId)
        .map(job => job.jobId)
    );
    const locallyActiveJobIdsAtStart = new Set(
      this.jobsSubject.value
        .filter(job => job.workspaceId === workspaceId && (
          job.status === 'waiting' ||
          job.status === 'active' ||
          job.status === 'downloading'
        ))
        .map(job => job.jobId)
    );

    return this.codingJobBackendService.getExportJobs(workspaceId).pipe(
      map(statuses => statuses
        .filter(status => this.isRestorableJob(status))
        .map(status => this.toExportJob(workspaceId, status))
      ),
      tap(restoredJobs => {
        if (this.restoreVersions.get(workspaceId) !== restoreVersion) {
          return;
        }

        const currentJobs = this.jobsSubject.value;
        const currentWorkspaceJobs = currentJobs.filter(
          job => job.workspaceId === workspaceId
        );
        const currentJobsById = new Map(
          currentWorkspaceJobs.map(job => [job.jobId, job])
        );
        const restoredWithLocalMetadata = restoredJobs.map(job => {
          const localJob = currentJobsById.get(job.jobId);
          return localJob ? {
            ...job,
            displayLabelKey: localJob.displayLabelKey || job.displayLabelKey,
            downloadFilePrefix:
              localJob.downloadFilePrefix || job.downloadFilePrefix
          } : job;
        });
        const restoredJobIds = new Set(
          restoredWithLocalMetadata.map(job => job.jobId)
        );
        const jobsAddedDuringRestore = currentWorkspaceJobs.filter(
          job => !jobIdsAtStart.has(job.jobId) && !restoredJobIds.has(job.jobId)
        );
        const locallyActiveJobs = currentWorkspaceJobs.filter(
          job => locallyActiveJobIdsAtStart.has(job.jobId) &&
            !restoredJobIds.has(job.jobId)
        );
        const nextWorkspaceJobs = [
          ...restoredWithLocalMetadata,
          ...locallyActiveJobs,
          ...jobsAddedDuringRestore
        ];

        currentWorkspaceJobs.forEach(job => {
          this.stopPollingForJob(job.jobId);
          this.clearItemMatrixExpirationTimer(job.jobId);
        });
        const jobsFromOtherWorkspaces = currentJobs.filter(
          job => job.workspaceId !== workspaceId
        );
        this.jobsSubject.next([...jobsFromOtherWorkspaces, ...nextWorkspaceJobs]);

        nextWorkspaceJobs.forEach(job => {
          if (job.status === 'waiting' || job.status === 'active') {
            this.startPollingForJob(workspaceId, job.jobId);
          }
          this.scheduleItemMatrixArtifactExpiration(job.jobId, job);
        });
      }),
      catchError(() => of([]))
    );
  }

  startJob(
    workspaceId: number,
    config: ExportJobConfig
  ): Observable<ExportJob> {
    return this.withReplayAuthToken(workspaceId, config).pipe(
      switchMap(preparedConfig => {
        const requestConfig = { ...preparedConfig };
        delete requestConfig.displayLabelKey;
        delete requestConfig.downloadFilePrefix;
        return this.codingJobBackendService.startExportJob(
          workspaceId,
          requestConfig
        );
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

  estimateJob(
    workspaceId: number,
    config: ExportJobConfig
  ): Observable<CodingExportEstimate> {
    return this.codingJobBackendService.estimateExportJob(workspaceId, config);
  }

  getPsychometricDomainCandidates(
    workspaceId: number
  ): Observable<PsychometricDomainCandidatesDto> {
    return this.codingJobBackendService.getPsychometricDomainCandidates(
      workspaceId
    );
  }

  getItemDatasetOptions(
    workspaceId: number
  ): Observable<ItemDatasetOptionsDto> {
    return this.codingJobBackendService.getItemDatasetOptions(workspaceId);
  }

  private withReplayAuthToken(
    workspaceId: number,
    config: ExportJobConfig
  ): Observable<ExportJobConfig> {
    if (!config.includeReplayUrl || config.authToken) {
      return of(config);
    }

    return this.workspaceSettingsService
      .getReplayUrlExportMode(workspaceId)
      .pipe(
        switchMap(mode => {
          if (mode === 'workspaceId') {
            return of({
              ...config,
              serverUrl: config.serverUrl || window.location.origin
            });
          }

          return this.createExternalReplayToken(workspaceId).pipe(
            map(authToken => ({
              ...config,
              authToken,
              serverUrl: config.serverUrl || window.location.origin
            })),
            catchError(error => throwError(() => createReplayAuthTokenError(error))
            )
          );
        })
      );
  }

  private createExternalReplayToken(workspaceId: number): Observable<string> {
    return this.appService.getWorkspaceTokenPolicy().pipe(
      map(policy => this.getExternalReplayTokenMaxDurationDays(policy)),
      switchMap(maxDurationDays => this.workspaceSettingsService.getReplayUrlExportTokenDurationDays(
        workspaceId,
        maxDurationDays
      )
      ),
      switchMap(durationDays => this.appService.createOwnToken(
        workspaceId,
        durationDays,
        EXTERNAL_REPLAY_WORKSPACE_TOKEN_SCOPES
      )
      )
    );
  }

  private getExternalReplayTokenMaxDurationDays(
    policy: WorkspaceTokenPolicy
  ): number {
    const maxDurations = EXTERNAL_REPLAY_WORKSPACE_TOKEN_SCOPES.map(
      scope => policy.scopes[scope]?.maxDurationDays
    ).filter(
      (duration): duration is number => Number.isInteger(duration) && duration >= 1
    );

    return maxDurations.length ?
      Math.min(...maxDurations) :
      DEFAULT_EXTERNAL_REPLAY_TOKEN_DURATION_DAYS;
  }

  private addJob(job: ExportJob): void {
    const currentJobs = this.jobsSubject.value;
    this.jobsSubject.next([...currentJobs, job]);
  }

  private isRestorableJob(status: ExportJobListItemDto): boolean {
    if (
      status.status === 'pending' ||
      status.status === 'processing' ||
      status.status === 'paused'
    ) {
      return false;
    }
    if (status.status === 'completed') {
      return !!status.result;
    }
    if (status.errorCode === ITEM_MATRIX_UNRESOLVED_CELLS_ERROR_CODE) {
      return status.errorDetails.diagnosticsAvailable ||
        status.errorDetails.incompleteDownloadAvailable;
    }
    return true;
  }

  private toExportJob(
    workspaceId: number,
    status: ExportJobListItemDto
  ): ExportJob {
    const displayMetadata = this.getDisplayMetadata(status.displayVariant);
    return {
      jobId: status.jobId,
      workspaceId,
      status: this.mapStatus(status.status),
      progress: status.progress,
      progressPhase: status.progressPhase,
      processedRows: status.processedRows,
      totalRows: status.totalRows,
      progressMessage: status.progressMessage,
      exportType: status.exportType,
      displayLabelKey: displayMetadata.displayLabelKey,
      downloadFilePrefix: displayMetadata.downloadFilePrefix ||
        (status.exportType === 'item-matrix' ? 'Itemdatensatz' : undefined),
      result: status.result ? {
        fileName: status.result.fileName,
        fileSize: status.result.fileSize
      } : undefined,
      error: status.error,
      createdAt: status.createdAt,
      ...this.getExportJobErrorMetadata(status)
    };
  }

  private getDisplayMetadata(
    variant?: ExportJobDisplayVariantDto
  ): Pick<ExportJob, 'displayLabelKey' | 'downloadFilePrefix'> {
    switch (variant) {
      case 'manual-review-most-frequent':
      case 'manual-review-new-column-per-coder':
      case 'manual-review-new-row-per-variable':
        return {
          displayLabelKey: `export-toast.types.${variant}`,
          downloadFilePrefix: variant
        };
      case 'manual-review-by-variable-compact':
        return {
          displayLabelKey: 'export-toast.types.by-variable-compact',
          downloadFilePrefix: variant
        };
      default:
        return {};
    }
  }

  private updateJob(
    jobId: string,
    updates: Partial<ExportJobBase> & ExportJobErrorMetadataDto
  ): void {
    const currentJobs = this.jobsSubject.value;
    const updatedJobs = currentJobs.map(job => {
      if (job.jobId === jobId) {
        return { ...job, ...updates } as ExportJob;
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
        next: status => {
          if (!('status' in status)) {
            this.updateJob(jobId, {
              status: 'failed',
              error: status.error
            });
            this.stopPollingForJob(jobId);
            return;
          }

          const mappedStatus = this.mapStatus(status.status);
          const result = status.result ?
            {
              fileName: status.result.fileName,
              fileSize: status.result.fileSize
            } :
            undefined;
          const errorMetadata = this.getExportJobErrorMetadata(status);
          this.updateJob(jobId, {
            status: mappedStatus,
            progress: status.progress,
            progressPhase: status.progressPhase,
            processedRows: status.processedRows,
            totalRows: status.totalRows,
            progressMessage: status.progressMessage,
            result,
            error: status.error,
            ...errorMetadata
          });
          this.scheduleItemMatrixArtifactExpiration(jobId, status);

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

  private mapStatus(status: ExportJobStateDto): ExportJob['status'] {
    switch (status) {
      case 'pending':
        return 'waiting';
      case 'processing':
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
        return status;
    }
  }

  private stopPollingForJob(jobId: string): void {
    const subscription = this.pollingSubscriptions.get(jobId);
    if (subscription) {
      subscription.unsubscribe();
      this.pollingSubscriptions.delete(jobId);
    }
  }

  removeJob(jobId: string): Observable<boolean> {
    const currentJobs = this.jobsSubject.value;
    const job = currentJobs.find(candidate => candidate.jobId === jobId);
    if (!job) {
      return of(false);
    }

    return this.codingJobBackendService
      .deleteExportJob(job.workspaceId, job.jobId)
      .pipe(
        map(response => {
          if (!response.success) {
            return false;
          }
          this.stopPollingForJob(jobId);
          this.stopDownloadForJob(jobId);
          this.clearItemMatrixExpirationTimer(jobId);
          this.jobsSubject.next(
            this.jobsSubject.value.filter(candidate => candidate.jobId !== jobId)
          );
          return true;
        }),
        catchError(() => of(false))
      );
  }

  cancelJob(job: ExportJob): void {
    if (job.status === 'downloading') {
      this.stopDownloadForJob(job.jobId);
      this.updateJob(job.jobId, { status: 'completed', progress: 100 });
      return;
    }

    this.codingJobBackendService
      .cancelExportJob(job.workspaceId, job.jobId)
      .subscribe({
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
    const subscription = this.codingJobBackendService
      .downloadExportFile(workspaceId, jobId)
      .subscribe({
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

  getItemMatrixDiagnostics(
    job: ExportJob
  ): Observable<ItemMatrixExportDiagnosticsDto> {
    return this.codingJobBackendService
      .getItemMatrixExportDiagnostics(job.workspaceId, job.jobId)
      .pipe(
        catchError(error => {
          this.expireItemMatrixArtifactsOnNotFound(job.jobId, error);
          return throwError(() => error);
        })
      );
  }

  downloadIncompleteItemMatrix(job: ExportJob): Observable<void> {
    return defer(() => {
      if (this.incompleteDownloadCancellations.has(job.jobId)) {
        return EMPTY;
      }
      const cancellation$ = new Subject<void>();
      this.incompleteDownloadCancellations.set(job.jobId, cancellation$);
      return this.codingJobBackendService
        .downloadIncompleteItemMatrix(job.workspaceId, job.jobId)
        .pipe(
          tap(download => {
            const { blob, fileName } = download;
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName || 'Itemdatensatz-UNVOLLSTAENDIG.zip';
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
          }),
          map(() => undefined),
          catchError(error => {
            this.expireItemMatrixArtifactsOnNotFound(job.jobId, error);
            return throwError(() => error);
          }),
          takeUntil(cancellation$),
          finalize(() => {
            cancellation$.complete();
            this.incompleteDownloadCancellations.delete(job.jobId);
          })
        );
    });
  }

  private stopDownloadForJob(jobId: string): void {
    const subscription = this.downloadSubscriptions.get(jobId);
    if (subscription) {
      subscription.unsubscribe();
      this.downloadSubscriptions.delete(jobId);
    }
    const incompleteCancellation =
      this.incompleteDownloadCancellations.get(jobId);
    if (incompleteCancellation) {
      incompleteCancellation.next();
      incompleteCancellation.complete();
      this.incompleteDownloadCancellations.delete(jobId);
    }
  }

  private scheduleItemMatrixArtifactExpiration(
    jobId: string,
    status: ExportJobErrorMetadataDto
  ): void {
    this.clearItemMatrixExpirationTimer(jobId);
    if (status.errorCode !== ITEM_MATRIX_UNRESOLVED_CELLS_ERROR_CODE) {
      return;
    }
    const expiresAt = Number(status.errorDetails.expiresAt);
    if (!Number.isFinite(expiresAt)) {
      return;
    }
    const expire = () => this.markItemMatrixArtifactsExpired(jobId);
    const delay = expiresAt - Date.now();
    if (delay <= 0) {
      expire();
      return;
    }
    this.itemMatrixExpirationTimers.set(jobId, setTimeout(expire, delay));
  }

  private expireItemMatrixArtifactsOnNotFound(
    jobId: string,
    error: unknown
  ): void {
    if (error instanceof HttpErrorResponse && error.status === 404) {
      this.markItemMatrixArtifactsExpired(jobId);
    }
  }

  private markItemMatrixArtifactsExpired(jobId: string): void {
    this.clearItemMatrixExpirationTimer(jobId);
    const job = this.jobsSubject.value.find(
      candidate => candidate.jobId === jobId
    );
    if (!job) {
      return;
    }
    if (job.errorCode !== ITEM_MATRIX_UNRESOLVED_CELLS_ERROR_CODE) {
      return;
    }
    this.updateJob(jobId, {
      errorCode: ITEM_MATRIX_UNRESOLVED_CELLS_ERROR_CODE,
      errorDetails: {
        ...job.errorDetails,
        diagnosticsAvailable: false,
        incompleteDownloadAvailable: false
      }
    });
  }

  private clearItemMatrixExpirationTimer(jobId: string): void {
    const timer = this.itemMatrixExpirationTimers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.itemMatrixExpirationTimers.delete(jobId);
    }
  }

  private getExportJobErrorMetadata(
    status: ExportJobStatusDto
  ): ExportJobErrorMetadataDto {
    if (status.errorCode === ITEM_MATRIX_UNRESOLVED_CELLS_ERROR_CODE) {
      return {
        errorCode: status.errorCode,
        errorDetails: status.errorDetails
      };
    }
    if (status.errorCode === 'EXPORT_TOO_MANY_WORKSHEETS') {
      return {
        errorCode: status.errorCode,
        errorDetails: status.errorDetails
      };
    }
    return { errorCode: undefined, errorDetails: undefined };
  }

  private getDownloadExtension(exportType: string, fileName?: string): string {
    const fileExtension = fileName?.split('.').pop()?.toLowerCase();
    if (
      fileExtension &&
      ['csv', 'xlsx', 'json', 'zip'].includes(fileExtension)
    ) {
      return fileExtension;
    }
    return exportType === 'detailed' || exportType === 'by-variable-compact' ?
      'csv' :
      'xlsx';
  }

  ngOnDestroy(): void {
    this.stopPolling$.next();
    this.stopPolling$.complete();
    this.pollingSubscriptions.forEach(sub => sub.unsubscribe());
    this.pollingSubscriptions.clear();
    this.downloadSubscriptions.forEach(sub => sub.unsubscribe());
    this.downloadSubscriptions.clear();
    this.incompleteDownloadCancellations.forEach(cancellation => {
      cancellation.next();
      cancellation.complete();
    });
    this.incompleteDownloadCancellations.clear();
    this.itemMatrixExpirationTimers.forEach(timer => clearTimeout(timer));
    this.itemMatrixExpirationTimers.clear();
  }
}
