import {
  ChangeDetectionStrategy, Component, effect, input, output, untracked
} from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TestCenterLoginForm } from './test-center-import-form';
import { Testcenter } from '../../../shared/models/test-center-authentication.model';

@Component({
  selector: 'coding-box-test-center-login-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, TranslateModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  templateUrl: './test-center-login-step.component.html',
  styleUrls: ['./test-center-login-step.component.scss'],
  host: { style: 'display: block' }
})
export class TestCenterLoginStepComponent {
  readonly form = input.required<TestCenterLoginForm>();
  readonly testCenters = input.required<readonly Testcenter[]>();
  readonly authenticationError = input(false);
  readonly authenticationMessage = input('');
  readonly authenticating = input(false);
  readonly instancesError = input(false);
  readonly reloadInstances = output<void>();
  readonly submitted = output<void>();
  readonly serverSelected = output<number>();

  constructor() {
    effect(() => {
      const control = this.form().controls.testCenter;
      const pending = this.authenticating();
      untracked(() => {
        if (pending) control.disable({ emitEvent: false });
        else control.enable({ emitEvent: false });
      });
    });
  }
}
