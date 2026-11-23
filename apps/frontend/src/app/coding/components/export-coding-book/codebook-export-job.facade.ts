import {
  computed, DestroyRef, inject, Injectable, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialogRef } from '@angular/material/dialog';
import {
  catchError, EMPTY, exhaustMap, filter, interval, switchMap, take, takeUntil, takeWhile, tap
} from 'rxjs';
import { CodeBookContentSetting } from '../../../../../../../api-dto/coding/codebook-content-setting';
import { AppService } from '../../../core/services/app.service';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { CodingExportService } from '../../services/coding-export.service';

interface CodebookJobState {
  status: 'idle' | 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  error: string | null;
}

const idleJob: CodebookJobState = {
  status: 'idle', progress: 0, error: null
};

@Injectable()
export class CodebookExportJobFacade {
  private readonly exportService = inject(CodingExportService);
  private readonly appService = inject(AppService);
  private readonly dialogRef = inject(MatDialogRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly job = signal<CodebookJobState>(idleJob);
  readonly state = this.job.asReadonly();
  readonly busy = computed(() => {
    const { status } = this.state();
    return status === 'pending' || status === 'processing';
  });

  start(
    workspaceId: number,
    units: number[],
    options: CodeBookContentSetting,
    saveFile: (file: Blob, format: CodeBookContentSetting['exportFormat']) => void
  ): void {
    if (this.busy()) return;

    const { exportFormat, missingsProfile } = options;
    this.job.set({ ...idleJob, status: 'pending' });
    this.exportService.startCodebookJob(workspaceId, missingsProfile, options, units).pipe(
      take(1),
      catchError(() => this.fail('Failed to start codebook generation job')),
      switchMap(({ jobId }) => this.pollUntilReady(workspaceId, jobId)),
      tap(file => saveFile(file, exportFormat)),
      catchError(() => this.fail('Failed to download codebook file')),
      takeUntilWorkspaceChanged(this.appService, workspaceId),
      takeUntil(this.dialogRef.beforeClosed()),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => this.job.update(job => ({ ...job, status: 'completed' })));
  }

  reset(): void {
    if (!this.busy()) this.job.set(idleJob);
  }

  private pollUntilReady(workspaceId: number, jobId: string) {
    return interval(1500).pipe(
      exhaustMap(() => this.exportService.getCodebookJobStatus(workspaceId, jobId)),
      tap(({ status, progress, error }) => {
        if (!status && error) {
          this.fail(error);
          return;
        }
        if (status === 'failed') {
          this.fail(error || 'Codebook generation failed', progress || 0);
          return;
        }
        const activeStatus = status === 'processing' || status === 'completed' ? 'processing' : 'pending';
        this.job.update(job => ({ ...job, progress: progress || 0, status: activeStatus }));
      }),
      takeWhile(({ status, error }) => status !== 'completed' && status !== 'failed' && (!!status || !error), true),
      catchError(() => this.fail('Failed to get job status')),
      filter(({ status }) => status === 'completed'),
      switchMap(() => this.exportService.downloadCodebookFile(workspaceId, jobId).pipe(take(1)))
    );
  }

  private fail(error: string, progress?: number) {
    this.job.update(job => ({
      ...job, status: 'failed', error, progress: progress ?? job.progress
    }));
    return EMPTY;
  }
}
