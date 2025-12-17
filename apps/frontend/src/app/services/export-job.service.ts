import { Injectable, OnDestroy } from '@angular/core';
import {
  BehaviorSubject, Subject, Subscription, interval
} from 'rxjs';
import { switchMap, takeUntil } from 'rxjs/operators';
import { BackendService } from './backend.service';

export interface ExportJob {
  jobId: string;
  workspaceId: number;
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  exportType: string;
  result?: {
    fileName: string;
    fileSize: number;
  };
  error?: string;
  createdAt?: number;
}

export interface ExportJobConfig {
  exportType:
  | 'aggregated'
  | 'by-coder'
  | 'by-variable'
  | 'detailed'
  | 'coding-times';
  userId: number;
  outputCommentsInsteadOfCodes?: boolean;
  includeReplayUrl?: boolean;
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
  authToken?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ExportJobService implements OnDestroy {
  private jobsSubject = new BehaviorSubject<ExportJob[]>([]);
  private pollingSubscriptions = new Map<string, Subscription>();
  private stopPolling$ = new Subject<void>();

  readonly jobs$ = this.jobsSubject.asObservable();

  constructor(private backendService: BackendService) {}

  get activeJobs(): ExportJob[] {
    return this.jobsSubject.value.filter(
      job => job.status === 'waiting' || job.status === 'active'
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

  startJob(workspaceId: number, config: ExportJobConfig): void {
    this.backendService.startExportJob(workspaceId, config).subscribe({
      next: response => {
        const newJob: ExportJob = {
          jobId: response.jobId,
          workspaceId,
          status: 'waiting',
          progress: 0,
          exportType: config.exportType,
          createdAt: Date.now()
        };

        this.addJob(newJob);
        this.startPollingForJob(workspaceId, response.jobId);
      },
      error: () => {}
    });
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
        switchMap(() => this.backendService.getExportJobStatus(workspaceId, jobId)
        )
      )
      .subscribe({
        next: status => {
          const statusAny = status as unknown as {
            status?: string;
            progress?: number;
            result?: { fileName?: string; fileSize?: number };
            error?: string;
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
            result,
            error: statusAny.error
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
    const currentJobs = this.jobsSubject.value;
    this.jobsSubject.next(currentJobs.filter(job => job.jobId !== jobId));
  }

  cancelJob(job: ExportJob): void {
    this.backendService.cancelExportJob(job.workspaceId, job.jobId).subscribe({
      next: response => {
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

  downloadFile(workspaceId: number, jobId: string, exportType: string): void {
    this.backendService.downloadExportFile(workspaceId, jobId).subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const ext = exportType === 'detailed' ? 'csv' : 'xlsx';
        const date = new Date().toISOString().slice(0, 10);
        a.download = `export-${exportType}-${date}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      },
      error: () => {}
    });
  }

  ngOnDestroy(): void {
    this.stopPolling$.next();
    this.stopPolling$.complete();
    this.pollingSubscriptions.forEach(sub => sub.unsubscribe());
    this.pollingSubscriptions.clear();
  }
}
