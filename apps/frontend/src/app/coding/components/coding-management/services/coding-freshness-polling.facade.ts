import {
  DestroyRef, Injectable, inject, signal
} from '@angular/core';
import {
  EMPTY, Subject, Subscription, catchError, exhaustMap, timer
} from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AppService } from '../../../../core/services/app.service';
import { JobStatus, TestPersonCodingService } from '../../../services/test-person-coding.service';

export interface FreshnessJobCompletion {
  workspaceId: number;
  jobId: string;
  status: JobStatus;
}

/** Owns view polling; unfinished jobs are handed to the persistent guard tracker. */
@Injectable()
export class CodingFreshnessPollingFacade {
  private readonly backend = inject(TestPersonCodingService);
  private readonly app = inject(AppService);
  private readonly job = signal<{ id: string; workspaceId: number } | null>(null);
  private readonly progressState = signal<number | null>(null);
  private readonly pollingState = signal(false);
  private readonly completed = new Subject<FreshnessJobCompletion>();
  private readonly errors = new Subject<string>();
  private polling = new Subscription();
  private hasShownError = false;
  private disposed = false;

  readonly progress = this.progressState.asReadonly();
  readonly isPolling = this.pollingState.asReadonly();
  readonly completed$ = this.completed.asObservable();
  readonly errors$ = this.errors.asObservable();

  get jobId(): string | null { return this.job()?.id ?? null; }
  get workspaceId(): number | null { return this.job()?.workspaceId ?? null; }

  constructor() {
    this.app.selectedWorkspaceId$.pipe(takeUntilDestroyed()).subscribe(id => {
      if (this.job() && id !== this.workspaceId) this.detach();
    });
    inject(DestroyRef).onDestroy(() => this.dispose());
  }

  track(jobId: string, workspaceId: number, progress: number | null = 0): void {
    if (this.disposed) return;
    if (workspaceId !== this.app.selectedWorkspaceId) {
      this.backend.trackFreshnessCodingGuardUntilComplete(workspaceId, jobId);
      return;
    }
    if (this.job() && (this.jobId !== jobId || this.workspaceId !== workspaceId)) this.detach();
    this.stop();
    this.job.set({ id: jobId, workspaceId });
    this.progressState.set(progress);
  }

  start(jobId: string, workspaceId: number): void {
    if (this.disposed || !workspaceId) return;
    if (workspaceId !== this.app.selectedWorkspaceId) {
      this.backend.trackFreshnessCodingGuardUntilComplete(workspaceId, jobId);
      return;
    }
    this.track(jobId, workspaceId, null);
    this.pollingState.set(true);
    this.polling = timer(2000, 2000).pipe(
      // Slow status responses must not overlap or be canceled by the next tick.
      exhaustMap(() => this.backend.getJobStatus(workspaceId, jobId).pipe(catchError(error => {
        this.reportError(error instanceof Error ? error.message : String(error));
        return EMPTY;
      })))
    ).subscribe(status => {
      if (!('status' in status)) {
        this.reportError(status.error);
        return;
      }
      this.hasShownError = false;
      this.progressState.set(status.progress);
      if (['completed', 'failed', 'cancelled', 'paused'].includes(status.status)) {
        this.completed.next({ workspaceId, jobId, status });
        if (this.jobId === jobId) this.stop();
      }
    });
  }

  stop(): void {
    this.polling.unsubscribe();
    this.pollingState.set(false);
    this.job.set(null);
    this.progressState.set(null);
    this.hasShownError = false;
  }

  detach(): void {
    const job = this.job();
    if (job) this.backend.trackFreshnessCodingGuardUntilComplete(job.workspaceId, job.id);
    this.stop();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detach();
    this.completed.complete();
    this.errors.complete();
  }

  private reportError(message: string): void {
    if (!this.hasShownError) {
      this.hasShownError = true;
      this.errors.next(message);
    }
  }
}
