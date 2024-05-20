import {
  // eslint-disable-next-line max-len
  MatTable,
  MatColumnDef,
  MatHeaderCellDef,
  MatHeaderCell,
  MatCellDef,
  MatCell,
  MatHeaderRowDef,
  MatHeaderRow,
  MatRowDef,
  MatRow,
  MatTableDataSource
} from '@angular/material/table';
import { ViewChild, Component, OnInit } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSort, MatSortHeader } from '@angular/material/sort';
import { FormsModule, UntypedFormGroup } from '@angular/forms';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { SelectionModel } from '@angular/cdk/collections';
import { JsonPipe } from '@angular/common';
import { UsersMenuComponent } from '../users-menu/users-menu.component';
import { HasSelectionValuePipe } from '../../pipes/hasSelectionValue.pipe';
import { IsSelectedPipe } from '../../pipes/isSelected.pipe';
import { IsAllSelectedPipe } from '../../pipes/isAllSelected.pipe';
import { WorkspacesComponent } from '../workspaces/workspaces.component';
import { IsSelectedIdPipe } from '../../pipes/isSelectedId.pipe';
import { WorkspacesSelectionComponent } from '../workspaces-selection/workspaces-selection.component';
import { UsersSelectionComponent } from '../users-selection/users-selection.component';
import { UserFullDto } from '../../../../../api-dto/user/user-full-dto';
import { WorkspaceInListDto } from '../../../../../api-dto/workspaces/workspace-in-list-dto';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { CreateUserDto } from '../../../../../api-dto/user/create-user-dto';
import { WrappedIconComponent } from '../../../shared/wrapped-icon/wrapped-icon.component';
import { SearchFilterComponent } from '../../../shared/search-filter/search-filter.component';

@Component({
  selector: 'coding-box-users',
  templateUrl: './users.component.html',
  styleUrls: ['./users.component.scss'],
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [MatTable, MatSort, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCheckbox, MatCellDef, MatCell, MatSortHeader, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow, MatButton, MatTooltip, WrappedIconComponent, FormsModule, TranslateModule, UsersMenuComponent, HasSelectionValuePipe, IsSelectedPipe, IsAllSelectedPipe, SearchFilterComponent, JsonPipe, WorkspacesComponent, IsSelectedIdPipe, WorkspacesSelectionComponent, UsersSelectionComponent]
})
export class UsersComponent implements OnInit {
  selectedUsers : number[] = [];
  selectedRows : UserFullDto[] = [];
  userObjectsDatasource = new MatTableDataSource<UserFullDto>();
  tableSelectionRow = new SelectionModel<UserFullDto>(false, []);
  tableSelectionCheckboxes = new SelectionModel<UserFullDto>(true, []);
  userWorkspaces :WorkspaceInListDto[] = [];
  filteredUserWorkspaces: WorkspaceInListDto[] = [];

  @ViewChild(MatSort) sort = new MatSort();

  constructor(
    private backendService: BackendService,
    private appService: AppService,
    private snackBar: MatSnackBar,
    private translateService: TranslateService
  ) {
  }

  ngOnInit(): void {
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
    const newPassword: string = value.user.get('password')?.value;
    const newName: string = value.user.get('name')?.value;
    const newFirstName: string = value.user.get('firstName')?.value;
    const newLastName: string = value.user.get('lastName')?.value;
    const newEmail: string = value.user.get('email')?.value;
    const newDescription: string = value.user.get('description')?.value;
    const newIsAdmin: boolean = value.user.get('isAdmin')?.value;
    const changedData: UserFullDto = { id: value.selection[0].id };
    if (newName !== value.selection[0].name) changedData.name = newName;
    if (newDescription !== value.selection[0].description) changedData.description = newDescription;
    if (newFirstName !== value.selection[0].firstName) changedData.firstName = newFirstName;
    if (newLastName !== value.selection[0].lastName) changedData.lastName = newLastName;
    if (newEmail !== value.selection[0].email) changedData.email = newEmail;
    if (newPassword) changedData.password = newPassword;
    if (newIsAdmin !== value.selection[0].isAdmin) changedData.isAdmin = newIsAdmin;
    this.backendService.changeUserData(changedData).subscribe(
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

  createWorkspaceList(): void {
    this.backendService.getAllWorkspacesList().subscribe(workspaces => {
      if (workspaces.length > 0) { this.userWorkspaces = workspaces; }
      console.log('Workspaces: ', this.userWorkspaces);
    });
  }
}
