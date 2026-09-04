import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';
import { AppService } from '../../../core/services/app.service';
import { WorkspaceUserToCheckCollection } from '../../models/workspace-users-to-check-collection.class';
import { WorkspaceUserChecked } from '../../models/workspace-user-checked.class';
import {
  hasCurrentAuthDataAfterMutation,
  runMutationAndRefreshAuthData
} from '../../../core/utils/auth-data-refresh';

@Component({
  selector: 'coding-box-ws-access-rights',
  templateUrl: './ws-access-rights.component.html',
  styleUrls: ['./ws-access-rights.component.scss'],
  imports: [MatCheckbox, MatButton, MatTooltip, FormsModule, TranslateModule, MatIcon]
})
export class WsAccessRightsComponent {
  private userBackendService = inject(UserBackendService);
  appService = inject(AppService);
  private snackBar = inject(MatSnackBar);
  private translateService = inject(TranslateService);
  workspaceUsers = new WorkspaceUserToCheckCollection([]);

  constructor() {
    this.createUserList();
  }

  createUserList(): void {
    this.workspaceUsers = new WorkspaceUserToCheckCollection([]);
    this.userBackendService.getUsers(this.appService.selectedWorkspaceId)
      .subscribe(users => {
        if (users.length > 0) {
          this.workspaceUsers = new WorkspaceUserToCheckCollection(users);
        }
      });
  }

  save(): void {
    runMutationAndRefreshAuthData(
      this.appService,
      this.userBackendService.saveUsers(this.appService.selectedWorkspaceId, this.workspaceUsers.getChecks())
    )
      .subscribe(result => {
        if (hasCurrentAuthDataAfterMutation(result)) {
          this.snackBar.open(
            this.translateService.instant('admin.workspace-access-right-set'),
            '',
            { duration: 3000 }
          );
          this.workspaceUsers.setHasChangedFalse();
        } else if (result.mutationSucceeded && result.authDataRefreshOutcome === 'failed') {
          this.snackBar.open(
            this.translateService.instant('admin.change-saved-auth-data-refresh-failed'),
            this.translateService.instant('error'),
            { duration: 5000 }
          );
          this.workspaceUsers.setHasChangedFalse();
        } else if (result.mutationSucceeded) {
          this.workspaceUsers.setHasChangedFalse();
        } else {
          this.snackBar.open(
            this.translateService.instant('admin.workspace-access-right-not-set'),
            this.translateService.instant('error'),
            { duration: 3000 }
          );
        }
      });
  }

  changeAccessLevel(checked: boolean, user: WorkspaceUserChecked, level: number): void {
    if (checked) {
      user.accessLevel = level;
      user.isChecked = true;
    } else {
      user.accessLevel = 0;
      user.isChecked = false;
      user.canCode = false;
    }
    this.workspaceUsers.updateHasChanged();
  }

  changeCanCode(checked: boolean, user: WorkspaceUserChecked): void {
    if (checked && !user.isChecked) {
      user.isChecked = true;
      user.accessLevel = 1;
    }
    user.canCode = checked && user.isChecked;
    this.workspaceUsers.updateHasChanged();
  }
}
