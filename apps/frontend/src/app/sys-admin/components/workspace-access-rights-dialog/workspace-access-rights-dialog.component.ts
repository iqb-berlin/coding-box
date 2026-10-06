import {
  Component, inject, signal, ChangeDetectionStrategy
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatButton } from '@angular/material/button';
import {
  MatDialogContent, MatDialogActions, MatDialogClose, MAT_DIALOG_DATA
} from '@angular/material/dialog';
import { WorkspacesSelectionComponent } from '../workspaces-selection/workspaces-selection.component';
import { UserFullDto } from '../../../../../../../api-dto/user/user-full-dto';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';
import { WorkspaceInListDto } from '../../../../../../../api-dto/workspaces/workspace-in-list-dto';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-workspace-access-rights-dialog',
  templateUrl: './workspace-access-rights-dialog.component.html',
  styleUrls: ['./workspace-access-rights-dialog.component.scss'],
  imports: [MatDialogContent, MatDialogActions, MatButton, MatDialogClose, TranslateModule, WorkspacesSelectionComponent]
})

export class WorkspaceAccessRightsDialogComponent {
  data = inject<{
    selectedUser: UserFullDto[];
  }>(MAT_DIALOG_DATA);

  private userBackendService = inject(UserBackendService);

  readonly selectedWorkspacesIds = signal<number[]>([]);
  readonly isLoadingUserWorkspaces = signal(false);
  protected readonly workspaceListReady = signal(false);
  readonly userWorkspacesLoadingFailed = signal(false);
  readonly result = signal<number[]>([]);
  constructor() {
    if (this.data && this.data.selectedUser && Array.isArray(this.data.selectedUser) && this.data.selectedUser.length > 0) {
      this.isLoadingUserWorkspaces.set(true);
      this.userBackendService.getWorkspacesByUserListOrFail(this.data.selectedUser[0].id)
        .subscribe({
          next: workspaces => {
            this.selectedWorkspacesIds.set(workspaces || []);
            this.result.set([...this.selectedWorkspacesIds()]);
            this.isLoadingUserWorkspaces.set(false);
          },
          error: () => {
            this.selectedWorkspacesIds.set([]);
            this.result.set([]);
            this.userWorkspacesLoadingFailed.set(true);
            this.isLoadingUserWorkspaces.set(false);
          }
        });
    }
  }

  protected setWorkspacesSelection(result: WorkspaceInListDto[]): void {
    if (result && Array.isArray(result)) {
      this.result.set(result.map(workspace => workspace.id));
    } else {
      this.result.set([]);
    }
  }
}
