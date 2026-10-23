import {
  ChangeDetectionStrategy, Component, input, output
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TestGroupsInfoDto } from '../../../../../../../api-dto/files/test-groups-info.dto';

@Component({
  selector: 'coding-box-test-center-groups-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatCheckboxModule, MatTableModule, MatTooltipModule],
  templateUrl: './test-center-groups-step.component.html',
  styleUrls: ['./test-center-groups-step.component.scss'],
  host: { style: 'display: block' }
})
export class TestCenterGroupsStepComponent {
  readonly testGroups = input.required<TestGroupsInfoDto[]>();
  readonly selected = input.required<readonly TestGroupsInfoDto[]>();
  readonly columns = input.required<string[]>();
  readonly allSelected = input(false);
  readonly isUploadingTestResults = input(false);
  readonly resultStatusUncertain = input(false);
  readonly isConfirmingImport = input(false);
  readonly uploadError = input<string | null>(null);
  readonly back = output<void>();
  readonly groupToggled = output<TestGroupsInfoDto>();
  readonly allToggled = output<boolean>();
}
