import {
  Component, EventEmitter, Input, Output
} from '@angular/core';
import { UntypedFormGroup } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatButton } from '@angular/material/button';
import { EditUserComponent } from '../edit-user/edit-user.component';
import { WrappedIconComponent } from '../../../wrapped-icon/wrapped-icon.component';
import { UserFullDto } from '../../../../../../api-dto/user/user-full-dto';
import {
  MessageDialogComponent,
  MessageDialogData, MessageType
} from '../../../../../../iqb-components/src/lib/dialogs/message-dialog.component';
import {
  ConfirmDialogComponent,
  ConfirmDialogData
} from '../../../../../../iqb-components/src/lib/dialogs/confirm-dialog.component';
import { WorkspacesComponent } from '../workspaces/workspaces.component';
import { WorkspacesSelectionComponent } from '../workspaces-selection/workspaces-selection.component';
import {
  WorkspaceAccessRightsDialogComponent
} from '../workspace-access-rights-dialog/workspace-access-rights-dialog.component';

@Component({
  selector: 'coding-box-users-menu',
  templateUrl: './users-menu.component.html',
  styleUrls: ['./users-menu.component.scss'],
  standalone: true,
  imports: [MatButton, MatTooltip, WrappedIconComponent, TranslateModule, WrappedIconComponent]
})
export class UsersMenuComponent {
  @Input() selectedUser!: number[];
  @Input() selectedRows!: UserFullDto[];
  @Input() checkedRows!: UserFullDto[];
  @Output() userAdded: EventEmitter<UntypedFormGroup> = new EventEmitter<UntypedFormGroup>();
  @Output() usersDeleted: EventEmitter< UserFullDto[]> = new EventEmitter< UserFullDto[]>();
  @Output() userEdited: EventEmitter<{ selection: UserFullDto[], user: UntypedFormGroup }> =
    new EventEmitter<{ selection: UserFullDto[], user: UntypedFormGroup }>();

  constructor(private editUserDialog: MatDialog,
              private messsageDialog: MatDialog,
              private editUserWorkspaceAccessRightDialog: MatDialog,
              private deleteConfirmDialog: MatDialog,
              private translateService: TranslateService) {}

  addUser(): void {
    const dialogRef = this.editUserDialog.open(EditUserComponent, {
      width: '600px',
      data: {
        newUser: true,
        isAdmin: false
      }
    });

    dialogRef.afterClosed().subscribe((result: boolean | UntypedFormGroup) => {
      if (typeof result !== 'undefined') {
        if (result !== false) {
          this.userAdded.emit(result as UntypedFormGroup);
        }
      }
    });
  }

  editUser(): void {
    let selectedRows = this.selectedRows;
    if (!selectedRows.length) {
      selectedRows = this.checkedRows;
    }
    if (!selectedRows.length) {
      this.messsageDialog.open(MessageDialogComponent, {
        width: '400px',
        data: <MessageDialogData>{
          title: this.translateService.instant('admin.edit-user-data'),
          content: this.translateService.instant('admin.select-user'),
          type: MessageType.error
        }
      });
    } else {
      const dialogRef = this.editUserDialog.open(EditUserComponent, {
        width: '600px',
        data: {
          newUser: false,
          name: selectedRows[0].name,
          description: selectedRows[0].description,
          isAdmin: selectedRows[0].isAdmin,
          firstName: selectedRows[0].firstName,
          lastName: selectedRows[0].lastName,
          email: selectedRows[0].email,
          emailApproved: selectedRows[0].emailPublishApproved
        }
      });

      dialogRef.afterClosed().subscribe(result => {
        if (typeof result !== 'undefined') {
          if (result !== false) {
            this.userEdited.emit({ selection: selectedRows, user: result as UntypedFormGroup });
          }
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
      this.messsageDialog.open(MessageDialogComponent, {
        width: '400px',
        data: <MessageDialogData>{
          title: this.translateService.instant('admin.delete-users-title'),
          content: this.translateService.instant('admin.select-user'),
          type: MessageType.error
        }
      });
    } else {
      const content = (selectedRows.length === 1) ?
        this.translateService.instant('admin.delete-user', { name: selectedRows[0].name }) :
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
          this.usersDeleted.emit(selectedRows);
        }
      });
    }
  }

  setUserWorkspaceAccessRight(): void {
    const dialogRef = this.editUserWorkspaceAccessRightDialog.open(WorkspaceAccessRightsDialogComponent, {
      width: '600px',
      minHeight: '600px',
      data: {
        selectedUser: this.selectedRows,
      }
    });

    dialogRef.afterClosed().subscribe((result: boolean | UntypedFormGroup) => {
      if (typeof result !== 'undefined') {
        if (result !== false) {
          this.userAdded.emit(result as UntypedFormGroup);
        }
      }
    });
  }
}
