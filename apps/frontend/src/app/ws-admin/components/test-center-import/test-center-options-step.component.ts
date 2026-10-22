import {
  ChangeDetectionStrategy, Component, input, output
} from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { TestCenterImportForm } from './test-center-import-form';
import { WorkspaceAdmin } from '../../../shared/models/test-center-authentication.model';

@Component({
  selector: 'coding-box-test-center-options-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, TranslateModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatSelectModule, MatCheckboxModule],
  templateUrl: './test-center-options-step.component.html',
  styleUrls: ['./test-center-options-step.component.scss'],
  host: { style: 'display: block' }
})
export class TestCenterOptionsStepComponent {
  readonly form = input.required<TestCenterImportForm>();
  readonly importType = input.required<string>();
  readonly workspaces = input.required<readonly WorkspaceAdmin[]>();
  readonly isLoadingTestGroups = input(false);
  readonly isUploadingTestFiles = input(false);
  readonly isUploadingTestResults = input(false);
  readonly filesSelectionError = input(false);
  readonly testGroupsLoadError = input<string | null>(null);
  readonly uploadError = input<string | null>(null);
  readonly authenticationError = input(false);
  readonly submitted = output<void>();
  readonly selectAll = output<void>();
  readonly clearSelection = output<void>();
}
