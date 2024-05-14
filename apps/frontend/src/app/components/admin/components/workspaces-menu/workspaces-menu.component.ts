import {
  Component, EventEmitter, Input, Output
} from '@angular/core';
import { UntypedFormGroup } from '@angular/forms';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltip } from '@angular/material/tooltip';
import { MatButton } from '@angular/material/button';
import { WrappedIconComponent } from '../../../wrapped-icon/wrapped-icon.component';
import { WorkspaceInListDto } from '../../../../../../api-dto/workspaces/workspace-in-list-dto';
import {
  ConfirmDialogComponent,
  ConfirmDialogData
} from '../../../../../../iqb-components/src/lib/dialogs/confirm-dialog.component';
import { EditWorkspaceComponent } from '../../../edit-workspace/edit-workspace.component';
import {
  WorkspaceAccessRightsDialogComponent
} from '../workspace-access-rights-dialog/workspace-access-rights-dialog.component';


@Component({
  selector: 'coding-box-workspaces-menu',
  templateUrl: './workspaces-menu.component.html',
  styleUrls: ['./workspaces-menu.component.scss'],
  standalone: true,
  imports: [MatButton, MatTooltip, WrappedIconComponent, TranslateModule]
})
export class WorkspacesMenuComponent {
  @Input() selectedWorkspaceGroupId!: number;
  @Input() selectedRows!: WorkspaceInListDto[];
  @Input() checkedRows!: WorkspaceInListDto[];
  @Output() downloadWorkspacesReport: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() workspaceAdded: EventEmitter<UntypedFormGroup> = new EventEmitter<UntypedFormGroup>();
  @Output() workspaceDeleted: EventEmitter< WorkspaceInListDto[]> = new EventEmitter< WorkspaceInListDto[]>();
  @Output() workspaceSettingsEdited = new EventEmitter();
  @Output() workspaceAccessRightsChanged = new EventEmitter();
  @Output() workspaceEdited: EventEmitter<{ selection: WorkspaceInListDto[], group: UntypedFormGroup }> =
    new EventEmitter<{ selection: WorkspaceInListDto[], group: UntypedFormGroup }>();

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
        title: this.translateService.instant('admin.new-group'),
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
    let selectedRows = this.selectedRows;
    if (selectedRows.length === 0) {
      selectedRows = this.checkedRows;
    }
    if (selectedRows.length) {
      const dialogRef = this.editWorkspaceDialog.open(EditWorkspaceComponent, {
        width: '600px',
        data: {
          wsg: selectedRows[0],
          title: this.translateService.instant('admin.edit-group'),
          saveButtonLabel: this.translateService.instant('save')

        }
      });
      dialogRef.afterClosed().subscribe(result => {
        if (typeof result !== 'undefined') {
          if (result !== false) {
            this.workspaceEdited.emit({ selection: selectedRows, group: result as UntypedFormGroup });
          }
        }
      });
    }
  }

  deleteWorkspace(): void {
    let selectedRows = this.selectedRows;
    if (selectedRows.length === 0) {
      selectedRows = this.checkedRows;
    }
    if (selectedRows.length) {
      const content = (selectedRows.length === 1) ?
        this.translateService.instant('admin.delete-group', { name: selectedRows[0].name }) :
        this.translateService.instant('admin.delete-groups', { count: selectedRows.length });
      const dialogRef = this.deleteConfirmDialog.open(ConfirmDialogComponent, {
        width: '400px',
        data: <ConfirmDialogData>{
          title: this.translateService.instant('admin.delete-groups-title'),
          content: content,
          confirmButtonLabel: this.translateService.instant('delete'),
          showCancel: true
        }
      });

      dialogRef.afterClosed().subscribe(result => {
        if (result === true) {
          this.workspaceDeleted.emit(selectedRows);
        }
      });
    }
  }

  editUserAccessRightsToWorkspace(): void {
    const dialogRef = this.UserAccessRightsToWorkspaceDialog.open(WorkspaceAccessRightsDialogComponent, {
      width: '600px',
      minHeight: '600px',
      data: {
        selectedUser: this.selectedRows,
      }
    });

    dialogRef.afterClosed().subscribe((result: boolean | UntypedFormGroup) => {
      if (typeof result !== 'undefined') {
        if (result !== false) {
          this.workspaceAccessRightsChanged.emit(result as UntypedFormGroup);
        }
      }
    });
  }
}
