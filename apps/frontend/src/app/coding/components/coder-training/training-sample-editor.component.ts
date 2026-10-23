import {
  ChangeDetectionStrategy, Component, input, output
} from '@angular/core';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CoderTrainingForm, TrainingVariableForm } from './coder-training-form';
import { Variable, VariableBundle } from '../../models/coding-job.model';

@Component({
  selector: 'coding-box-training-sample-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, TranslateModule, MatButtonModule, MatIconModule, MatDividerModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatCheckboxModule, MatTooltipModule, MatProgressSpinnerModule],
  templateUrl: './training-sample-editor.component.html',
  styleUrls: ['./training-sample-editor.component.scss']
})
export class TrainingSampleEditorComponent {
  readonly form = input.required<CoderTrainingForm>();
  readonly view = input.required<TrainingSampleView>();
  readonly editable = input(false);
  readonly loadingBundles = input(false);
  readonly loadingVariables = input(false);
  readonly bundleFilterCtrl = input.required<FormControl<string>>();
  readonly variableFilterCtrl = input.required<FormControl<string>>();
  readonly importRequested = output<void>();
  readonly bundlesChanged = output<number[]>();
  readonly variablesChanged = output<string[]>();
  readonly selectAllVariables = output<void>();
  readonly clearVariables = output<void>();
  readonly bundleRemoved = output<number>();
  readonly variableRemoved = output<number>();
  readonly bundleSampleChanged = output<{ id: number; value: string }>();
  readonly bundleOrderingChanged = output<{ id: number; mode: 'continuous' | 'alternating' }>();
  readonly deriveErrorChanged = output<{ control: TrainingVariableForm; included: boolean }>();
}

export interface TrainingSampleRow {
  control: TrainingVariableForm;
  index: number;
  derived: boolean;
  insufficient: boolean;
  availableCount: number;
  hasDeriveError: boolean;
  deriveErrorCount: number;
}

export interface TrainingSampleView {
  derivedCount: number;
  bundleCount: number;
  variableCount: number;
  selectedBundleIds: number[];
  manualKeys: string[];
  hasSelectableVariables: boolean;
  hasManualVariables: boolean;
  bundles: { bundle: VariableBundle; derivedCount: number; effectiveCount: number }[];
  variables: { variable: Variable; derived: boolean }[];
  manual: TrainingSampleRow[];
  groups: {
    bundle: VariableBundle;
    variables: TrainingSampleRow[];
    deriveErrorRows: TrainingSampleRow[];
    sampleCount: number;
    derivedCount: number;
    insufficient: boolean;
    orderingLabel: string;
  }[];
}
