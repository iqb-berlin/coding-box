import {
  ChangeDetectionStrategy, Component, input, output
} from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatRadioModule } from '@angular/material/radio';
import { CoderTrainingForm, hasValidTrainingReferenceMode } from './coder-training-form';
import { Coder } from '../../models/coder.model';
import { CoderTraining } from '../../models/coder-training.model';
import { getTrainingOptionMeta, getTrainingOptionTitle } from '../../utils/coder-training-display';

@Component({
  selector: 'coding-box-training-participant-selection',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, TranslateModule, MatButtonModule, MatIconModule, MatDividerModule, MatFormFieldModule, MatSelectModule, MatRadioModule],
  templateUrl: './training-participant-selection.component.html',
  styleUrls: ['./training-participant-selection.component.scss']
})
export class TrainingParticipantSelectionComponent {
  readonly form = input.required<CoderTrainingForm>();
  readonly trainings = input.required<readonly CoderTraining[]>();
  readonly coders = input.required<readonly Coder[]>();
  readonly selected = input.required<ReadonlySet<number>>();
  readonly editable = input(false);
  readonly coderToggled = output<Coder>();
  readonly selectAll = output<void>();
  readonly clearSelection = output<void>();
  protected readonly getTrainingOptionTitle = getTrainingOptionTitle;
  protected readonly getTrainingOptionMeta = getTrainingOptionMeta;

  protected hasValidReferenceMode(): boolean {
    return hasValidTrainingReferenceMode(this.form());
  }
}
