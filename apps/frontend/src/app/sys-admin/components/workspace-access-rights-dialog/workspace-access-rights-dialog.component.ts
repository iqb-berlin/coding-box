import { Component, inject } from '@angular/core';
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

  selectedWorkspacesIds!: number[];
  result: number[] = [];
  constructor() {
    if (this.data && this.data.selectedUser && Array.isArray(this.data.selectedUser) && this.data.selectedUser.length > 0) {
      this.userBackendService.getWorkspacesByUserList(this.data.selectedUser[0].id).subscribe(workspaces => {
        this.selectedWorkspacesIds = workspaces || [];
      });
    }
  }

  setWorkspacesSelection(result: WorkspaceInListDto[]): void {
    if (result && Array.isArray(result)) {
      this.result = result.map(workspace => workspace.id);
    } else {
      this.result = [];
    }
  }
}
