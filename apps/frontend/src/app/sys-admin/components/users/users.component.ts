import {
  MatTableDataSource
} from '@angular/material/table';
import { ViewChild, Component, OnInit } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSort } from '@angular/material/sort';
import { UntypedFormGroup } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';
import { SelectionModel } from '@angular/cdk/collections';
import { UsersSelectionComponent } from '../users-selection/users-selection.component';
import { UserFullDto } from '../../../../../../../api-dto/user/user-full-dto';
import { WorkspaceInListDto } from '../../../../../../../api-dto/workspaces/workspace-in-list-dto';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { CreateUserDto } from '../../../../../../../api-dto/user/create-user-dto';
import { UsersMenuComponent } from '../users-menu/users-menu.component';

@Component({
  selector: 'coding-box-users',
  templateUrl: './users.component.html',
  styleUrls: ['./users.component.scss'],
  // eslint-disable-next-line max-len
  imports: [UsersSelectionComponent, UsersMenuComponent]
})
export class UsersComponent implements OnInit {
  selectedUsers : number[] = [];
  selectedRows : UserFullDto[] = [];
  userObjectsDatasource = new MatTableDataSource<UserFullDto>();
  tableSelectionRow = new SelectionModel<UserFullDto>(false, []);
  tableSelectionCheckboxes = new SelectionModel<UserFullDto>(true, []);
  userWorkspaces :WorkspaceInListDto[] = [];

  @ViewChild(MatSort) sort = new MatSort();

  constructor(
    private backendService: BackendService,
    private appService: AppService,
    private snackBar: MatSnackBar,
    private translateService: TranslateService
  ) {
  }

  authData = AppService.defaultAuthData;
  ngOnInit(): void {
    this.appService.authData$.subscribe(
      authData => {
        this.authData = authData;
      }
    );
    setTimeout(() => {
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
    this.userObjectsDatasource.sort = this.sort;
  }

  updateUserList(): void {
    this.appService.dataLoading = true;
    this.backendService.getUsersFull().subscribe(
      (users: UserFullDto[]) => {
        if (users.length > 0) {
          this.setObjectsDatasource(users);
          this.tableSelectionCheckboxes.clear();
          this.tableSelectionRow.clear();
          this.appService.dataLoading = false;
        } else {
          this.tableSelectionCheckboxes.clear();
          this.tableSelectionRow.clear();
          this.appService.dataLoading = false;
        }
      }
    );
  }

  addUser(userData: UntypedFormGroup): void {
    this.appService.dataLoading = true;
    const user: CreateUserDto = {
      username: userData.get('name')?.value,
      isAdmin: userData.get('isAdmin')?.value,
      firstName: userData.get('firstName')?.value,
      lastName: userData.get('lastName')?.value,
      email: userData.get('email')?.value
    };
    this.backendService.addUser(user).subscribe(
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
    this.selectedUsers = userData.map(user => user.id);
    this.selectedRows = userData;
  }

  editUser(value: { selection: UserFullDto[], user: UntypedFormGroup }): void {
    this.appService.dataLoading = true;
    const changedData: UserFullDto = {
      id: value.selection[0].id,
      username: value.user.get('username')?.value,
      isAdmin: value.user.get('isAdmin')?.value
    };
    this.backendService.changeUserData(this.authData.userId, changedData).subscribe(
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
    this.backendService.deleteUsers(usersToDelete).subscribe(
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
    this.backendService.setUserWorkspaceAccessRight(this.selectedUsers[0], workspaces).subscribe(
      respOk => {
        if (respOk) {
          this.snackBar.open(
            this.translateService.instant('admin.workspace-access-right-set'),
            '',
            { duration: 1000 });
        } else {
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
    this.backendService.getAllWorkspacesList().subscribe(workspaces => {
      if (workspaces.length > 0) { this.userWorkspaces = workspaces; }
    });
  }
}
