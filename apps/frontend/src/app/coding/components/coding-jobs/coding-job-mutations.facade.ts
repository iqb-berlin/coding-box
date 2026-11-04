import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import {
  Observable, Subject, filter, finalize, firstValueFrom, take, takeUntil
} from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog.component';
import { injectUiTranslator } from '../../../shared/utils/ui-translator';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { CodingJob } from '../../models/coding-job.model';
import { CodingPermissionsService } from '../../services/coding-permissions.service';
import { ApplyCodingResultsResponse, CodingJobBackendService } from '../../services/coding-job-backend.service';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { ApplyCodingResultsDialogComponent, ApplyCodingResultsDialogResult } from './apply-coding-results-dialog.component';

export interface CodingJobMutation {
  deletedCount?: number;
  clearSelection?: boolean;
}

/** View-local confirmations and requests; the list retains paging and selection. */
@Injectable()
export class CodingJobMutationsFacade {
  private readonly uiTranslate = injectUiTranslator();
  private readonly destroyRef = inject(DestroyRef);
  private readonly appService = inject(AppService);
  private readonly permissions = inject(CodingPermissionsService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly translateService = inject(TranslateService);
  private readonly codingJobBackendService = inject(CodingJobBackendService);
  private readonly testPersonCodingService = inject(TestPersonCodingService);
  private readonly changedSubject = new Subject<CodingJobMutation>();
  readonly changed$ = this.changedSubject.asObservable();
  private workspaceGeneration = 0;

  constructor() {
    let workspaceId = this.appService.selectedWorkspaceId;
    this.appService.selectedWorkspaceId$.pipe(takeUntilDestroyed()).subscribe(id => {
      if (workspaceId !== id) { workspaceId = id; this.workspaceGeneration += 1; }
    });
    this.destroyRef.onDestroy(() => this.changedSubject.complete());
  }

  deleteCodingJob(job: CodingJob, canManage: boolean): void {
    if (!this.permissions.canEdit(job)) return;
    if (!canManage) {
      this.snackBar.open(
        this.uiTranslate('ui-text.coding-jobs.manage-permission-required'),
        this.uiTranslate('deferred-view.close'),
        { duration: 4000 }
      );
      return;
    }

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return;

    const confirmMessage = this.uiTranslate('ui-text.coding-jobs.delete-confirmation', { name: job.name });

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.uiTranslate('coding.trainings.delete.confirm.title'),
        message: confirmMessage,
        confirmButtonText: this.uiTranslate('delete'),
        cancelButtonText: this.uiTranslate('cancel')
      }
    });

    this.observeWorkspaceDialog(dialogRef).subscribe(result => {
      if (result) {
        this.codingJobBackendService
          .deleteCodingJob(workspaceId, job.id).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: response => {
              if (response.success) {
                this.snackBar.open(
                  this.uiTranslate('ui-text.coding-jobs.delete-success', { name: job.name }),
                  this.uiTranslate('deferred-view.close'),
                  { duration: 3000 }
                );
                this.changedSubject.next({ deletedCount: 1 });
              } else {
                this.snackBar.open(
                  this.uiTranslate('ui-text.coding-jobs.delete-failed', { name: job.name }),
                  this.uiTranslate('deferred-view.close'),
                  { duration: 3000 }
                );
              }
            },
            error: () => {
              this.snackBar.open(
                this.uiTranslate('ui-text.coding-jobs.delete-failed', { name: job.name }),
                this.uiTranslate('deferred-view.close'),
                { duration: 3000 }
              );
            }
          });
      }
    });
  }

  bulkDeleteCodingJobs(selectedJobs: CodingJob[], canManage: boolean): void {
    if (selectedJobs.length === 0 || !selectedJobs.every(job => this.permissions.canEdit(job))) return;
    if (!canManage) {
      this.snackBar.open(
        this.uiTranslate('ui-text.coding-jobs.manage-permission-required'),
        this.uiTranslate('deferred-view.close'),
        { duration: 4000 }
      );
      return;
    }

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return;
    if (selectedJobs.length === 0) {
      this.snackBar.open(this.uiTranslate('ui-text.coding-jobs.no-selection'), this.uiTranslate('deferred-view.close'), {
        duration: 3000
      });
      return;
    }

    const jobNamesHTML = selectedJobs
      .map(job => `"${job.name}"`)
      .join('<br>');
    const confirmMessage = this.uiTranslate('ui-text.coding-jobs.bulk-delete-confirmation', { length: selectedJobs.length, jobNamesHTML: jobNamesHTML });

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '500px',
      data: {
        title: this.uiTranslate('ui-text.coding-jobs.bulk-delete-title'),
        message: confirmMessage,
        confirmButtonText: this.uiTranslate('export-toast.clear-all'),
        cancelButtonText: this.uiTranslate('cancel')
      }
    });

    this.observeWorkspaceDialog(dialogRef).subscribe(result => {
      if (result) {
        this.performBulkDelete(selectedJobs, workspaceId);
      }
    });
  }

  private async performBulkDelete(jobs: CodingJob[], workspaceId: number): Promise<void> {
    if (!jobs.every(job => this.permissions.canEdit(job))) return;
    const generation = this.workspaceGeneration;
    if (!workspaceId) {
      this.snackBar.open(this.uiTranslate('error.noWorkspaceSelected'), this.uiTranslate('deferred-view.close'), {
        duration: 3000
      });
      return;
    }

    const loadingSnack = this.snackBar.open(
      this.uiTranslate('ui-text.coding-jobs.deleting-count', { length: jobs.length }),
      '',
      { duration: 3000 }
    );

    let successCount = 0;
    let failureCount = 0;
    const failedJobs: string[] = [];

    try {
      const response = await firstValueFrom(this.codingJobBackendService.deleteCodingJobs(workspaceId, jobs.map(job => job.id)).pipe(
        takeUntilWorkspaceChanged(this.appService, workspaceId),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => loadingSnack.dismiss())
      ), { defaultValue: undefined });
      if (!response) return;
      if (response.success) successCount = jobs.length;
      else { failureCount = jobs.length; failedJobs.push(...jobs.map(job => job.name)); }
    } catch {
      failureCount = jobs.length;
      failedJobs.push(...jobs.map(job => job.name));
    }

    loadingSnack.dismiss();
    if (this.destroyRef.destroyed || generation !== this.workspaceGeneration) return;

    if (failureCount === 0) {
      this.snackBar.open(
        this.uiTranslate('ui-text.coding-jobs.bulk-delete-success', { successCount: successCount }),
        this.uiTranslate('deferred-view.close'),
        { duration: 3000 }
      );
    } else if (successCount === 0) {
      this.snackBar.open(
        this.uiTranslate('ui-text.coding-jobs.bulk-delete-failed', { failureCount: failureCount }),
        this.uiTranslate('deferred-view.close'),
        { duration: 5000 }
      );
    } else {
      this.snackBar.open(
        this.uiTranslate('ui-text.coding-jobs.bulk-delete-partial', { successCount: successCount, failureCount: failureCount, value3: failedJobs.join(', ') }),
        this.uiTranslate('deferred-view.close'),
        { duration: 5000 }
      );
    }

    this.changedSubject.next({ deletedCount: successCount, clearSelection: true });
  }

  applyCodingResults(job: CodingJob): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.uiTranslate('error.noWorkspaceSelected'), this.uiTranslate('deferred-view.close'), {
        duration: 3000
      });
      return;
    }

    const dialogRef = this.dialog.open(ApplyCodingResultsDialogComponent, {
      width: '600px',
      data: {
        jobName: job.name,
        totalResults: job.totalUnits,
        codedResults: job.codedUnits,
        hasReviewIssues: job.hasIssues
      }
    });

    this.observeWorkspaceDialog(dialogRef)
      .subscribe((dialogResult?: ApplyCodingResultsDialogResult | false) => {
        if (!dialogResult) {
          return;
        }

        const loadingSnack = this.snackBar.open(
          this.uiTranslate('ui-text.coding-jobs.applying-results', { name: job.name }),
          '',
          { duration: 3000 }
        );

        this.codingJobBackendService
          .applyCodingResults(workspaceId, job.id, {
            overwriteExisting: dialogResult.overwriteExisting
          }).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef), finalize(() => loadingSnack.dismiss()))
          .subscribe({
            next: result => {
              loadingSnack.dismiss();
              if (result.success) {
                this.snackBar.open(
                  this.formatApplyCodingResultsMessage(result),
                  this.uiTranslate('deferred-view.close'),
                  { duration: 6000 }
                );
                this.notifyCodingResultsApplied(workspaceId);
                this.changedSubject.next({});
              } else {
                this.snackBar.open(
                  this.uiTranslate('ui-text.coding-jobs.apply-failed', { value1: this.translateService.instant(result.messageKey, result.messageParams || {}) }),
                  this.uiTranslate('deferred-view.close'),
                  { duration: 5000 }
                );
              }
            },
            error: error => {
              loadingSnack.dismiss();
              this.snackBar.open(
                this.uiTranslate('ui-text.coding-jobs.apply-failed', { value1: error.message || this.uiTranslate('error.unknown') }),
                this.uiTranslate('deferred-view.close'),
                { duration: 5000 }
              );
            }
          });
      });
  }

  private formatApplyCodingResultsMessage(
    result: ApplyCodingResultsResponse
  ): string {
    const parts = [
      this.uiTranslate('ui-text.coding-jobs.apply-success', { updatedResponsesCount: result.updatedResponsesCount })
    ];

    if (result.skippedAlreadyCodedCount > 0) {
      parts.push(
        this.uiTranslate('ui-text.coding-jobs.preserved-responses', { skippedAlreadyCodedCount: result.skippedAlreadyCodedCount })
      );
    }

    if (result.overwrittenExistingCount > 0) {
      parts.push(
        this.uiTranslate('ui-text.coding-jobs.overwritten-responses', { overwrittenExistingCount: result.overwrittenExistingCount })
      );
    }

    if (result.skippedReviewCount > 0) {
      parts.push(
        this.uiTranslate('ui-text.coding-jobs.review-skipped-responses', { skippedReviewCount: result.skippedReviewCount })
      );
    }

    return parts.join('\n');
  }

  private notifyCodingResultsApplied(workspaceId: number): void {
    this.testPersonCodingService.notifyTestResultsChanged({
      workspaceId,
      statisticsVersion: 'v2'
    });
  }

  bulkApplyCodingResults(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.uiTranslate('error.noWorkspaceSelected'), this.uiTranslate('deferred-view.close'), {
        duration: 3000
      });
      return;
    }

    const confirmMessage = [
      this.uiTranslate('ui-text.coding-jobs.bulk-apply-question'),
      this.uiTranslate('ui-text.coding-jobs.bulk-apply-valid-results'),
      this.uiTranslate('ui-text.coding-jobs.bulk-apply-review-hint')
    ].join(' ');

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '500px',
      data: {
        title: this.uiTranslate('ui-text.coding-jobs.bulk-apply-title'),
        message: confirmMessage,
        confirmButtonText: this.uiTranslate('coding.trainings.compare.apply-dialog.apply'),
        cancelButtonText: this.uiTranslate('cancel')
      }
    });

    this.observeWorkspaceDialog(dialogRef).subscribe(result => {
      if (result) {
        this.performBulkApply(workspaceId);
      }
    });
  }

  private performBulkApply(workspaceId: number): void {
    if (!workspaceId) {
      this.snackBar.open(this.uiTranslate('error.noWorkspaceSelected'), this.uiTranslate('deferred-view.close'), {
        duration: 3000
      });
      return;
    }

    const loadingSnack = this.snackBar.open(
      this.uiTranslate('ui-text.coding-jobs.applying-all-results'),
      '',
      { duration: 3000 }
    );

    this.codingJobBackendService.bulkApplyCodingResults(workspaceId).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef), finalize(() => loadingSnack.dismiss())).subscribe({
      next: result => {
        loadingSnack.dismiss();
        if (result.success) {
          const skippedCount = result.results.filter(
            r => r.skipped
          ).length;
          const failedCount = result.results.filter(
            r => r.result && !r.result.success
          ).length;
          const processedCount = result.jobsProcessed;
          const alreadyCodedInfo =
            result.totalSkippedAlreadyCoded > 0 ?
              this.uiTranslate('ui-text.coding-jobs.preserved-results-info', { totalSkippedAlreadyCoded: result.totalSkippedAlreadyCoded }) :
              '';
          const failedInfo =
            failedCount > 0 ?
              this.uiTranslate('ui-text.coding-jobs.failed-jobs-info', { failedCount: failedCount }) :
              '';
          const reviewInfo =
            result.totalSkippedReview > 0 ?
              this.uiTranslate('ui-text.coding-jobs.pending-review-info', { totalSkippedReview: result.totalSkippedReview }) :
              '';
          this.snackBar.open(
            this.uiTranslate('ui-text.coding-jobs.bulk-apply-success', {
              processedCount: processedCount, totalUpdatedResponses: result.totalUpdatedResponses, alreadyCodedInfo: alreadyCodedInfo, reviewInfo: reviewInfo, value5: skippedCount > 0 ? this.uiTranslate('ui-text.coding-jobs.skipped-jobs-info', { skippedCount: skippedCount }) : '', failedInfo: failedInfo
            }),
            this.uiTranslate('deferred-view.close'),
            { duration: 5000 }
          );
          this.notifyCodingResultsApplied(workspaceId);
          this.changedSubject.next({});
        } else {
          this.snackBar.open(
            this.uiTranslate('ui-text.coding-jobs.bulk-apply-failed', { message: result.message }),
            this.uiTranslate('deferred-view.close'),
            { duration: 5000 }
          );
        }
      },
      error: error => {
        loadingSnack.dismiss();
        this.snackBar.open(
          this.uiTranslate('ui-text.coding-jobs.bulk-apply-request-failed', { value1: error.message || this.uiTranslate('error.unknown') }),
          this.uiTranslate('deferred-view.close'),
          { duration: 5000 }
        );
      }
    });
  }

  private observeWorkspaceDialog<T, R>(dialogRef: MatDialogRef<T, R>): Observable<R | undefined> {
    const workspaceId = this.appService.selectedWorkspaceId;
    const unregisterClose = this.destroyRef.onDestroy(() => dialogRef.close());
    this.appService.selectedWorkspaceId$.pipe(
      filter(id => id !== workspaceId),
      take(1),
      takeUntil(dialogRef.afterClosed()),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => dialogRef.close());
    return dialogRef.afterClosed().pipe(
      takeUntilWorkspaceChanged(this.appService, workspaceId),
      takeUntilDestroyed(this.destroyRef),
      finalize(unregisterClose)
    );
  }
}
