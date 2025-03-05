import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatIcon } from '@angular/material/icon';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { WsRolesHeaderComponent } from '../roles-header/ws-roles-header.component';
import { WorkspaceUserToCheckCollection } from '../../models/workspace-users-to-check-collection.class';
import { WorkspaceUserChecked } from '../../models/workspace-user-checked.class';

@Component({
  selector: 'coding-box-ws-access-rights',
  templateUrl: './ws-access-rights.component.html',
  styleUrls: ['./ws-access-rights.component.scss'],
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [MatCheckbox, MatButton, MatTooltip, FormsModule, TranslateModule, MatIcon, WsRolesHeaderComponent]
})
export class WsAccessRightsComponent {
  workspaceUsers = new WorkspaceUserToCheckCollection([]);
  changed = false;

  constructor(
    private backendService: BackendService,
    public appService: AppService
  ) {
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
    this.changed = false;
    this.backendService.saveUsers(this.appService.selectedWorkspaceId, this.workspaceUsers.getChecks())
      .subscribe(() => {
      });
  }

  changeAccessLevel(checked: boolean, user: WorkspaceUserChecked, level: number): void {
    this.changed = true;
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
