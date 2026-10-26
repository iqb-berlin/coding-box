import {
  ChangeDetectionStrategy, Component, inject, input, output
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { getJobDefinitionDisplayLabel } from '../../utils/job-definition-display.util';
import { ManualCodingStatisticsFacade } from './manual-coding-statistics.facade';
import { ManualCodingViewState } from './manual-coding-view-state.service';

@Component({
  selector: 'coding-box-manual-coding-planning-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, TranslateModule, MatIcon, MatIconButton, MatProgressBarModule, MatProgressSpinnerModule, MatTooltipModule],
  templateUrl: './manual-coding-planning-view.component.html',
  styleUrl: './manual-coding-planning-view.component.scss',
  host: { style: 'display: contents' }
})
export class ManualCodingPlanningViewComponent {
  private readonly statistics = inject(ManualCodingStatisticsFacade);

  readonly shouldShowManualRefreshButton = input(false);
  readonly refreshRequested = output<void>();

  private readonly viewState = inject(ManualCodingViewState);

  protected readonly isLoadingVariableCoverage = this.statistics.isLoadingVariableCoverage;

  protected readonly showVariableCoverageInfo = this.viewState.showVariableCoverageInfo;

  protected getJobDefinitionIdentityLabel(definition: { id: number; name?: string }): string {
    return getJobDefinitionDisplayLabel(definition);
  }

  protected getStatusLabel(status: string): string {
    switch (status) {
      case 'draft':
        return 'Entwurf';
      case 'pending_review':
        return 'Warten auf Genehmigung';
      case 'approved':
        return 'Genehmigt';
      default:
        return status;
    }
  }

  protected readonly variableCoverageOverview = this.statistics.variableCoverageOverview;
}
