import {
  ChangeDetectionStrategy, Component, input, output
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Variable, VariableBundle } from '../../models/coding-job.model';
import { activateOnKeyboard } from '../../../shared/utils/keyboard-activation.util';

@Component({
  selector: 'coding-box-job-bundle-selection',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslateModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatCheckboxModule, MatProgressSpinnerModule],
  templateUrl: './job-bundle-selection.component.html',
  styleUrls: ['./job-bundle-selection.component.scss'],
  host: { style: 'display: block' }
})
export class JobBundleSelectionComponent {
  readonly rows = input.required<readonly JobBundleRow[]>();
  readonly filter = input('');
  readonly totalBundles = input(0);
  readonly selectedCount = input(0);
  readonly loading = input(false);
  readonly readOnly = input(false);
  readonly mode = input.required<'definition' | 'job'>();
  readonly filterChanged = output<string>();
  readonly applyFilter = output<void>();
  readonly clearFilter = output<void>();
  readonly bundleToggled = output<VariableBundle>();
  readonly orderingChanged = output<{ bundle: VariableBundle; mode: 'continuous' | 'alternating' }>();
  readonly deriveErrorChanged = output<{ bundle: VariableBundle; variable: Variable; included: boolean }>();
  protected readonly onActionKeydown = activateOnKeyboard;
}

export interface JobBundleRow {
  bundle: VariableBundle;
  selected: boolean;
  variables: { variable: Variable; hasDeriveError: boolean; includeDeriveError: boolean }[];
}
