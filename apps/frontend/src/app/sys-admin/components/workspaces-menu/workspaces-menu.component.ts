import {
  Component, inject,
  input,
  output
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
import { UserAccessRightsDialogComponent } from '../user-access-rights-dialog/user-access-rights-dialog.component';

@Component({
  selector: 'coding-box-workspaces-menu',
  templateUrl: './workspaces-menu.component.html',
  styleUrls: ['./workspaces-menu.component.scss'],
  imports: [MatButton, MatTooltip, WrappedIconComponent, TranslateModule]
})
export class WorkspacesMenuComponent {
  private editWorkspaceDialog = inject(MatDialog);
  private UserAccessRightsToWorkspaceDialog = inject(MatDialog);
  private deleteConfirmDialog = inject(MatDialog);
  private translateService = inject(TranslateService);

  readonly selectedWorkspaces = input.required<number[]>();
  readonly selectedRows = input.required<WorkspaceInListDto[]>();
  readonly checkedRows = input.required<WorkspaceInListDto[]>();
  readonly downloadWorkspacesReport = output<boolean>();
  readonly workspaceAdded = output<UntypedFormGroup>();
  readonly workspaceDeleted = output<number[]>();
  readonly workspaceSettingsEdited = output();
  readonly workspaceAccessRightsChanged = output();
  readonly workspaceEdited = output<{
    selection: number[];
    formData: UntypedFormGroup;
  }>();

  readonly setWorkspaceUsersAccessRight = output<number[]>();

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
    const selectedWorkspaces = this.selectedWorkspaces();
    if (selectedWorkspaces.length) {
      const dialogRef = this.editWorkspaceDialog.open(EditWorkspaceComponent, {
        width: '600px',
        data: {
          ws: selectedWorkspaces[0],
          title: this.translateService.instant('admin.edit-workspace'),
          saveButtonLabel: this.translateService.instant('save')

        }
      });
      dialogRef.afterClosed().subscribe(result => {
        if (typeof result !== 'undefined') {
          if (result !== false) {
            this.workspaceEdited.emit({ selection: this.selectedWorkspaces(), formData: result });
          }
        }
      });
    }
  }

  deleteWorkspace(): void {
    const selectedWorkspaces = this.selectedWorkspaces();
    if (selectedWorkspaces.length) {
      const content = (selectedWorkspaces.length === 1) ?
        this.translateService.instant('admin.delete-workspace') :
        this.translateService.instant('admin.delete-workspaces', { count: selectedWorkspaces.length });
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
          this.workspaceDeleted.emit(this.selectedWorkspaces());
        }
      });
    }
  }

  editUserAccessRightsToWorkspace(): void {
    const dialogRef = this.UserAccessRightsToWorkspaceDialog.open(UserAccessRightsDialogComponent, {
      width: '600px',
      minHeight: '600px',
      data: {
        selectedWorkspace: this.selectedWorkspaces()
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
