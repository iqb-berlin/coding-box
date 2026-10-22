import {
  ChangeDetectionStrategy, Component, input, output
} from '@angular/core';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CoderTraining } from '../../models/coder-training.model';
import { TrainingDiscussionApplySource } from '../../../../../../../api-dto/coding/training-discussion-apply.dto';
import { getTrainingOptionTitle, getTrainingOptionMeta } from '../../utils/coder-training-display';

@Component({
  selector: 'coding-box-training-comparison-selection',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ReactiveFormsModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatCheckboxModule, MatProgressSpinnerModule],
  templateUrl: './training-comparison-selection.component.html',
  styleUrls: ['./training-comparison-selection.component.scss']
})
export class TrainingComparisonSelectionComponent {
  readonly mode = input.required<'between-trainings' | 'within-training'>();
  readonly trainings = input.required<readonly CoderTraining[]>();
  readonly filteredTrainings = input.required<readonly CoderTraining[]>();
  readonly selectedTrainings = input.required<readonly number[]>();
  readonly selectedWithin = input<number | null>(null);
  readonly betweenCoders = input.required<readonly { trainingId: number; trainingLabel: string; coderId: number; coderName: string }[]>();
  readonly withinCoders = input.required<readonly { jobId: number; coderName: string }[]>();
  readonly betweenControl = input.required<FormControl<string[] | null>>();
  readonly withinControl = input.required<FormControl<number[] | null>>();
  readonly canApply = input(false);
  readonly loading = input(false);
  readonly applying = input(false);
  readonly filterChanged = output<string>();
  readonly trainingToggled = output<number>();
  readonly withinChanged = output<number>();
  readonly betweenCodersChanged = output<void>();
  readonly withinCodersChanged = output<void>();
  readonly applyRequested = output<TrainingDiscussionApplySource>();
  protected readonly getTrainingOptionTitle = getTrainingOptionTitle;
  protected getTrainingOptionMeta(training: CoderTraining): string {
    return getTrainingOptionMeta(training, 'Kodierer', 'Kodierer');
  }

  protected selectedTraining(): CoderTraining | undefined {
    return this.trainings().find(training => training.id === this.selectedWithin());
  }
}
