import {
  Component, DestroyRef, OnInit, inject, signal, ChangeDetectionStrategy
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { UsersSelectionComponent } from '../users-selection/users-selection.component';
import { UserFullDto } from '../../../../../../../api-dto/user/user-full-dto';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';
import { AppService } from '../../../core/services/app.service';
import { CreateUserDto } from '../../../../../../../api-dto/user/create-user-dto';
import { CreateUserForm, EditUserForm } from '../../models/user-form.model';
import { UsersMenuComponent } from '../users-menu/users-menu.component';
import {
  hasCurrentAuthDataAfterMutation,
  runMutationAndRefreshAuthData
} from '../../../core/utils/auth-data-refresh';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-users',
  templateUrl: './users.component.html',
  styleUrls: ['./users.component.scss'],
  imports: [UsersSelectionComponent, UsersMenuComponent]
})
export class UsersComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private userBackendService = inject(UserBackendService);
  private appService = inject(AppService);
  private snackBar = inject(MatSnackBar);
  private translateService = inject(TranslateService);

  readonly selectedUsers = signal<number[]>([]);
  protected readonly selectedRows = signal<UserFullDto[]>([]);
  protected readonly usersRefreshVersion = signal(0);

  readonly authData = signal(AppService.defaultAuthData);
  ngOnInit(): void {
    this.appService.authData$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(
      authData => {
        this.authData.set(authData);
      }
    );
  }

  updateUserList(): void {
    this.usersRefreshVersion.update(version => version + 1);
    this.appService.dataLoading = false;
  }

  protected addUser(userData: CreateUserForm): void {
    this.appService.dataLoading = true;
    let refreshingUsers = false;
    const {
      name: username, isAdmin, firstName, lastName, email
    } = userData.getRawValue();
    const user: CreateUserDto = {
      username,
      isAdmin,
      firstName,
      lastName,
      email
    };
    this.userBackendService.addUser(user).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => { if (!refreshingUsers) this.appService.dataLoading = false; })
    ).subscribe(
      respOk => {
        refreshingUsers = true;
        this.updateUserList();
        if (respOk) {
          this.snackBar.open(
            this.translateService.instant('admin.user-created'),
            '',
            { duration: 1000 }
          );
        } else {
          this.snackBar.open(
            this.translateService.instant('admin.user-not-created'),
            this.translateService.instant('error'),
            { duration: 3000 });
        }
      }
    );
  }

  protected userSelectionChanged(userData: UserFullDto[]): void {
    this.selectedUsers.set(userData.map(user => user.id));
    this.selectedRows.set(userData);
  }

  editUser(value: { selection: UserFullDto[], user: EditUserForm }): void {
    this.appService.dataLoading = true;
    let refreshingUsers = false;
    const changedData: UserFullDto = {
      id: value.selection[0].id,
      ...value.user.getRawValue()
    };
    this.userBackendService.changeUserData(this.authData().userId, changedData).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => { if (!refreshingUsers) this.appService.dataLoading = false; })
    ).subscribe(
      respOk => {
        refreshingUsers = true;
        this.updateUserList();
        if (respOk) {
          this.snackBar.open(
            this.translateService.instant('admin.user-edited'),
            '',
            { duration: 1000 }
          );
        } else {
          this.snackBar.open(
            this.translateService.instant('admin.user-not-edited'),
            this.translateService.instant('error'),
            { duration: 3000 });
        }
      }
    );
  }

  protected deleteUsers(users: UserFullDto[]): void {
    this.appService.dataLoading = true;
    let refreshingUsers = false;
    const usersToDelete: number[] = [];
    users.forEach((r: UserFullDto) => usersToDelete.push(r.id));
    this.userBackendService.deleteUsers(usersToDelete).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => { if (!refreshingUsers) this.appService.dataLoading = false; })
    ).subscribe(
      respOk => {
        if (respOk) {
          this.snackBar.open(
            this.translateService.instant('admin.users-deleted'),
            '',
            { duration: 1000 });
          refreshingUsers = true;
          this.updateUserList();
        } else {
          this.snackBar.open(
            this.translateService.instant('admin.users-not-deleted'),
            this.translateService.instant('error'),
            { duration: 3000 });
          this.appService.dataLoading = false;
        }
      }
    );
  }

  setUserWorkspaceAccessRight(workspaces: number[]): void {
    runMutationAndRefreshAuthData(
      this.appService,
      this.userBackendService.setUserWorkspaceAccessRight(this.selectedUsers()[0], workspaces)
    ).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(
        result => {
          if (hasCurrentAuthDataAfterMutation(result)) {
            this.snackBar.open(
              this.translateService.instant('admin.workspace-access-right-set'),
              '',
              { duration: 1000 });
          } else if (result.mutationSucceeded && result.authDataRefreshOutcome === 'failed') {
            this.snackBar.open(
              this.translateService.instant('admin.change-saved-auth-data-refresh-failed'),
              this.translateService.instant('error'),
              { duration: 5000 });
          } else if (!result.mutationSucceeded) {
            this.snackBar.open(
              this.translateService.instant('admin.workspace-access-right-not-set'),
              this.translateService.instant('error'),
              { duration: 3000 });
          }
          this.appService.dataLoading = false;
        }
      );
  }
}
