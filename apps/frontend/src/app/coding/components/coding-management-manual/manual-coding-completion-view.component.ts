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
import { injectUiTranslator } from '../../../shared/utils/ui-translator';
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
  styleUrl: './manual-coding-completion-view.component.scss',
  host: { style: 'display: contents' }
})
export class ManualCodingCompletionViewComponent {
  private readonly uiTranslate = injectUiTranslator();

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
      return this.uiTranslate('ui-text.coding-management-manual.alle-ergebnisse-sind-uebernommen');
    }

    if (this.hasCompletedJobsReadyForApply()) {
      if (this.hasCompletedJobsBlockedForReview()) {
        return this.uiTranslate('ui-text.coding-management-manual.abgeschlossene-kodierjob-s-bereit-zum-anwenden-mit-offenen-hinweisen', { value1: this.completedJobsReadyForApply().length, value2: this.completedJobsBlockedForReview().length });
      }
      return this.uiTranslate('ui-text.coding-management-manual.abgeschlossene-kodierjob-s-bereit-zum-anwenden', { value1: this.completedJobsReadyForApply().length });
    }

    if (this.hasCompletedJobsBlockedForReview()) {
      return this.uiTranslate('ui-text.coding-management-manual.abgeschlossene-kodierjob-s-benoetigen-review', { value1: this.completedJobsBlockedForReview().length });
    }

    if (this.hasExecutionOpenWork()) {
      return this.uiTranslate('ui-text.coding-management-manual.noch-nicht-alle-kodierfaelle-sind-abgeschlossen');
    }

    return this.uiTranslate('ui-text.coding-management-manual.keine-uebernahmebereiten-kodierjobs-gefunden');
  }

  protected getCompletionActionDescription(): string {
    if (this.isCompletionComplete()) {
      return this.uiTranslate('ui-text.manual-coding-completion-view.die-manuelle-kodierung-ist-abgeschlossen-und-die-ergebnisse-sind-final-in-den-datenbestand');
    }

    if (this.hasCompletedJobsReadyForApply()) {
      if (!this.canApplyCompletedJobResults()) {
        return this.uiTranslate('ui-text.manual-coding-completion-view.fuer-das-anwenden-der-job-ergebnisse-ist-eine-hoehere-berechtigung-erforderlich');
      }

      return this.uiTranslate('ui-text.manual-coding-completion-view.uebernehmen-sie-die-abgeschlossenen-job-ergebnisse-hier-direkt-in-die-antwortdaten');
    }

    if (this.hasCompletedJobsBlockedForReview()) {
      return this.uiTranslate('ui-text.manual-coding-completion-view.mindestens-ein-abgeschlossener-job-enthaelt-markierungen-wie-code-vergabe-unsicher-oder-ne');
    }

    if (this.hasExecutionOpenWork()) {
      return this.uiTranslate('ui-text.manual-coding-completion-view.schliessen-sie-die-offenen-kodierfaelle-ab-danach-koennen-die-ergebnisse-hier-uebernommen');
    }

    return this.uiTranslate('ui-text.manual-coding-completion-view.aktualisieren-sie-die-ansicht-oder-pruefen-sie-die-kodierjobs-falls-sie-gerade-einen-job-a');
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
      return this.uiTranslate('ui-text.coding-management-manual.ergebnisse-kodiert', { codedUnits: codedUnits, totalUnits: totalUnits });
    }

    return this.uiTranslate('ui-text.coding-management-manual.kodierergebnisse-vorhanden');
  }

  protected isApplyingJobResults(jobId: number): boolean {
    return this.completion.isApplyingJobResults(jobId);
  }

  protected readonly hasCompletedJobsBlockedForReview = this.summary.hasCompletedJobsBlockedForReview;

  protected readonly completedJobsBlockedForReview = this.statistics.completedJobsBlockedForReview;

  protected readonly appliedResultsOverview = this.statistics.appliedResultsOverview;
  protected readonly hasExecutionOpenWork = this.summary.hasExecutionOpenWork;
}
