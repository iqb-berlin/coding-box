import {
  Component, Inject
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import {
  MatDialogContent, MatDialogActions, MatDialogClose, MAT_DIALOG_DATA
} from '@angular/material/dialog';
import { JsonPipe } from '@angular/common';
import { WorkspacesSelectionComponent } from '../workspaces-selection/workspaces-selection.component';
import { UserFullDto } from '../../../../../../../api-dto/user/user-full-dto';
import { BackendService } from '../../../services/backend.service';
// eslint-disable-next-line import/no-cycle
import { UsersSelectionComponent } from '../users-selection/users-selection.component';

@Component({
  selector: 'coding-box-user-access-rights-dialog',
  templateUrl: './user-access-rights-dialog.component.html',
  styleUrls: ['./user-access-rights-dialog.component.scss'],
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [MatDialogContent, MatIcon, MatDialogActions, MatButton, MatDialogClose, TranslateModule, WorkspacesSelectionComponent, JsonPipe, UsersSelectionComponent]
})

export class UserAccessRightsDialogComponent {
  selectedUserIds!: number[];
  result: number[] = [];
  constructor(@Inject(MAT_DIALOG_DATA) public data: { selectedWorkspace: number[] },
              private backendService: BackendService) {
    if (this.data.selectedWorkspace?.length > 0) {
      this.backendService.getWorkspaceUsers(this.data.selectedWorkspace[0])
        .subscribe(users => {
          this.selectedUserIds = users.map(user => user.userId);
        });
    }
  }

  setUsersSelection(result: UserFullDto[]): void {
    this.result = result.map(workspace => workspace.id);
  }
}
