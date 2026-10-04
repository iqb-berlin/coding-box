import {
  MatTableDataSource
} from '@angular/material/table';
import {
  Component, DestroyRef, OnInit, inject, signal, ChangeDetectionStrategy
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, timer } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { SelectionModel } from '@angular/cdk/collections';
import { UsersSelectionComponent } from '../users-selection/users-selection.component';
import { UserFullDto } from '../../../../../../../api-dto/user/user-full-dto';
import { WorkspaceInListDto } from '../../../../../../../api-dto/workspaces/workspace-in-list-dto';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';
import { WorkspaceBackendService } from '../../../workspace/services/workspace-backend.service';
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
  private workspaceBackendService = inject(WorkspaceBackendService);
  private appService = inject(AppService);
  private snackBar = inject(MatSnackBar);
  private translateService = inject(TranslateService);

  readonly selectedUsers = signal<number[]>([]);
  readonly selectedRows = signal<UserFullDto[]>([]);
  userObjectsDatasource = new MatTableDataSource<UserFullDto>();
  tableSelectionRow = new SelectionModel<UserFullDto>(false, []);
  tableSelectionCheckboxes = new SelectionModel<UserFullDto>(true, []);
  readonly userWorkspaces = signal<WorkspaceInListDto[]>([]);

  readonly authData = signal(AppService.defaultAuthData);
  ngOnInit(): void {
    this.appService.authData$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(
      authData => {
        this.authData.set(authData);
      }
    );
    timer(0).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.createWorkspaceList();
      this.updateUserList();
    });
  }

  private setObjectsDatasource(users: UserFullDto[]): void {
    this.userObjectsDatasource = new MatTableDataSource(users);
    this.userObjectsDatasource
      .filterPredicate = (userList: UserFullDto, filter) => [
        'name', 'firstName', 'lastName'
      ].some(column => (userList[column as keyof UserFullDto] as string || '')
        .toLowerCase()
        .includes(filter));
  }

  updateUserList(): void {
    this.appService.dataLoading = true;
    this.userBackendService.getUsersFull().pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => { this.appService.dataLoading = false; })
    ).subscribe(
      (users: UserFullDto[]) => {
        if (users.length > 0) {
          this.setObjectsDatasource(users);
          this.tableSelectionCheckboxes.clear();
          this.tableSelectionRow.clear();
        } else {
          this.tableSelectionCheckboxes.clear();
          this.tableSelectionRow.clear();
        }
      }
    );
  }

  addUser(userData: CreateUserForm): void {
    this.appService.dataLoading = true;
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
    this.userBackendService.addUser(user).subscribe(
      respOk => {
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

  userSelectionChanged(userData: UserFullDto[]): void {
    this.selectedUsers.set(userData.map(user => user.id));
    this.selectedRows.set(userData);
  }

  editUser(value: { selection: UserFullDto[], user: EditUserForm }): void {
    this.appService.dataLoading = true;
    const changedData: UserFullDto = {
      id: value.selection[0].id,
      ...value.user.getRawValue()
    };
    this.userBackendService.changeUserData(this.authData().userId, changedData).subscribe(
      respOk => {
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

  deleteUsers(users: UserFullDto[]): void {
    this.appService.dataLoading = true;
    const usersToDelete: number[] = [];
    users.forEach((r: UserFullDto) => usersToDelete.push(r.id));
    this.userBackendService.deleteUsers(usersToDelete).subscribe(
      respOk => {
        if (respOk) {
          this.snackBar.open(
            this.translateService.instant('admin.users-deleted'),
            '',
            { duration: 1000 });
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
    )
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

  createWorkspaceList(): void {
    this.workspaceBackendService.getAllWorkspacesList().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(workspaces => {
      if (workspaces.data.length > 0) { this.userWorkspaces.set(workspaces.data); }
    });
  }
}
