import {
  ChangeDetectionStrategy, Component, input, output
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ImportWorkspaceFilesProgressDto, ImportWorkspaceOptionKey } from '../../../../../../../api-dto/files/import-workspace-progress.dto';
import { TestGroupsLoadProgressDto } from '../../../../../../../api-dto/files/test-groups-load-progress.dto';

@Component({
  selector: 'coding-box-test-center-import-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatProgressBarModule],
  templateUrl: './test-center-import-progress.component.html',
  styleUrls: ['./test-center-import-progress.component.scss'],
  host: { style: 'display: block' }
})
export class TestCenterImportProgressComponent {
  readonly view = input.required<TestCenterImportProgressView>();
  readonly phase = input.required<'options' | 'groups'>();
  readonly checkStatus = output<void>();
}

export interface TestCenterImportProgressView {
  loadingGroups: boolean;
  uploadingResults: boolean;
  uploadingFiles: boolean;
  groupsProgress: TestGroupsLoadProgressDto | null;
  groupsElapsedSeconds: number;
  groupsMessage: string;
  groupsPercent: number;
  groupsElapsedText: string;
  progress: ImportWorkspaceFilesProgressDto | null;
  total: number;
  completed: number;
  uploadPercent: number;
  importPercent: number;
  message: string;
  elapsedSeconds: number;
  failedGroup: string | null;
  uncertain: boolean;
  completedGroups: string[];
  importingGroups: string[];
  responsesSaved: boolean;
  checkingStatus: boolean;
  runId: string | null;
  options: NonNullable<ImportWorkspaceFilesProgressDto['options']>;
  optionLabels: Record<ImportWorkspaceOptionKey, string>;
}
