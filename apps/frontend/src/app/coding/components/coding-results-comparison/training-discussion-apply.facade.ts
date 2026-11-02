import {
  DestroyRef, Injectable, inject, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { CodingTrainingBackendService } from '../../services/coding-training-backend.service';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { TrainingDiscussionApplySource } from '../../../../../../../api-dto/coding/training-discussion-apply.dto';
import {
  ApplyTrainingDiscussionResultsDialogComponent,
  ApplyTrainingDiscussionResultsDialogData,
  ApplyTrainingDiscussionResultsDialogResult
} from './apply-training-discussion-results-dialog.component';

export interface DiscussionApplyContext {
  workspaceId: number;
  trainingId: number;
  canApply: () => boolean;
  isCurrent: () => boolean;
  reload: () => void;
}

/** Owns preview, confirmation and application for one comparison dialog. */
@Injectable()
export class TrainingDiscussionApplyFacade {
  private readonly destroyRef = inject(DestroyRef);
  private readonly codingTrainingBackendService = inject(CodingTrainingBackendService);
  private readonly testPersonCodingService = inject(TestPersonCodingService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly translate = inject(TranslateService);
  readonly isApplyingDiscussionResults = signal(false);
  private operationId = 0;

  open(source: TrainingDiscussionApplySource, context: DiscussionApplyContext): void {
    if (!context.canApply()) return;
    if (!context.trainingId) {
      this.snackBar.open(this.translate.instant('coding.trainings.compare.training-required'), this.translate.instant('common.close'), { duration: 3000 });
      return;
    }

    const trainingId = context.trainingId;
    this.operationId += 1;
    const operationId = this.operationId;
    this.isApplyingDiscussionResults.set(true);
    this.codingTrainingBackendService.previewApplyDiscussionResults(
      context.workspaceId,
      trainingId,
      source
    ).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: preview => {
          if (operationId !== this.operationId) return;
          if (!context.isCurrent()) {
            this.isApplyingDiscussionResults.set(false);
            return;
          }
          this.isApplyingDiscussionResults.set(false);
          const dialogRef = this.dialog.open<ApplyTrainingDiscussionResultsDialogComponent, ApplyTrainingDiscussionResultsDialogData, ApplyTrainingDiscussionResultsDialogResult | undefined>(ApplyTrainingDiscussionResultsDialogComponent, {
            width: '720px',
            data: { preview, source }
          });

          dialogRef.afterClosed()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(result => {
              if (!result ||
                operationId !== this.operationId ||
                !context.isCurrent()) {
                return;
              }
              this.applyTrainingDiscussionResults(source, result, context, operationId);
            });
        },
        error: error => {
          if (operationId !== this.operationId) return;
          if (!context.isCurrent()) {
            this.isApplyingDiscussionResults.set(false);
            return;
          }
          this.isApplyingDiscussionResults.set(false);
          this.snackBar.open(
            this.getApplyDiscussionResultsErrorMessage(error),
            this.translate.instant('common.close'),
            { duration: 4000 }
          );
        }
      });
  }

  private applyTrainingDiscussionResults(
    source: TrainingDiscussionApplySource,
    strategies: ApplyTrainingDiscussionResultsDialogResult,
    context: DiscussionApplyContext,
    operationId: number
  ): void {
    const trainingId = context.trainingId;
    if (!context.canApply()) return;
    if (!trainingId) {
      return;
    }

    this.isApplyingDiscussionResults.set(true);
    this.codingTrainingBackendService.applyDiscussionResults(
      context.workspaceId,
      trainingId,
      {
        source,
        existingResultStrategy: strategies.existingResultStrategy,
        jobConflictStrategy: strategies.jobConflictStrategy
      }
    ).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => {
          if (operationId !== this.operationId) return;
          if (!context.isCurrent()) {
            this.isApplyingDiscussionResults.set(false);
            return;
          }
          this.isApplyingDiscussionResults.set(false);
          this.snackBar.open(
            this.getApplyDiscussionResultsMessage(result),
            this.translate.instant('common.close'),
            { duration: 5000 }
          );
          if (result.updatedResponsesCount > 0 || result.removedJobUnitCount > 0) {
            this.testPersonCodingService.notifyTestResultsChanged({
              workspaceId: context.workspaceId,
              statisticsVersion: 'v2'
            });
          }
          context.reload();
        },
        error: error => {
          if (operationId !== this.operationId) return;
          if (!context.isCurrent()) {
            this.isApplyingDiscussionResults.set(false);
            return;
          }
          this.isApplyingDiscussionResults.set(false);
          this.snackBar.open(
            this.getApplyDiscussionResultsErrorMessage(error),
            this.translate.instant('common.close'),
            { duration: 5000 }
          );
        }
      });
  }

  private getApplyDiscussionResultsMessage(result: {
    success: boolean;
    updatedResponsesCount: number;
    skippedExistingResultsCount: number;
    overwrittenExistingResultsCount: number;
    skippedJobConflictCount: number;
    skippedMissingScoreCount: number;
    removedJobUnitCount: number;
  }): string {
    if (!result.success) {
      return this.translate.instant('coding.trainings.compare.apply-error');
    }

    const parts = [this.translate.instant('coding.trainings.compare.apply-updated', { count: result.updatedResponsesCount })];
    if (result.overwrittenExistingResultsCount > 0) {
      parts.push(this.translate.instant('coding.trainings.compare.apply-overwritten', { count: result.overwrittenExistingResultsCount }));
    }
    if (result.skippedExistingResultsCount > 0) {
      parts.push(this.translate.instant('coding.trainings.compare.apply-skipped-existing', { count: result.skippedExistingResultsCount }));
    }
    if (result.skippedJobConflictCount > 0) {
      parts.push(this.translate.instant('coding.trainings.compare.apply-skipped-conflicts', { count: result.skippedJobConflictCount }));
    }
    if (result.skippedMissingScoreCount > 0) {
      parts.push(this.translate.instant('coding.trainings.compare.apply-skipped-scores', { count: result.skippedMissingScoreCount }));
    }
    if (result.removedJobUnitCount > 0) {
      parts.push(this.translate.instant('coding.trainings.compare.apply-removed-jobs', { count: result.removedJobUnitCount }));
    }

    return `${parts.join(', ')}.`;
  }

  private getApplyDiscussionResultsErrorMessage(error: unknown): string {
    const fallbackMessage = this.translate.instant('coding.trainings.compare.apply-error');
    if (!(error instanceof HttpErrorResponse)) {
      return fallbackMessage;
    }

    const responseMessage = error.error?.message;
    const message = Array.isArray(responseMessage) ?
      responseMessage.join(' ') :
      responseMessage || error.message;

    return typeof message === 'string' && message.trim() ?
      message :
      fallbackMessage;
  }
}
