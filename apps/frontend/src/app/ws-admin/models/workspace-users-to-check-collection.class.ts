import { WorkspaceUserChecked } from './workspace-user-checked.class';
import { UserInListDto } from '../../../../../../api-dto/user/user-in-list-dto';
import { UserWorkspaceAccessDto } from '../../../../../../api-dto/workspaces/user-workspace-access-dto';
import { WorkspaceUserInListDto } from '../../../../../../api-dto/user/workspace-user-in-list-dto';

export class WorkspaceUserToCheckCollection {
  entries: WorkspaceUserChecked[];
  private workspacesUsersIds: UserWorkspaceAccessDto[] = [];
  hasChanged = false;

  constructor(users: UserInListDto[]) {
    this.entries = [];
    users.forEach(user => {
      this.entries.push(new WorkspaceUserChecked(user));
    });
  }

  setChecks(workspaceUsers?: WorkspaceUserInListDto[]): void {
    this.workspacesUsersIds = [];
    if (workspaceUsers) {
      workspaceUsers.forEach(u => this.workspacesUsersIds.push(
        {
          id: u.id,
          accessLevel: u.accessLevel
        }));
    }
    this.entries.forEach(user => {
      const workspaceUser = this.workspacesUsersIds
        .find(workspacesUsersId => user.id === workspacesUsersId.id);
      if (workspaceUser) {
        user.isChecked = true;
        user.accessLevel = workspaceUser.accessLevel;
      } else {
        user.isChecked = false;
        user.accessLevel = 0;
      }
    });
    this.hasChanged = false;
  }

  getChecks(): UserWorkspaceAccessDto[] {
    const checkedUserIds: UserWorkspaceAccessDto[] = [];
    this.entries.forEach(user => {
      if (user.isChecked) {
        checkedUserIds.push(
          {
            id: user.id,
            accessLevel: user.accessLevel
          });
      }
    });
    return checkedUserIds;
  }

  updateHasChanged(): void {
    this.hasChanged = false;
    this.entries.forEach(user => {
      const workspaceUser = this.workspacesUsersIds
        .find(workspacesUsersId => user.id === workspacesUsersId.id);
      if ((user.isChecked && !workspaceUser) || (!user.isChecked && workspaceUser)) {
        this.hasChanged = true;
      }
      if (workspaceUser && user.accessLevel !== workspaceUser.accessLevel) {
        this.hasChanged = true;
      }
    });
  }

  setHasChangedFalse(): void {
    this.workspacesUsersIds = [];
    this.entries.forEach(user => {
      if (user.isChecked) {
        this.workspacesUsersIds.push({
          id: user.id,
          accessLevel: user.accessLevel
        });
      }
    });
    this.hasChanged = false;
  }
}
