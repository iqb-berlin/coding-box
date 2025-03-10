import {
  Component, EventEmitter, Input, Output
} from '@angular/core';
import { UntypedFormGroup } from '@angular/forms';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltip } from '@angular/material/tooltip';
import { MatButton } from '@angular/material/button';
import { EditWorkspaceComponent } from '../../../workspace/components/edit-workspace/edit-workspace.component';
import { WrappedIconComponent } from '../../../shared/wrapped-icon/wrapped-icon.component';
import { WorkspaceInListDto } from '../../../../../../../api-dto/workspaces/workspace-in-list-dto';
import {
  ConfirmDialogComponent,
  ConfirmDialogData
} from '../../../shared/dialogs/confirm-dialog.component';
// eslint-disable-next-line import/no-cycle
import { UserAccessRightsDialogComponent } from '../user-access-rights-dialog/user-access-rights-dialog.component';

@Component({
  selector: 'coding-box-workspaces-menu',
  templateUrl: './workspaces-menu.component.html',
  styleUrls: ['./workspaces-menu.component.scss'],
  imports: [MatButton, MatTooltip, WrappedIconComponent, TranslateModule]
})
export class WorkspacesMenuComponent {
  @Input() selectedWorkspaces!: number[];
  @Input() selectedRows!: WorkspaceInListDto[];
  @Input() checkedRows!: WorkspaceInListDto[];
  @Output() downloadWorkspacesReport: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() workspaceAdded: EventEmitter<UntypedFormGroup> = new EventEmitter<UntypedFormGroup>();
  @Output() workspaceDeleted: EventEmitter< number[]> = new EventEmitter< number[]>();
  @Output() workspaceSettingsEdited = new EventEmitter();
  @Output() workspaceAccessRightsChanged = new EventEmitter();
  @Output() workspaceEdited: EventEmitter<{ selection: number[], formData: UntypedFormGroup }> =
    new EventEmitter<{ selection: number[], formData: UntypedFormGroup }>();

  @Output() setWorkspaceUsersAccessRight: EventEmitter<number[]> = new EventEmitter<number[]>();

  constructor(
    private editWorkspaceDialog: MatDialog,
    private UserAccessRightsToWorkspaceDialog: MatDialog,
    private deleteConfirmDialog: MatDialog,
    private translateService: TranslateService) {}

  addWorkspace(): void {
    const dialogRef = this.editWorkspaceDialog.open(EditWorkspaceComponent, {
      width: '600px',
      data: {
        wsg: {
          name: ''
        },
        title: this.translateService.instant('admin.new-workspace'),
        saveButtonLabel: this.translateService.instant('create')
      }
    });

    dialogRef.afterClosed().subscribe((result: boolean | UntypedFormGroup) => {
      if (typeof result !== 'undefined') {
        if (result !== false) {
          this.workspaceAdded.emit(result as UntypedFormGroup);
        }
      }
    });
  }

  editWorkspace(): void {
    if (this.selectedWorkspaces.length) {
      const dialogRef = this.editWorkspaceDialog.open(EditWorkspaceComponent, {
        width: '600px',
        data: {
          ws: this.selectedWorkspaces[0],
          title: this.translateService.instant('admin.edit-workspace'),
          saveButtonLabel: this.translateService.instant('save')

        }
      });
      dialogRef.afterClosed().subscribe(result => {
        if (typeof result !== 'undefined') {
          if (result !== false) {
            this.workspaceEdited.emit({ selection: this.selectedWorkspaces, formData: result });
          }
        }
      });
    }
  }

  deleteWorkspace(): void {
    if (this.selectedWorkspaces.length) {
      const content = (this.selectedWorkspaces.length === 1) ?
        this.translateService.instant('admin.delete-workspace') :
        this.translateService.instant('admin.delete-workspaces', { count: this.selectedWorkspaces.length });
      const dialogRef = this.deleteConfirmDialog.open(ConfirmDialogComponent, {
        width: '400px',
        data: <ConfirmDialogData>{
          title: this.translateService.instant('admin.delete-workspaces-title'),
          content: content,
          confirmButtonLabel: this.translateService.instant('delete'),
          showCancel: true
        }
      });

      dialogRef.afterClosed().subscribe(result => {
        if (result === true) {
          this.workspaceDeleted.emit(this.selectedWorkspaces);
        }
      });
    }
  }

  editUserAccessRightsToWorkspace(): void {
    const dialogRef = this.UserAccessRightsToWorkspaceDialog.open(UserAccessRightsDialogComponent, {
      width: '600px',
      minHeight: '600px',
      data: {
        selectedWorkspace: this.selectedWorkspaces
      }
    });

    dialogRef.afterClosed().subscribe((result: number[]) => {
      if (typeof result !== 'undefined') {
        if (result.length > 0) {
          this.setWorkspaceUsersAccessRight.emit(result as number[]);
        }
      }
    });
  }
}
