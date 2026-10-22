import {
  ChangeDetectionStrategy, Component, input, output
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Coder } from '../../models/coder.model';
import { activateOnKeyboard } from '../../../shared/utils/keyboard-activation.util';

@Component({
  selector: 'coding-box-job-coder-capacity',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule, MatTooltipModule],
  templateUrl: './job-coder-capacity.component.html',
  styleUrls: ['./job-coder-capacity.component.scss'],
  host: { style: 'display: block' }
})
export class JobCoderCapacityComponent {
  readonly coders = input.required<readonly Coder[]>();
  readonly selected = input.required<readonly Coder[]>();
  readonly loading = input(false);
  readonly readOnly = input(false);
  readonly mode = input.required<'definition' | 'job'>();
  readonly coderToggled = output<Coder>();
  readonly toggleAll = output<void>();
  readonly capacityChanged = output<{ coder: Coder; value: string }>();
  protected readonly onActionKeydown = activateOnKeyboard;

  protected isSelected(coder: Coder): boolean {
    return this.selected().some(selected => selected.id === coder.id);
  }

  protected isAllCodersSelected(): boolean {
    return this.selected().length === this.coders().length && this.coders().length > 0;
  }
}
