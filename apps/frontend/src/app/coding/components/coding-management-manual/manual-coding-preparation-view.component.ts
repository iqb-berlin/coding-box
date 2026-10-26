import {
  ChangeDetectionStrategy, Component, inject, input, output
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ManualCodingAggregationSettingsComponent } from './manual-coding-aggregation-settings.component';
import { ManualCodingAggregationFacade } from './manual-coding-aggregation.facade';
import { ManualCodingAnalysisFacade } from './manual-coding-analysis.facade';
import { ManualCodingSummaryFacade } from './manual-coding-summary.facade';
import { ResponseMatchingFlag } from '../../../shared/services/workspace/workspace-settings.service';
import { ManualCodingViewState } from './manual-coding-view-state.service';

@Component({
  selector: 'coding-box-manual-coding-preparation-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, TranslateModule, MatIcon, MatIconButton, MatButton, MatProgressBarModule, MatProgressSpinnerModule, MatTooltipModule, MatPaginatorModule, ManualCodingAggregationSettingsComponent],
  templateUrl: './manual-coding-preparation-view.component.html',
  styleUrl: './manual-coding-preparation-view.component.scss',
  host: { style: 'display: contents' }
})
export class ManualCodingPreparationViewComponent {
  private readonly summary = inject(ManualCodingSummaryFacade);
  private readonly analysis = inject(ManualCodingAnalysisFacade);
  private readonly aggregation = inject(ManualCodingAggregationFacade);
  private translateService = inject(TranslateService);

  readonly canApplyCompletedJobResults = input(false);
  readonly emptyResponseMissing = input<{ code: number; score: number | null } | null>(null);
  readonly emptyCodingRequested = output<void>();

  private readonly viewState = inject(ManualCodingViewState);

  protected readonly isLoadingResponseAnalysis = this.analysis.isLoadingResponseAnalysis;

  protected readonly isApplyingDuplicateAggregation = this.aggregation.isApplyingDuplicateAggregation;

  protected onThresholdChanged(newValue: number | string | null): void { return this.aggregation.onThresholdChanged(newValue); }

  protected onAggregationModeChanged(aggregateResponses: boolean): void { return this.aggregation.onAggregationModeChanged(aggregateResponses); }

  protected toggleMatchingFlag(flag: ResponseMatchingFlag): void { return this.aggregation.toggleMatchingFlag(flag); }

  protected restartAnalysis(rollbackResponseMatchingFlags?: ResponseMatchingFlag[]): void { return this.aggregation.restartAnalysis(rollbackResponseMatchingFlags); }

  protected readonly isResponseAnalysisOutdated = this.summary.isResponseAnalysisOutdated;

  protected readonly hasResponseAnalysisRestScopeDifference = this.summary.hasResponseAnalysisRestScopeDifference;

  protected readonly getResponseAnalysisReferenceRawCases = this.summary.getResponseAnalysisReferenceRawCases;

  protected readonly getCurrentRawManualResponses = this.summary.getCurrentRawManualResponses;

  protected readonly hasUncodedEmptyResponses = this.summary.hasUncodedEmptyResponses;

  protected readonly showEmptyResponsesDetails = this.viewState.showEmptyResponsesDetails;

  protected toggleEmptyResponsesDetails(): void {
    this.showEmptyResponsesDetails.set(!this.showEmptyResponsesDetails());
  }

  protected readonly getUncodedCount = this.summary.getUncodedCount;

  protected readonly emptyPageSize = this.analysis.emptyPageSize;

  protected readonly emptyPageIndex = this.analysis.emptyPageIndex;

  protected onEmptyPageChange(event: PageEvent): void {
    this.analysis.changeEmptyPage(event.pageIndex, event.pageSize);
    this.loadResponseAnalysis();
  }

  protected readonly isApplyingEmptyCoding = this.aggregation.isApplyingEmptyCoding;

  protected getApplyEmptyResponseCodingTooltip(): string {
    const emptyResponseMissingSnapshot = this.emptyResponseMissing();

    if (!emptyResponseMissingSnapshot) {
      return this.translateService.instant(
        'coding-management-manual.response-analysis.apply-empty-coding-tooltip-loading'
      );
    }

    return this.translateService.instant(
      'coding-management-manual.response-analysis.apply-empty-coding-tooltip',
      {
        ...emptyResponseMissingSnapshot,
        score: this.getScoreDisplay(emptyResponseMissingSnapshot.score)
      }
    );
  }

  protected readonly hasDuplicateFindingsWithoutAggregation = this.summary.hasDuplicateFindingsWithoutAggregation;

  protected readonly showDuplicateValuesDetails = this.viewState.showDuplicateValuesDetails;

  protected toggleDuplicateValuesDetails(): void {
    this.showDuplicateValuesDetails.set(!this.showDuplicateValuesDetails());
  }

  protected readonly responseAnalysisAggregationSavings = this.summary.responseAnalysisAggregationSavings;

  protected readonly duplicatePageSize = this.analysis.duplicatePageSize;

  protected readonly duplicatePageIndex = this.analysis.duplicatePageIndex;

  protected onDuplicatePageChange(event: PageEvent): void {
    this.analysis.changeDuplicatePage(event.pageIndex, event.pageSize);
    this.loadResponseAnalysis();
  }

  protected getScoreDisplay(score: number | null): string | number {
    return score === null ? 'NA' : score;
  }

  protected loadResponseAnalysis(): void { return this.analysis.loadResponseAnalysis(); }

  protected readonly responseAnalysis = this.analysis.responseAnalysis;

  protected readonly responseAnalysisError = this.analysis.responseAnalysisError;
}
