import {
  computed, DestroyRef, inject, Injectable, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { finalize, Subject } from 'rxjs';
import { injectUiTranslator } from '../../../shared/utils/ui-translator';
import { AppService } from '../../../core/services/app.service';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog.component';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { CodingJob } from '../../models/coding-job.model';
import { ApplyCodingResultsResponse, BulkApplyCodingResultsResponse, CodingJobBackendService } from '../../services/coding-job-backend.service';
import { ApplyCodingResultsDialogComponent, ApplyCodingResultsDialogResult } from '../coding-jobs/apply-coding-results-dialog.component';
import { ManualCodingStatisticsFacade } from './manual-coding-statistics.facade';

/** Result application owns its confirmations, requests and feedback for this view. */
@Injectable()
export class ManualCodingCompletionFacade {
  private readonly uiTranslate = injectUiTranslator();

  private readonly destroyRef = inject(DestroyRef);
  private readonly appService = inject(AppService);
  private readonly codingJobBackendService = inject(CodingJobBackendService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly translateService = inject(TranslateService);
  private readonly statistics = inject(ManualCodingStatisticsFacade);
  private readonly completedJobsReadyForApply = this.statistics.completedJobsReadyForApply;
  private readonly hasCompletedJobsReadyForApply = computed(() => this.completedJobsReadyForApply().length > 0);
  private readonly isApplyingBulk = signal(false);
  private readonly applyingJobIds = signal<ReadonlySet<number>>(new Set());
  readonly isApplyingCodingResults = computed(() => this.isApplyingBulk() || this.applyingJobIds().size > 0);
  private readonly appliedSubject = new Subject<void>();
  readonly resultsApplied$ = this.appliedSubject.asObservable();

  constructor() { this.destroyRef.onDestroy(() => this.appliedSubject.complete()); }

  isApplyingJobResults(jobId: number): boolean { return this.applyingJobIds().has(jobId); }

  private showError(message: string): void {
    this.snackBar.open(message, this.uiTranslate('deferred-view.close'), { duration: 5000, panelClass: ['error-snackbar'] });
  }

  private showSuccess(message: string): void {
    this.snackBar.open(message, this.uiTranslate('deferred-view.close'), { duration: 5000, panelClass: ['success-snackbar'] });
  }

  applyCompletedJobResults(job: CodingJob, canApply: () => boolean): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.showError(this.uiTranslate('error.noWorkspaceSelected'));
      return;
    }

    if (!canApply()) {
      this.showError(this.uiTranslate('ui-text.manual-coding-completion.keine-berechtigung-zum-anwenden-von-job-ergebnissen'));
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

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)).subscribe((dialogResult?: ApplyCodingResultsDialogResult | false) => {
      if (!dialogResult || !canApply()) {
        return;
      }

      this.applyingJobIds.update(ids => new Set(ids).add(job.id));
      const loadingSnack = this.snackBar.open(
        this.uiTranslate('ui-text.coding-jobs.wende-ergebnisse-fuer-kodierjob-an', { name: job.name }),
        '',
        { duration: 3000 }
      );

      this.codingJobBackendService
        .applyCodingResults(workspaceId, job.id, {
          overwriteExisting: dialogResult.overwriteExisting
        })
        .pipe(
          finalize(() => {
            this.applyingJobIds.update(ids => { const next = new Set(ids); next.delete(job.id); return next; });
            loadingSnack.dismiss();
          }),
          takeUntilWorkspaceChanged(this.appService),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe({
          next: result => {
            if (result.success) {
              this.showSuccess(this.formatApplyCodingResultsMessage(result));
              this.appliedSubject.next();
              return;
            }

            this.showError(
              this.uiTranslate('ui-text.coding-jobs.fehler-beim-anwenden-der-ergebnisse', {
                value1: this.translateService.instant(
                  result.messageKey,
                  result.messageParams || {}
                )
              })
            );
          },
          error: error => {
            this.showError(
              this.uiTranslate('ui-text.coding-jobs.fehler-beim-anwenden-der-ergebnisse', { value1: error.message || this.uiTranslate('error.unknown') })
            );
          }
        });
    });
  }

  applyAllCompletedJobResults(canApply: () => boolean): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.showError(this.uiTranslate('error.noWorkspaceSelected'));
      return;
    }

    if (!canApply()) {
      this.showError(this.uiTranslate('ui-text.manual-coding-completion.keine-berechtigung-zum-anwenden-von-job-ergebnissen'));
      return;
    }

    if (!this.hasCompletedJobsReadyForApply()) {
      this.showError(this.uiTranslate('ui-text.manual-coding-completion.keine-abgeschlossenen-kodierjobs-zum-anwenden-gefunden'));
      return;
    }

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '500px',
      data: {
        title: this.uiTranslate('ui-text.manual-coding-completion.alle-abgeschlossenen-ergebnisse-anwenden'),
        message: [
          this.uiTranslate('ui-text.manual-coding-completion.moechten-sie-die-ergebnisse-fuer-abgeschlossene-kodierjob-s-anwenden', { value1: this.completedJobsReadyForApply().length }),
          this.uiTranslate('ui-text.coding-jobs.bei-jobs-mit-offenen-kodierungshinweisen-werden-gueltige-antworten-angewendet'),
          this.uiTranslate('ui-text.coding-jobs.offene-hinweise-bleiben-zur-manuellen-pruefung-bestehen')
        ].join(' '),
        confirmButtonText: this.uiTranslate('coding.trainings.compare.apply-dialog.apply'),
        cancelButtonText: this.uiTranslate('cancel')
      }
    });

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)).subscribe(confirmed => {
      if (confirmed && canApply()) {
        this.performBulkApplyCompletedJobResults(workspaceId);
      }
    });
  }

  private performBulkApplyCompletedJobResults(workspaceId: number): void {
    this.isApplyingBulk.set(true);
    const loadingSnack = this.snackBar.open(
      this.uiTranslate('ui-text.manual-coding-completion.wende-ergebnisse-fuer-alle-abgeschlossenen-kodierjobs-an'),
      '',
      { duration: 3000 }
    );

    this.codingJobBackendService
      .bulkApplyCodingResults(workspaceId)
      .pipe(
        finalize(() => {
          this.isApplyingBulk.set(false);
          loadingSnack.dismiss();
        }),
        takeUntilWorkspaceChanged(this.appService),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: result => {
          if (result.success) {
            this.showSuccess(this.formatBulkApplyCodingResultsMessage(result));
            this.appliedSubject.next();
            return;
          }

          this.showError(this.uiTranslate('ui-text.coding-jobs.fehler-bei-der-massenanwendung', { message: result.message }));
        },
        error: error => {
          this.showError(
            this.uiTranslate('ui-text.coding-jobs.fehler-bei-der-massenanwendung-473110', { value1: error.message || this.uiTranslate('error.unknown') })
          );
        }
      });
  }

  private formatApplyCodingResultsMessage(
    result: ApplyCodingResultsResponse
  ): string {
    const parts = [
      this.uiTranslate('ui-text.coding-jobs.ergebnisse-erfolgreich-angewendet-antworten-aktualisiert', { updatedResponsesCount: result.updatedResponsesCount })
    ];

    if (result.skippedAlreadyCodedCount > 0) {
      parts.push(
        this.uiTranslate('ui-text.coding-jobs.bereits-vorhandene-kodierungen-nicht-ueberschrieben-antworten', { skippedAlreadyCodedCount: result.skippedAlreadyCodedCount })
      );
    }

    if (result.overwrittenExistingCount > 0) {
      parts.push(
        this.uiTranslate('ui-text.coding-jobs.vorhandene-kodierungen-ueberschrieben-antworten', { overwrittenExistingCount: result.overwrittenExistingCount })
      );
    }

    if (result.skippedReviewCount > 0) {
      parts.push(
        this.uiTranslate('ui-text.coding-jobs.uebersprungen-manuelle-pruefung-benoetigt-antworten', { skippedReviewCount: result.skippedReviewCount })
      );
    }

    return parts.join('\n');
  }

  private formatBulkApplyCodingResultsMessage(
    result: BulkApplyCodingResultsResponse
  ): string {
    const skippedCount = result.results.filter(item => item.skipped).length;
    const failedCount = result.results.filter(
      item => item.result && !item.result.success
    ).length;
    const parts = [
      this.uiTranslate('ui-text.manual-coding-completion.massenanwendung-abgeschlossen-jobs-verarbeitet', { jobsProcessed: result.jobsProcessed }),
      this.uiTranslate('ui-text.manual-coding-completion.antworten-aktualisiert', { totalUpdatedResponses: result.totalUpdatedResponses })
    ];

    if (result.totalSkippedAlreadyCoded > 0) {
      parts.push(
        this.uiTranslate('ui-text.manual-coding-completion.vorhandene-kodierungen-beibehalten', { totalSkippedAlreadyCoded: result.totalSkippedAlreadyCoded })
      );
    }

    if (result.totalOverwrittenExisting > 0) {
      parts.push(
        this.uiTranslate('ui-text.manual-coding-completion.vorhandene-kodierungen-ueberschrieben', { totalOverwrittenExisting: result.totalOverwrittenExisting })
      );
    }

    if (result.totalSkippedReview > 0) {
      parts.push(
        this.uiTranslate('ui-text.manual-coding-completion.ergebnisse-zur-manuellen-pruefung-uebersprungen', { totalSkippedReview: result.totalSkippedReview })
      );
    }

    if (skippedCount > 0) {
      parts.push(this.uiTranslate('ui-text.manual-coding-completion.jobs-uebersprungen', { skippedCount: skippedCount }));
    }

    if (failedCount > 0) {
      parts.push(this.uiTranslate('ui-text.manual-coding-completion.jobs-mit-konflikten-fehlern-nicht-angewendet', { failedCount: failedCount }));
    }

    return parts.join(', ');
  }
}
