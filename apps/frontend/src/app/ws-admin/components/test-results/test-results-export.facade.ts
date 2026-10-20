import {
  DestroyRef, Injectable, inject, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  Subscription, timer, exhaustMap, map, takeWhile, finalize
} from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { TestResultBackendService, TestResultExportJob } from '../../../shared/services/test-result/test-result-backend.service';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { TestResultsExportDialogComponent } from './test-results-export-dialog.component';
import { ExportOptionsDialogComponent, ExportOptions } from './export-options-dialog.component';

@Injectable()
export class TestResultsExportFacade {
  private readonly destroyRef = inject(DestroyRef);
  private readonly appService = inject(AppService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly testResultBackendService = inject(TestResultBackendService);
  private pollSubscription?: Subscription;
  private recoveryRequest?: Subscription;
  private exportGeneration = 0;
  readonly exportJobId = signal<string | null>(null);

  readonly isExporting = signal<boolean>(false);

  readonly exportJobStatus = signal<string | null>(null);

  readonly exportJobProgress = signal<number>(0);

  readonly exportTypeInProgress = signal<'test-results' | 'test-logs' | null>(null);

  constructor() {
    let workspaceId = this.appService.selectedWorkspaceId;
    this.appService.selectedWorkspaceId$?.pipe(takeUntilDestroyed()).subscribe(id => {
      if (id !== workspaceId) { this.resetExportState(); workspaceId = id; }
    });
    this.destroyRef.onDestroy(() => this.stopExportStatusPolling());
  }

  openExportDialog(): void {
    const dialogRef = this.dialog.open(TestResultsExportDialogComponent, {
      width: '500px',
      data: {
        isExporting: this.isExporting(),
        exportTypeInProgress: this.exportTypeInProgress(),
        exportJobStatus: this.exportJobStatus(),
        exportJobProgress: this.exportJobProgress(),
        exportJobId: this.exportJobId()
      }
    });

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef), finalize(() => dialogRef.close?.())).subscribe(result => {
      if (result) {
        if (result.type === 'download' && result.jobId) {
          this.downloadExportResult(result.jobId);
        } else if (result.type === 'cancel') {
          this.cancelExportJob(result.jobId);
        } else if (result.type === 'results' || result.type === 'logs') {
          this.startExportJob(result.type);
        }
      }
    });
  }

  startExportJob(exportType: 'results' | 'logs'): void {
    if (!this.appService.selectedWorkspaceId) {
      return;
    }

    const dialogRef = this.dialog.open(ExportOptionsDialogComponent, {
      width: '800px',
      data: {
        workspaceId: this.appService.selectedWorkspaceId,
        exportType
      }
    });

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef), finalize(() => dialogRef.close?.())).subscribe((result: ExportOptions | undefined) => {
      if (result) {
        this.exportGeneration += 1;
        this.recoveryRequest?.unsubscribe();
        this.stopExportStatusPolling();
        const generation = this.exportGeneration;
        const filters = {
          groupNames:
            result.groupNames && result.groupNames.length > 0 ?
              result.groupNames :
              undefined,
          bookletNames:
            result.bookletNames && result.bookletNames.length > 0 ?
              result.bookletNames :
              undefined,
          unitNames:
            result.unitNames && result.unitNames.length > 0 ?
              result.unitNames :
              undefined,
          personIds:
            result.personIds && result.personIds.length > 0 ?
              result.personIds :
              undefined,
          includeLogAnomalies:
            exportType === 'results' && result.includeLogAnomalies ?
              true :
              undefined
        };

        this.isExporting.set(true);
        this.exportTypeInProgress.set(exportType === 'results' ? 'test-results' : 'test-logs');
        const exportMethod =
          exportType === 'results' ?
            this.testResultBackendService.startExportTestResultsJob(
              this.appService.selectedWorkspaceId,
              filters
            ) :
            this.testResultBackendService.startExportTestLogsJob(
              this.appService.selectedWorkspaceId,
              filters
            );

        exportMethod.pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)).subscribe({
          next: response => {
            if (generation !== this.exportGeneration) return;
            this.exportJobId.set(response.jobId);
            this.exportJobStatus.set('active');
            this.snackBar.open(
              'Export gestartet. Sie werden benachrichtigt, wenn der Download bereitsteht.',
              'OK',
              { duration: 3000 }
            );
            this.pollExportJobStatus(response.jobId);
          },
          error: () => {
            if (generation !== this.exportGeneration) return;
            this.isExporting.set(false);
            this.exportTypeInProgress.set(null);
            this.snackBar.open('Fehler beim Starten des Exports', 'Fehler', {
              duration: 3000
            });
          }
        });
      }
    });
  }

  checkExistingExportJobs(): void {
    this.recoveryRequest?.unsubscribe();
    const generation = this.exportGeneration;
    if (!this.appService.selectedWorkspaceId) {
      return;
    }
    this.recoveryRequest = this.testResultBackendService
      .getExportTestResultsJobs(this.appService.selectedWorkspaceId).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (jobs: TestResultExportJob[]) => {
          if (generation !== this.exportGeneration) return;
          const relevantJobs = jobs.filter(
            (j: TestResultExportJob) => j.exportType === 'test-results' ||
              j.exportType === 'test-logs'
          );
          // Find the most recent active job only (not completed jobs)
          const activeJob = relevantJobs.find(
            (j: TestResultExportJob) => j.status === 'active' ||
              j.status === 'waiting' ||
              j.status === 'delayed'
          );
          if (activeJob) {
            this.exportJobId.set(activeJob.jobId);
            this.isExporting.set(true);
            this.exportTypeInProgress.set(activeJob.exportType as 'test-results' | 'test-logs');
            this.pollExportJobStatus(activeJob.jobId);
          }
        }
      });
  }

  pollExportJobStatus(jobId: string): void {
    this.stopExportStatusPolling();
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return;
    this.pollSubscription = timer(2000, 2000).pipe(
      exhaustMap(() => this.testResultBackendService.getExportTestResultsJobs(workspaceId)),
      map(jobs => jobs.find(job => job.jobId === jobId)),
      takeWhile(job => !!job && !['completed', 'failed', 'cancelled'].includes(job.status), true),
      takeUntilWorkspaceChanged(this.appService, workspaceId),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: job => {
        if (!job) { this.resetExportState(); return; }
        this.exportJobStatus.set(job.status);
        this.exportJobProgress.set(job.progress);
        if (job.status === 'completed') {
          this.isExporting.set(false);
          const ref = this.snackBar.open('Export abgeschlossen', 'Herunterladen', { duration: 10000 });
          ref.onAction().pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.downloadExportResult(jobId));
        } else if (job.status === 'failed') {
          this.isExporting.set(false);
          this.snackBar.open('Export fehlgeschlagen', 'Fehler', { duration: 5000 });
        } else if (job.status === 'cancelled') {
          this.resetExportState();
          this.snackBar.open('Export abgebrochen', 'OK', { duration: 3000 });
        }
      },
      error: () => this.resetExportState()
    });
  }

  cancelExportJob(jobId?: string | null): void {
    if (!this.appService.selectedWorkspaceId || !jobId) {
      return;
    }

    this.testResultBackendService
      .cancelTestResultExportJob(this.appService.selectedWorkspaceId, jobId).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: response => {
          if (response.success) {
            if (!this.exportJobId() || jobId === this.exportJobId()) this.resetExportState();
            this.snackBar.open('Export abgebrochen', 'OK', {
              duration: 3000
            });
            return;
          }

          this.snackBar.open('Export konnte nicht abgebrochen werden', 'Fehler', {
            duration: 5000
          });
        },
        error: () => {
          this.snackBar.open('Export konnte nicht abgebrochen werden', 'Fehler', {
            duration: 5000
          });
        }
      });
  }

  resetExportState(): void {
    this.exportGeneration += 1;
    this.recoveryRequest?.unsubscribe();
    this.stopExportStatusPolling();
    this.isExporting.set(false);
    this.exportJobStatus.set(null);
    this.exportJobProgress.set(0);
    this.exportJobId.set(null);
    this.exportTypeInProgress.set(null);
  }

  stopExportStatusPolling(): void { this.pollSubscription?.unsubscribe(); this.pollSubscription = undefined; }

  downloadExportResult(jobId: string): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }
    this.testResultBackendService
      .downloadExportTestResultsJob(workspaceId, jobId).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: blob => {
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          const datePart = new Date().toISOString().split('T')[0];
          const suffix =
            this.exportTypeInProgress() === 'test-logs' ? 'logs' : 'results';
          link.download = `workspace-${workspaceId}-${suffix}-${datePart}.csv`;
          link.click();
          window.URL.revokeObjectURL(url);

          // Hide the download button after successful download
          if (!this.exportJobId() || jobId === this.exportJobId()) this.resetExportState();

          // Delete the job from the server
          this.testResultBackendService
            .deleteTestResultExportJob(
              workspaceId,
              jobId
            ).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
            .subscribe();
        },
        error: () => {
          this.snackBar.open(
            'Fehler beim Herunterladen der Ergebnisse',
            'Fehler',
            { duration: 3000 }
          );
        }
      });
  }
}
