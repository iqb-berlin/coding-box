import {
  computed, DestroyRef, inject, Injectable, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { finalize, Subject } from 'rxjs';
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
    this.snackBar.open(message, 'Schließen', { duration: 5000, panelClass: ['error-snackbar'] });
  }

  private showSuccess(message: string): void {
    this.snackBar.open(message, 'Schließen', { duration: 5000, panelClass: ['success-snackbar'] });
  }

  applyCompletedJobResults(job: CodingJob, canApply: () => boolean): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.showError('Kein Workspace ausgewählt');
      return;
    }

    if (!canApply()) {
      this.showError('Keine Berechtigung zum Anwenden von Job-Ergebnissen.');
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
        `Wende Ergebnisse für Kodierjob "${job.name}" an...`,
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
              `Fehler beim Anwenden der Ergebnisse: ${this.translateService.instant(
                result.messageKey,
                result.messageParams || {}
              )}`
            );
          },
          error: error => {
            this.showError(
              `Fehler beim Anwenden der Ergebnisse: ${error.message || 'Unbekannter Fehler'}`
            );
          }
        });
    });
  }

  applyAllCompletedJobResults(canApply: () => boolean): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.showError('Kein Workspace ausgewählt');
      return;
    }

    if (!canApply()) {
      this.showError('Keine Berechtigung zum Anwenden von Job-Ergebnissen.');
      return;
    }

    if (!this.hasCompletedJobsReadyForApply()) {
      this.showError('Keine abgeschlossenen Kodierjobs zum Anwenden gefunden.');
      return;
    }

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '500px',
      data: {
        title: 'Alle abgeschlossenen Ergebnisse anwenden',
        message: [
          `Möchten Sie die Ergebnisse für ${this.completedJobsReadyForApply().length} abgeschlossene Kodierjob(s) anwenden?`,
          'Bei Jobs mit offenen Kodierungshinweisen werden gültige Antworten angewendet;',
          'offene Hinweise bleiben zur manuellen Prüfung bestehen.'
        ].join(' '),
        confirmButtonText: 'Anwenden',
        cancelButtonText: 'Abbrechen'
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
      'Wende Ergebnisse für alle abgeschlossenen Kodierjobs an...',
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

          this.showError(`Fehler bei der Massenanwendung: ${result.message}`);
        },
        error: error => {
          this.showError(
            `Fehler bei der Massenanwendung: ${error.message || 'Unbekannter Fehler'}`
          );
        }
      });
  }

  private formatApplyCodingResultsMessage(
    result: ApplyCodingResultsResponse
  ): string {
    const parts = [
      `Ergebnisse erfolgreich angewendet: ${result.updatedResponsesCount} Antworten aktualisiert`
    ];

    if (result.skippedAlreadyCodedCount > 0) {
      parts.push(
        `Bereits vorhandene Kodierungen nicht überschrieben: ${result.skippedAlreadyCodedCount} Antworten`
      );
    }

    if (result.overwrittenExistingCount > 0) {
      parts.push(
        `Vorhandene Kodierungen überschrieben: ${result.overwrittenExistingCount} Antworten`
      );
    }

    if (result.skippedReviewCount > 0) {
      parts.push(
        `Übersprungen (manuelle Prüfung benötigt): ${result.skippedReviewCount} Antworten`
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
      `Massenanwendung abgeschlossen: ${result.jobsProcessed} Jobs verarbeitet`,
      `${result.totalUpdatedResponses} Antworten aktualisiert`
    ];

    if (result.totalSkippedAlreadyCoded > 0) {
      parts.push(
        `${result.totalSkippedAlreadyCoded} vorhandene Kodierungen beibehalten`
      );
    }

    if (result.totalOverwrittenExisting > 0) {
      parts.push(
        `${result.totalOverwrittenExisting} vorhandene Kodierungen überschrieben`
      );
    }

    if (result.totalSkippedReview > 0) {
      parts.push(
        `${result.totalSkippedReview} Ergebnisse zur manuellen Prüfung übersprungen`
      );
    }

    if (skippedCount > 0) {
      parts.push(`${skippedCount} Jobs übersprungen`);
    }

    if (failedCount > 0) {
      parts.push(`${failedCount} Jobs mit Konflikten/Fehlern nicht angewendet`);
    }

    return parts.join(', ');
  }
}
