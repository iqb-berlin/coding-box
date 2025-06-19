import { Component, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatButton } from '@angular/material/button';
import {
  MatDialogContent, MatDialogActions, MatDialogClose, MAT_DIALOG_DATA
} from '@angular/material/dialog';
import { UserFullDto } from '../../../../../../../api-dto/user/user-full-dto';
import { BackendService } from '../../../services/backend.service';
import { UsersSelectionComponent } from '../users-selection/users-selection.component';

@Component({
  selector: 'coding-box-user-access-rights-dialog',
  templateUrl: './user-access-rights-dialog.component.html',
  styleUrls: ['./user-access-rights-dialog.component.scss'],
  imports: [
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatDialogClose,
    TranslateModule,
    UsersSelectionComponent
  ]
})

export class UserAccessRightsDialogComponent {
  data = inject<{
    selectedWorkspace: number[];
  }>(MAT_DIALOG_DATA);

  private backendService = inject(BackendService);

  selectedUserIds!: number[];
  result: number[] = [];
  constructor() {
    if (this.data.selectedWorkspace?.length > 0) {
      this.backendService.getWorkspaceUsers(this.data.selectedWorkspace[0])
        .subscribe(users => {
          if (Array.isArray(users.data)) {
            this.selectedUserIds = users.data.map((user:any) => user.userId);
          }
        });
    }
  }

  setUsersSelection(result: UserFullDto[]): void {
    this.result = result.map(workspace => workspace.id);
  }
}
