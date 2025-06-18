import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { WorkspaceUserToCheckCollection } from '../../models/workspace-users-to-check-collection.class';
import { WorkspaceUserChecked } from '../../models/workspace-user-checked.class';

@Component({
  selector: 'coding-box-ws-access-rights',
  templateUrl: './ws-access-rights.component.html',
  styleUrls: ['./ws-access-rights.component.scss'],
  imports: [MatCheckbox, MatButton, MatTooltip, FormsModule, TranslateModule, MatIcon]
})
export class WsAccessRightsComponent {
  private backendService = inject(BackendService);
  appService = inject(AppService);
  private snackBar = inject(MatSnackBar);
  workspaceUsers = new WorkspaceUserToCheckCollection([]);

  constructor() {
    this.createUserList();
  }

  createUserList(): void {
    this.workspaceUsers = new WorkspaceUserToCheckCollection([]);
    this.backendService.getUsers(this.appService.selectedWorkspaceId)
      .subscribe(users => {
        if (users.length > 0) {
          this.workspaceUsers = new WorkspaceUserToCheckCollection(users);
        }
      });
  }

  save(): void {
    this.backendService.saveUsers(this.appService.selectedWorkspaceId, this.workspaceUsers.getChecks())
      .subscribe(() => {
        this.snackBar.open('Zugriffsrechte erfolgreich gespeichert', 'Schließen', { duration: 3000 });
        this.workspaceUsers.setHasChangedFalse();
      });
  }

  changeAccessLevel(checked: boolean, user: WorkspaceUserChecked, level: number): void {
    if (checked) {
      user.accessLevel = level;
      user.isChecked = true;
    } else {
      user.accessLevel = 0;
      user.isChecked = false;
    }
    this.workspaceUsers.updateHasChanged();
  }
}
