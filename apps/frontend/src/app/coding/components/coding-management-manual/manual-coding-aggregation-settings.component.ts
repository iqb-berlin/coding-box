import {
  ChangeDetectionStrategy, Component, computed, inject, input, output
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ResponseMatchingFlag } from '../../../shared/services/workspace/workspace-settings.service';
import { ManualCodingSettingsFacade } from './manual-coding-settings.facade';

@Component({
  selector: 'coding-box-manual-coding-aggregation-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './manual-coding-aggregation-settings.component.html',
  styleUrl: './manual-coding-aggregation-settings.component.scss',
  imports: [FormsModule, TranslateModule, MatButtonModule, MatCheckboxModule, MatSlideToggleModule, MatFormFieldModule, MatInputModule, MatIconModule, MatProgressSpinnerModule]
})
export class ManualCodingAggregationSettingsComponent {
  private readonly settings = inject(ManualCodingSettingsFacade);
  readonly isCalculating = input(false);
  readonly isLoadingResponseAnalysis = input(false);
  readonly isApplying = input(false);
  readonly thresholdChanged = output<number>();
  readonly aggregationModeChanged = output<boolean>();
  readonly matchingFlagToggled = output<ResponseMatchingFlag>();
  readonly restartRequested = output<void>();
  protected readonly duplicateAggregationThreshold = this.settings.duplicateAggregationThreshold;
  protected readonly isLoadingMatchingMode = this.settings.isLoadingMatchingMode;
  protected readonly isSavingMatchingMode = this.settings.isSavingMatchingMode;
  protected readonly ResponseMatchingFlag = ResponseMatchingFlag;
  protected readonly isApplyingDuplicateAggregation = computed(() => this.isApplying() || this.settings.isSavingThreshold());

  protected get isDuplicateAggregationActive(): boolean {
    return !this.hasMatchingFlag(ResponseMatchingFlag.NO_AGGREGATION);
  }

  protected hasMatchingFlag(flag: ResponseMatchingFlag): boolean { return this.settings.responseMatchingFlags().includes(flag); }
  protected hasPendingAggregationOptionsWithoutAggregation(): boolean {
    return this.hasMatchingFlag(ResponseMatchingFlag.NO_AGGREGATION) && this.settings.getSelectedAggregationOptionFlags().length > 0;
  }

  protected hasUnsavedResponseMatchingChanges(): boolean {
    return !this.settings.areMatchingFlagsEqual(this.settings.getPersistableResponseMatchingFlags(), this.settings.persistedResponseMatchingFlags);
  }
}
