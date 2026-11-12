import {
  Component, inject, signal, ChangeDetectionStrategy, DestroyRef
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { finalize } from 'rxjs';
import { viewRefreshEvents } from '../../../shared/utils/view-refresh';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';
import { AppService } from '../../../core/services/app.service';
import { WorkspaceUserToCheckCollection } from '../../models/workspace-users-to-check-collection.class';
import { WorkspaceUserChecked } from '../../models/workspace-user-checked.class';
import {
  hasCurrentAuthDataAfterMutation,
  runMutationAndRefreshAuthData
} from '../../../core/utils/auth-data-refresh';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-ws-access-rights',
  templateUrl: './ws-access-rights.component.html',
  styleUrls: ['./ws-access-rights.component.scss'],
  imports: [MatCheckbox, MatButton, MatTooltip, FormsModule, TranslateModule, MatIcon]
})
export class WsAccessRightsComponent {
  private readonly destroyRef = inject(DestroyRef);

  private userBackendService = inject(UserBackendService);
  appService = inject(AppService);
  private snackBar = inject(MatSnackBar);
  private translateService = inject(TranslateService);
  readonly workspaceUsers = signal(new WorkspaceUserToCheckCollection([]));
  protected readonly saving = signal(false);
  private refreshing = false;
  private rightsRevision = 0;

  constructor() {
    this.createUserList();
    viewRefreshEvents().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refreshUneditedUsers());
  }

  private refreshUneditedUsers(): void {
    if (this.refreshing || this.saving() || this.workspaceUsers().hasChanged) return;
    const workspaceId = this.appService.selectedWorkspaceId;
    const revision = this.rightsRevision;
    this.refreshing = true;
    this.userBackendService.getUsers(workspaceId, true).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => { this.refreshing = false; })
    ).subscribe({
      next: users => {
        if (workspaceId === this.appService.selectedWorkspaceId && revision === this.rightsRevision &&
          !this.workspaceUsers().hasChanged) {
          this.workspaceUsers.set(new WorkspaceUserToCheckCollection(users));
        }
      },
      error: () => { /* Retain the last successful list and any unsaved rights. */ }
    });
  }

  createUserList(): void {
    this.workspaceUsers.set(new WorkspaceUserToCheckCollection([]));
    this.refreshing = true;
    this.userBackendService.getUsers(this.appService.selectedWorkspaceId).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => { this.refreshing = false; })
    )
      .subscribe(users => {
        if (users.length > 0) {
          this.workspaceUsers.set(new WorkspaceUserToCheckCollection(users));
        }
      });
  }

  save(): void {
    if (this.saving()) return;
    this.rightsRevision += 1;
    const workspaceId = this.appService.selectedWorkspaceId;
    const collection = this.workspaceUsers();
    const checks = collection.getChecks();
    this.saving.set(true);
    runMutationAndRefreshAuthData(
      this.appService,
      this.userBackendService.saveUsers(workspaceId, checks)
    ).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.saving.set(false))
    )
      .subscribe(result => {
        if (result.mutationSucceeded && this.workspaceUsers() === collection &&
          this.appService.selectedWorkspaceId === workspaceId) {
          collection.acceptSavedChecks(checks);
        }
        if (hasCurrentAuthDataAfterMutation(result)) {
          this.snackBar.open(
            this.translateService.instant('admin.workspace-access-right-set'),
            '',
            { duration: 3000 }
          );
        } else if (result.mutationSucceeded && result.authDataRefreshOutcome === 'failed') {
          this.snackBar.open(
            this.translateService.instant('admin.change-saved-auth-data-refresh-failed'),
            this.translateService.instant('error.error_title'),
            { duration: 5000 }
          );
        } else if (!result.mutationSucceeded) {
          this.snackBar.open(
            this.translateService.instant('admin.workspace-access-right-not-set'),
            this.translateService.instant('error.error_title'),
            { duration: 3000 }
          );
        }
      });
  }

  changeAccessLevel(checked: boolean, user: Readonly<WorkspaceUserChecked>, level: number): void {
    this.rightsRevision += 1;
    this.workspaceUsers().updateEntry(user.id, current => (checked ? {
      ...current, accessLevel: level, isChecked: true
    } : {
      ...current, accessLevel: 0, isChecked: false, canCode: false
    }));
  }

  changeCanCode(checked: boolean, user: Readonly<WorkspaceUserChecked>): void {
    this.rightsRevision += 1;
    this.workspaceUsers().updateEntry(user.id, current => ({
      ...current,
      isChecked: checked || current.isChecked,
      accessLevel: checked && !current.isChecked ? 1 : current.accessLevel,
      canCode: checked
    }));
  }
}
