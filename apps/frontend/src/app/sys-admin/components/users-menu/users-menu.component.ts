import {
  Component, inject,
  input,
  output, ChangeDetectionStrategy, DestroyRef
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatButton } from '@angular/material/button';
import { EditUserComponent, EditUserData } from '../edit-user/edit-user.component';
import { CreateUserForm, EditUserForm } from '../../models/user-form.model';

import {
  WorkspaceAccessRightsDialogComponent
} from '../workspace-access-rights-dialog/workspace-access-rights-dialog.component';
import { WrappedIconComponent } from '../../../shared/wrapped-icon/wrapped-icon.component';
import { UserFullDto } from '../../../../../../../api-dto/user/user-full-dto';
import {
  MessageDialogComponent,
  MessageDialogData, MessageType
} from '../../../shared/dialogs/message-dialog.component';
import {
  ConfirmDialogComponent,
  ConfirmDialogData
} from '../../../shared/dialogs/confirm-dialog.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-users-menu',
  templateUrl: './users-menu.component.html',
  styleUrls: ['./users-menu.component.scss'],
  imports: [MatButton, MatTooltip, WrappedIconComponent, TranslateModule, WrappedIconComponent]
})
export class UsersMenuComponent {
  private readonly destroyRef = inject(DestroyRef);

  private editUserDialog = inject(MatDialog);
  private messageDialog = inject(MatDialog);
  private editUserAccessRightsDialog = inject(MatDialog);
  private deleteConfirmDialog = inject(MatDialog);
  private translateService = inject(TranslateService);

  readonly selectedUser = input.required<number[]>();
  readonly selectedRows = input.required<UserFullDto[]>();
  readonly checkedRows = input.required<UserFullDto[]>();
  readonly userAdded = output<CreateUserForm>();
  readonly usersDeleted = output<UserFullDto[]>();
  readonly userEdited = output<{
    selection: UserFullDto[];
    user: EditUserForm;
  }>();

  readonly setUserWorkspaceAccessRights = output<number[]>();

  protected editUser(): void {
    let selectedRows = this.selectedRows();
    if (!selectedRows.length) {
      selectedRows = this.checkedRows();
    }
    if (!selectedRows?.length) {
      this.messageDialog.open(MessageDialogComponent, {
        width: '400px',
        data: <MessageDialogData>{
          title: this.translateService.instant('admin.edit-user-data'),
          content: this.translateService.instant('admin.select-user'),
          type: MessageType.error
        }
      });
    } else {
      const dialogRef = this.editUserDialog.open<EditUserComponent, EditUserData, EditUserForm | false>(EditUserComponent, {
        width: '600px',
        data: {
          username: selectedRows[0].username,
          isAdmin: selectedRows[0].isAdmin
        }
      });

      dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(result => {
        if (result) {
          this.userEdited.emit({ selection: selectedRows, user: result });
        }
      });
    }
  }

  protected deleteUsers(): void {
    let selectedRows = this.selectedRows();
    if (!selectedRows.length) {
      selectedRows = this.checkedRows();
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

      dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result: boolean) => {
        if (result) {
          this.usersDeleted.emit(selectedRows);
        }
      });
    }
  }

  protected setUserWorkspaceAccessRight(): void {
    let selectedRows = this.selectedRows();
    if (!selectedRows.length) {
      selectedRows = this.checkedRows();
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
      const dialogRef = this.editUserAccessRightsDialog.open(WorkspaceAccessRightsDialogComponent, {
        width: '600px',
        minHeight: '600px',
        data: {
          selectedUser: this.selectedRows()
        }
      });
      dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result: number[]) => {
        if (result) {
          this.setUserWorkspaceAccessRights.emit(result);
        }
      });
    }
  }
}
