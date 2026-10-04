import {
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
import {
  Component, DestroyRef, OnInit, inject, output, signal, viewChild, effect, ChangeDetectionStrategy
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, timer } from 'rxjs';
import { MatSort, MatSortHeader } from '@angular/material/sort';
import { FormsModule } from '@angular/forms';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { SelectionModel } from '@angular/cdk/collections';
import { MatDialog } from '@angular/material/dialog';
import { WorkspaceInListDto } from '../../../../../../../api-dto/workspaces/workspace-in-list-dto';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';
import { WorkspaceBackendService } from '../../../workspace/services/workspace-backend.service';
import { AppService } from '../../../core/services/app.service';
import { UserFullDto } from '../../../../../../../api-dto/user/user-full-dto';
import { WrappedIconComponent } from '../../../shared/wrapped-icon/wrapped-icon.component';
import { HasSelectionValuePipe } from '../../../shared/pipes/hasSelectionValue.pipe';
import { IsSelectedPipe } from '../../../shared/pipes/isSelected.pipe';
import { IsAllSelectedPipe } from '../../../shared/pipes/isAllSelected.pipe';
import { SearchFilterComponent } from '../../../shared/search-filter/search-filter.component';
import { MessageDialogComponent, MessageDialogData, MessageType } from '../../../shared/dialogs/message-dialog.component';
import { EditUserComponent, EditUserData } from '../../../sys-admin/components/edit-user/edit-user.component';
import { EditUserForm } from '../../../sys-admin/models/user-form.model';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/dialogs/confirm-dialog.component';
import {
  WorkspaceAccessRightsDialogComponent
} from '../../../sys-admin/components/workspace-access-rights-dialog/workspace-access-rights-dialog.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-ws-users',
  templateUrl: './ws-users.component.html',
  styleUrls: ['./ws-users.component.scss'],
  imports: [MatTable, MatSort, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCheckbox, MatCellDef, MatCell, MatSortHeader, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow, MatButton, MatTooltip, WrappedIconComponent, FormsModule, TranslateModule, HasSelectionValuePipe, IsSelectedPipe, IsAllSelectedPipe, SearchFilterComponent]
})
export class WsUsersComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private userBackendService = inject(UserBackendService);
  private workspaceBackendService = inject(WorkspaceBackendService);
  private appService = inject(AppService);
  private editUserDialog = inject(MatDialog);
  private messageDialog = inject(MatDialog);
  private editUserWorkspaceAccessRightDialog = inject(MatDialog);
  private deleteConfirmDialog = inject(MatDialog);
  private translateService = inject(TranslateService);

  selectedUsers: number[] = [];
  readonly userObjectsDatasource = signal(new MatTableDataSource<UserFullDto>());
  displayedUserColumns = ['selectCheckbox', 'name', 'displayName'];
  tableSelectionRow = new SelectionModel<UserFullDto>(false, []);
  tableSelectionCheckboxes = new SelectionModel<UserFullDto>(true, []);
  userWorkspaces: WorkspaceInListDto[] = [];
  filteredUserWorkspaces: WorkspaceInListDto[] = [];
  selectedUser: number[] = [];
  selectedRows!: UserFullDto[];
  checkedRows!: UserFullDto[];
  readonly sort = viewChild(MatSort);
  private readonly synchronizeSort = effect(() => {
    this.userObjectsDatasource().sort = this.sort() ?? null;
  });

  readonly userSelectionChanged = output<UserFullDto[]>();

  ngOnInit(): void {
    timer(0).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.createWorkspaceList();
      this.updateUserList();
    });
  }

  private setObjectsDatasource(users: UserFullDto[]): void {
    const datasource = new MatTableDataSource(users);
    datasource
      .filterPredicate = (userList: UserFullDto, filter) => [
        'name', 'firstName', 'lastName'
      ].some(column => (userList[column as keyof UserFullDto] as string || '')
        .toLowerCase()
        .includes(filter));
    datasource.sort = this.sort() ?? null;
    this.userObjectsDatasource.set(datasource);
  }

  updateUserList(): void {
    this.appService.dataLoading = true;
    this.userBackendService.getUsersFull().pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => { this.appService.dataLoading = false; })
    ).subscribe(
      (users: UserFullDto[]) => {
        this.setObjectsDatasource(users);
        this.tableSelectionCheckboxes.clear();
        this.tableSelectionRow.clear();
      }
    );
  }

  createWorkspaceList(): void {
    this.workspaceBackendService.getAllWorkspacesList().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(workspaces => {
      if (workspaces.data.length > 0) { this.userWorkspaces = workspaces.data; }
    });
  }

  checkboxToggle(row: UserFullDto): void {
    this.tableSelectionCheckboxes.toggle(row);
    this.updateUserWorkspacesList(row.id);
    this.userSelectionChanged.emit(this.tableSelectionCheckboxes.selected);
  }

  updateUserWorkspacesList(userId: number): void {
    if (this.tableSelectionCheckboxes.selected.length === 1) {
      this.userBackendService.getWorkspacesByUserList(userId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(workspaces => {
        this.filteredUserWorkspaces = this.userWorkspaces.filter(workspace => workspaces.includes(workspace.id));
      });
    }
  }

  private isAllSelected(): boolean {
    const numSelected = this.tableSelectionCheckboxes.selected.length;
    const numRows = this.userObjectsDatasource().data.length;
    return numSelected === numRows;
  }

  masterToggle(): void {
    this.isAllSelected() ?
      this.tableSelectionCheckboxes.clear() :
      this.userObjectsDatasource().data.forEach(row => this.tableSelectionCheckboxes.select(row));
    this.userSelectionChanged.emit(this.tableSelectionCheckboxes.selected);
  }

  editUser(): void {
    let selectedRows = this.selectedRows;
    if (!selectedRows.length) {
      selectedRows = this.checkedRows;
    }
    if (!selectedRows.length) {
      this.messageDialog.open(MessageDialogComponent, {
        width: '400px',
        data: <MessageDialogData>{
          title: this.translateService.instant('admin.edit-user-data'),
          content: this.translateService.instant('admin.select-user'),
          type: MessageType.error
        }
      });
    } else {
      this.editUserDialog.open<EditUserComponent, EditUserData, EditUserForm | false>(EditUserComponent, {
        width: '600px',
        data: {
          username: selectedRows[0].username,
          isAdmin: selectedRows[0].isAdmin
        }
      });
    }
  }

  deleteUsers(): void {
    let selectedRows = this.selectedRows;
    if (!selectedRows.length) {
      selectedRows = this.checkedRows;
    }
    if (!selectedRows.length) {
      this.messageDialog.open(MessageDialogComponent, {
        width: '400px',
        data: <MessageDialogData>{
          title: this.translateService.instant('admin.delete-users-title'),
          content: this.translateService.instant('admin.select-user'),
          type: MessageType.error
        }
      });
    } else {
      const content = (selectedRows.length === 1) ?
        this.translateService.instant('admin.delete-user', { name: selectedRows[0].username }) :
        this.translateService.instant('admin.delete-users', { count: selectedRows.length });
      const dialogRef = this.deleteConfirmDialog.open(ConfirmDialogComponent, {
        width: '400px',
        data: <ConfirmDialogData>{
          title: this.translateService.instant('admin.delete-users-title'),
          content: content,
          confirmButtonLabel: this.translateService.instant('delete'),
          showCancel: true
        }
      });

      dialogRef.afterClosed().subscribe((result: boolean) => {
        if (result) {
          // this.usersDeleted.emit(selectedRows);
        }
      });
    }
  }

  setUserWorkspaceAccessRight(): void {
    let selectedRows = this.selectedRows;
    if (!selectedRows.length) {
      selectedRows = this.checkedRows;
    }
    if (!selectedRows.length) {
      this.messageDialog.open(MessageDialogComponent, {
        width: '400px',
        data: <MessageDialogData>{
          title: this.translateService.instant('admin.set-user-access-rights'),
          content: this.translateService.instant('admin.select-user'),
          type: MessageType.error
        }
      });
    } else {
      this.editUserWorkspaceAccessRightDialog.open(WorkspaceAccessRightsDialogComponent, {
        width: '600px',
        minHeight: '600px',
        data: {
          selectedUser: this.selectedRows
        }
      });
      // dialogRef.afterClosed().subscribe((result: number[]) => {
      //   this.setUserWorkspaceAccessRights.emit(result);
      // });
    }
  }
}
