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
      return this.uiTranslate('ui-text.coding-management-manual.results-applied');
    }

    if (this.hasCompletedJobsReadyForApply()) {
      if (this.hasCompletedJobsBlockedForReview()) {
        return this.uiTranslate('ui-text.coding-management-manual.ready-jobs-with-issues', { value1: this.completedJobsReadyForApply().length, value2: this.completedJobsBlockedForReview().length });
      }
      return this.uiTranslate('ui-text.coding-management-manual.ready-jobs', { value1: this.completedJobsReadyForApply().length });
    }

    if (this.hasCompletedJobsBlockedForReview()) {
      return this.uiTranslate('ui-text.coding-management-manual.jobs-require-review', { value1: this.completedJobsBlockedForReview().length });
    }

    if (this.hasExecutionOpenWork()) {
      return this.uiTranslate('ui-text.coding-management-manual.execution-incomplete');
    }

    return this.uiTranslate('ui-text.coding-management-manual.no-ready-jobs');
  }

  protected getCompletionActionDescription(): string {
    if (this.isCompletionComplete()) {
      return this.uiTranslate('ui-text.manual-coding-completion-view.completion-hint');
    }

    if (this.hasCompletedJobsReadyForApply()) {
      if (!this.canApplyCompletedJobResults()) {
        return this.uiTranslate('ui-text.manual-coding-completion-view.apply-permission-required');
      }

      return this.uiTranslate('ui-text.manual-coding-completion-view.apply-ready-hint');
    }

    if (this.hasCompletedJobsBlockedForReview()) {
      return this.uiTranslate('ui-text.manual-coding-completion-view.review-jobs-hint');
    }

    if (this.hasExecutionOpenWork()) {
      return this.uiTranslate('ui-text.manual-coding-completion-view.finish-cases-hint');
    }

    return this.uiTranslate('ui-text.manual-coding-completion-view.refresh-jobs-hint');
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
      return this.uiTranslate('ui-text.coding-management-manual.coded-results', { codedUnits: codedUnits, totalUnits: totalUnits });
    }

    return this.uiTranslate('ui-text.coding-management-manual.results-available');
  }

  protected isApplyingJobResults(jobId: number): boolean {
    return this.completion.isApplyingJobResults(jobId);
  }

  protected readonly hasCompletedJobsBlockedForReview = this.summary.hasCompletedJobsBlockedForReview;

  protected readonly completedJobsBlockedForReview = this.statistics.completedJobsBlockedForReview;

  protected readonly appliedResultsOverview = this.statistics.appliedResultsOverview;
  protected readonly hasExecutionOpenWork = this.summary.hasExecutionOpenWork;
}
