import {
  ChangeDetectionStrategy, Component, input, output
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { ManualCodingScopeSummary } from '../../services/coding-job-backend.service';
import { Variable } from '../../models/coding-job.model';
import { activateOnKeyboard } from '../../../shared/utils/keyboard-activation.util';

export interface JobVariableFilters {
  unitName: string;
  variableId: string;
  trainingRequired: 'all' | 'true' | 'false';
  availability: 'all' | 'full' | 'partial' | 'none';
}

export interface JobVariableRow {
  variable: Variable;
  selected: boolean;
  disabled: boolean;
  disabledReason: string;
  availabilityClass: string;
  availabilityText: string;
  hasDeriveError: boolean;
  includeDeriveError: boolean;
}

@Component({
  selector: 'coding-box-job-variable-selection',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslateModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatChipsModule, MatCheckboxModule, MatProgressSpinnerModule, MatTooltipModule, MatButtonToggleModule],
  templateUrl: './job-variable-selection.component.html',
  styleUrls: ['./job-variable-selection.component.scss'],
  host: { style: 'display: block' }
})
export class JobVariableSelectionComponent {
  readonly rows = input.required<readonly JobVariableRow[]>();
  readonly filters = input.required<JobVariableFilters>();
  readonly totalVariables = input(0);
  readonly selectedCount = input(0);
  readonly allSelected = input(false);
  readonly loading = input(false);
  readonly readOnly = input(false);
  readonly mode = input.required<'definition' | 'job'>();
  readonly scopeSummary = input<ManualCodingScopeSummary | null>(null);
  readonly filterChanged = output<Partial<JobVariableFilters>>();
  readonly availabilityChanged = output<JobVariableFilters['availability']>();
  readonly applyFilter = output<void>();
  readonly clearFilters = output<void>();
  readonly toggleAll = output<void>();
  readonly variableToggled = output<Variable>();
  readonly deriveErrorChanged = output<{ variable: Variable; included: boolean }>();
  protected readonly onActionKeydown = activateOnKeyboard;
}
