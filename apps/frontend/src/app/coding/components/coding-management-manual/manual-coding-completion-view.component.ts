import {
  ChangeDetectionStrategy, Component, inject, input, output
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { ManualCodingCompletionFacade } from './manual-coding-completion.facade';
import { ManualCodingStatisticsFacade } from './manual-coding-statistics.facade';
import { ManualCodingSummaryFacade } from './manual-coding-summary.facade';
import { CodingJob } from '../../models/coding-job.model';
import { ManualCodingViewState } from './manual-coding-view-state.service';

@Component({
  selector: 'coding-box-manual-coding-completion-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, TranslateModule, MatIcon, MatIconButton, MatButton, MatProgressBarModule, MatProgressSpinnerModule, MatTooltipModule],
  templateUrl: './manual-coding-completion-view.component.html',
  host: { style: 'display: contents' }
})
export class ManualCodingCompletionViewComponent {
  private readonly statistics = inject(ManualCodingStatisticsFacade);
  private readonly summary = inject(ManualCodingSummaryFacade);
  private readonly completion = inject(ManualCodingCompletionFacade);

  readonly canApplyCompletedJobResults = input(false);
  readonly applyAllRequested = output<void>();
  readonly jobApplyRequested = output<CodingJob>();
  readonly executionRequested = output<void>();

  private readonly viewState = inject(ManualCodingViewState);

  protected readonly showAppliedResultsInfo = this.viewState.showAppliedResultsInfo;

  protected readonly effectiveCodingCases = this.summary.effectiveCodingCases;

  protected readonly aggregationSavings = this.summary.aggregationSavings;

  protected readonly hasDeriveErrorManualCases = this.summary.hasDeriveErrorManualCases;

  protected readonly deriveErrorAppliedCases = this.summary.deriveErrorAppliedCases;

  protected readonly deriveErrorManualCases = this.summary.deriveErrorManualCases;

  protected readonly deriveErrorRemainingCases = this.summary.deriveErrorRemainingCases;

  protected readonly isCompletionComplete = this.summary.isCompletionComplete;

  protected readonly hasCompletedJobsReadyForApply = this.summary.hasCompletedJobsReadyForApply;

  protected getCompletionActionIcon(): string {
    if (this.isCompletionComplete()) {
      return 'task_alt';
    }

    if (this.hasCompletedJobsReadyForApply()) {
      return 'pending_actions';
    }

    if (this.hasCompletedJobsBlockedForReview()) {
      return 'rule';
    }

    return this.hasExecutionOpenWork() ? 'edit_note' : 'sync_problem';
  }

  protected getCompletionActionTitle(): string {
    if (this.isCompletionComplete()) {
      return 'Alle Ergebnisse sind übernommen';
    }

    if (this.hasCompletedJobsReadyForApply()) {
      if (this.hasCompletedJobsBlockedForReview()) {
        return `${this.completedJobsReadyForApply().length} abgeschlossene Kodierjob(s) bereit zum Anwenden, ${this.completedJobsBlockedForReview().length} mit offenen Hinweisen`;
      }
      return `${this.completedJobsReadyForApply().length} abgeschlossene Kodierjob(s) bereit zum Anwenden`;
    }

    if (this.hasCompletedJobsBlockedForReview()) {
      return `${this.completedJobsBlockedForReview().length} abgeschlossene Kodierjob(s) benötigen Review`;
    }

    if (this.hasExecutionOpenWork()) {
      return 'Noch nicht alle Kodierfälle sind abgeschlossen';
    }

    return 'Keine übernahmebereiten Kodierjobs gefunden';
  }

  protected getCompletionActionDescription(): string {
    if (this.isCompletionComplete()) {
      return 'Die manuelle Kodierung ist abgeschlossen und die Ergebnisse sind final in den Datenbestand übernommen.';
    }

    if (this.hasCompletedJobsReadyForApply()) {
      if (!this.canApplyCompletedJobResults()) {
        return 'Für das Anwenden der Job-Ergebnisse ist eine höhere Berechtigung erforderlich.';
      }

      return 'Übernehmen Sie die abgeschlossenen Job-Ergebnisse hier direkt in die Antwortdaten.';
    }

    if (this.hasCompletedJobsBlockedForReview()) {
      return 'Mindestens ein abgeschlossener Job enthält Markierungen wie "Code-Vergabe unsicher" oder "Neuer Code nötig". Prüfen Sie diese Jobs vor dem Anwenden.';
    }

    if (this.hasExecutionOpenWork()) {
      return 'Schließen Sie die offenen Kodierfälle ab. Danach können die Ergebnisse hier übernommen werden.';
    }

    return 'Aktualisieren Sie die Ansicht oder prüfen Sie die Kodierjobs, falls Sie gerade einen Job abgeschlossen haben.';
  }

  protected canShowCompletedJobApplyActions(): boolean {
    return this.hasCompletedJobsReadyForApply() &&
      this.canApplyCompletedJobResults();
  }

  protected readonly isApplyingCodingResults = this.completion.isApplyingCodingResults;

  protected readonly isLoadingCompletedJobsReadyForApply = this.statistics.isLoadingCompletedJobsReadyForApply;

  protected readonly completedJobsReadyForApply = this.statistics.completedJobsReadyForApply;

  protected getCodingJobResultSummary(job: CodingJob): string {
    const totalUnits = job.totalUnits ?? 0;
    const codedUnits = job.codedUnits ?? 0;

    if (totalUnits > 0) {
      return `${codedUnits}/${totalUnits} Ergebnisse kodiert`;
    }

    return 'Kodierergebnisse vorhanden';
  }

  protected isApplyingJobResults(jobId: number): boolean {
    return this.completion.isApplyingJobResults(jobId);
  }

  protected readonly hasCompletedJobsBlockedForReview = this.summary.hasCompletedJobsBlockedForReview;

  protected readonly completedJobsBlockedForReview = this.statistics.completedJobsBlockedForReview;

  protected readonly appliedResultsOverview = this.statistics.appliedResultsOverview;
  protected readonly hasExecutionOpenWork = this.summary.hasExecutionOpenWork;
}
