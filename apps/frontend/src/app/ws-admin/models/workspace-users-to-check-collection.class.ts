import { signal } from '@angular/core';
import { WorkspaceUserChecked } from './workspace-user-checked.class';
import { UserInListDto } from '../../../../../../api-dto/user/user-in-list-dto';
import { UserWorkspaceAccessDto } from '../../../../../../api-dto/workspaces/user-workspace-access-dto';
import { WorkspaceUserInListDto } from '../../../../../../api-dto/user/workspace-user-in-list-dto';
import { getEffectiveCanCode } from '../../shared/utils/workspace-access';

export class WorkspaceUserToCheckCollection {
  private readonly entriesState = signal<readonly Readonly<WorkspaceUserChecked>[]>([]);
  private readonly workspacesUsersIds = signal<readonly Readonly<UserWorkspaceAccessDto>[]>([]);
  private readonly hasChangedState = signal(false);

  get hasChanged(): boolean {
    return this.hasChangedState();
  }

  get entries(): readonly Readonly<WorkspaceUserChecked>[] {
    return this.entriesState();
  }

  constructor(users: UserInListDto[]) {
    this.entriesState.set(users.map(user => new WorkspaceUserChecked(user)));
    this.setHasChangedFalse();
  }

  updateEntry(
    userId: number,
    update: (user: Readonly<WorkspaceUserChecked>) => Readonly<WorkspaceUserChecked>
  ): void {
    this.entriesState.update(entries => entries.map(user => (user.id === userId ? update(user) : user)));
    this.updateHasChanged();
  }

  setChecks(workspaceUsers?: WorkspaceUserInListDto[]): void {
    const baseline = (workspaceUsers || []).map(user => ({
      id: user.id,
      accessLevel: user.accessLevel,
      canCode: getEffectiveCanCode(user)
    }));
    this.workspacesUsersIds.set(baseline);
    this.entriesState.set(this.entries.map(user => {
      const workspaceUser = baseline
        .find(workspacesUsersId => user.id === workspacesUsersId.id);
      if (workspaceUser) {
        return {
          ...user,
          isChecked: true,
          accessLevel: workspaceUser.accessLevel,
          canCode: getEffectiveCanCode(workspaceUser)
        };
      }
      return {
        ...user, isChecked: false, accessLevel: 0, canCode: false
      };
    }));
    this.hasChangedState.set(false);
  }

  getChecks(): UserWorkspaceAccessDto[] {
    const checkedUserIds: UserWorkspaceAccessDto[] = [];
    this.entries.forEach(user => {
      const workspaceUser = this.workspacesUsersIds()
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
    const hasChanged = this.entries.some(user => {
      const workspaceUser = this.workspacesUsersIds()
        .find(workspacesUsersId => user.id === workspacesUsersId.id);
      return (user.isChecked && !workspaceUser) || (!user.isChecked && !!workspaceUser) ||
        (!!workspaceUser && (user.accessLevel !== workspaceUser.accessLevel || user.canCode !== workspaceUser.canCode));
    });
    this.hasChangedState.set(hasChanged);
  }

  setHasChangedFalse(): void {
    this.workspacesUsersIds.set(this.entries.filter(user => user.isChecked).map(user => ({
      id: user.id,
      accessLevel: user.accessLevel,
      canCode: user.canCode
    })));
    this.hasChangedState.set(false);
  }
}
