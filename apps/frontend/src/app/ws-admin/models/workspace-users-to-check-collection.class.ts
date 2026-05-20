import { WorkspaceUserChecked } from './workspace-user-checked.class';
import { UserInListDto } from '../../../../../../api-dto/user/user-in-list-dto';
import { UserWorkspaceAccessDto } from '../../../../../../api-dto/workspaces/user-workspace-access-dto';
import { WorkspaceUserInListDto } from '../../../../../../api-dto/user/workspace-user-in-list-dto';
import { getEffectiveCanCode } from '../../shared/utils/workspace-access';

export class WorkspaceUserToCheckCollection {
  entries: WorkspaceUserChecked[];
  private workspacesUsersIds: UserWorkspaceAccessDto[] = [];
  hasChanged = false;

  constructor(users: UserInListDto[]) {
    this.entries = [];
    users.forEach(user => {
      const checkedUser = new WorkspaceUserChecked(user);
      this.entries.push(checkedUser);
      if (checkedUser.isChecked) {
        this.workspacesUsersIds.push({
          id: checkedUser.id,
          accessLevel: checkedUser.accessLevel,
          canCode: checkedUser.canCode
        });
      }
    });
  }

  setChecks(workspaceUsers?: WorkspaceUserInListDto[]): void {
    this.workspacesUsersIds = [];
    if (workspaceUsers) {
      workspaceUsers.forEach(u => this.workspacesUsersIds.push(
        {
          id: u.id,
          accessLevel: u.accessLevel,
          canCode: getEffectiveCanCode(u)
        }));
    }
    this.entries.forEach(user => {
      const workspaceUser = this.workspacesUsersIds
        .find(workspacesUsersId => user.id === workspacesUsersId.id);
      if (workspaceUser) {
        user.isChecked = true;
        user.accessLevel = workspaceUser.accessLevel;
        user.canCode = getEffectiveCanCode(workspaceUser);
      } else {
        user.isChecked = false;
        user.accessLevel = 0;
        user.canCode = false;
      }
    });
    this.hasChanged = false;
  }

  getChecks(): UserWorkspaceAccessDto[] {
    const checkedUserIds: UserWorkspaceAccessDto[] = [];
    this.entries.forEach(user => {
      const workspaceUser = this.workspacesUsersIds
        .find(workspacesUsersId => user.id === workspacesUsersId.id);
      if (user.isChecked || workspaceUser) {
        checkedUserIds.push(
          {
            id: user.id,
            accessLevel: user.isChecked ? user.accessLevel : 0,
            canCode: user.isChecked ? user.canCode : false
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
      if (workspaceUser && user.canCode !== workspaceUser.canCode) {
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
          accessLevel: user.accessLevel,
          canCode: user.canCode
        });
      }
    });
    this.hasChanged = false;
  }
}
