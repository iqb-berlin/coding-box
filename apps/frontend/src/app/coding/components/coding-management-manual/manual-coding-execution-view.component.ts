import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { variableKey } from '../../utils/variable-key.util';
import { ManualCodingStatisticsFacade } from './manual-coding-statistics.facade';
import { ManualCodingSummaryFacade } from './manual-coding-summary.facade';
import { ManualCodingViewState } from './manual-coding-view-state.service';

@Component({
  selector: 'coding-box-manual-coding-execution-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, TranslateModule, MatIcon, MatIconButton, MatProgressBarModule, MatProgressSpinnerModule, MatTooltipModule],
  templateUrl: './manual-coding-execution-view.component.html',
  styleUrl: './manual-coding-execution-view.component.scss',
  host: { style: 'display: contents' }
})
export class ManualCodingExecutionViewComponent {
  protected readonly variableKey = variableKey;

  private readonly statistics = inject(ManualCodingStatisticsFacade);
  private readonly summary = inject(ManualCodingSummaryFacade);

  private readonly viewState = inject(ManualCodingViewState);

  protected readonly isLoadingCodingProgress = this.statistics.isLoadingCodingProgress;

  protected readonly showProgressInfo = this.viewState.showProgressInfo;

  protected readonly showTotalDetails = this.viewState.showTotalDetails;

  protected readonly codingIncompleteVariables = this.statistics.codingIncompleteVariables;

  protected getVariableEffectiveCaseCount(variable: {
    responseCount: number;
    uniqueCasesAfterAggregation?: number;
  }): number { return this.summary.getVariableEffectiveCaseCount(variable); }

  protected readonly codingProgressOverview = this.statistics.codingProgressOverview;
  protected readonly manualCodingScopeSummary = this.statistics.manualCodingScopeSummary;
}
