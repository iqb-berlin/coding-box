import { Component, ViewChild, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSort } from '@angular/material/sort';
import { FormsModule, UntypedFormGroup } from '@angular/forms';
import { SelectionModel } from '@angular/cdk/collections';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { WorkspacesMenuComponent } from '../workspaces-menu/workspaces-menu.component';
import { WorkspacesSelectionComponent } from '../workspaces-selection/workspaces-selection.component';
import { WorkspaceInListDto } from '../../../../../../../api-dto/workspaces/workspace-in-list-dto';
import { AppService } from '../../../services/app.service';
import { BackendService } from '../../../services/backend.service';
import { CreateWorkspaceDto } from '../../../../../../../api-dto/workspaces/create-workspace-dto';

type WorkspaceData = {
  id: number;
  name: string;
};

@Component({
  selector: 'coding-box-workspaces',
  templateUrl: './workspaces.component.html',
  styleUrls: ['./workspaces.component.scss'],
  imports: [WorkspacesMenuComponent, FormsModule, TranslateModule, WorkspacesSelectionComponent, MatProgressSpinnerModule]
})
export class WorkspacesComponent {
  private appService = inject(AppService);
  private backendService = inject(BackendService);
  private snackBar = inject(MatSnackBar);
  private translateService = inject(TranslateService);

  tableSelectionCheckboxes = new SelectionModel<WorkspaceInListDto>(true, []);
  tableSelectionRow = new SelectionModel<WorkspaceInListDto>(false, []);
  selectedWorkspaceId = 0;
  selectedWorkspaces : number[] = [];
  workspacesChanged: boolean = false;
  isDeleting: boolean = false;
  deleteStatus: string = '';

  @ViewChild(MatSort) sort = new MatSort();

  addWorkspace(result: UntypedFormGroup): void {
    this.backendService.addWorkspace(<CreateWorkspaceDto>{
      name: (<UntypedFormGroup>result).get('name')?.value,
      settings: {}
    }).subscribe(
      respOk => {
        if (respOk) {
          this.snackBar.open(
            this.translateService.instant('admin.workspace-created'),
            '',
            { duration: 1000 });
          this.workspacesChanged = true;
        } else {
          this.snackBar.open(
            this.translateService.instant('admin.workspace-not-created'),
            this.translateService.instant('error'),
            { duration: 3000 });
        }
      }
    );
  }

  editWorkspace(value: { selection: number[], formData: UntypedFormGroup }): void {
    this.backendService.changeWorkspace({
      id: value.selection[0],
      name: value.formData.get('name')?.value
    })
      .subscribe(
        respOk => {
          if (respOk) {
            this.snackBar.open(
              this.translateService.instant('admin.workspace-edited'),
              '',
              { duration: 1000 });
            this.workspacesChanged = true;
          } else {
            this.snackBar.open(
              this.translateService.instant('admin.workspace-not-edited'),
              this.translateService.instant('error'),
              { duration: 3000 }
            );
          }
        }
      );
  }

  deleteWorkspace(workspace_ids:number[]): void {
    this.isDeleting = true;
    const deleteSteps = [
      'admin.deleting-workspace-starting',
      'admin.deleting-workspace-files',
      'admin.deleting-workspace-persons',
      'admin.deleting-workspace-finish'
    ];

    let stepIndex = 0;
    const interval = setInterval(() => {
      if (stepIndex < deleteSteps.length) {
        this.deleteStatus = this.translateService.instant(deleteSteps[stepIndex]);
        // eslint-disable-next-line no-plusplus
        stepIndex++;
      } else {
        clearInterval(interval);
      }
    }, 1000);

    this.backendService.deleteWorkspace(workspace_ids).subscribe(
      respOk => {
        clearInterval(interval);
        if (respOk) {
          this.deleteStatus = this.translateService.instant('admin.deleting-workspace-success');
          setTimeout(() => {
            this.snackBar.open(
              this.translateService.instant('admin.workspace-deleted'),
              '',
              { duration: 1000 });
            this.workspacesChanged = true;
            this.isDeleting = false;
          }, 1000);
        } else {
          this.snackBar.open(
            this.translateService.instant('admin.workspace-not-deleted'),
            this.translateService.instant('error'),
            { duration: 1000 });
          this.isDeleting = false;
        }
      }
    );
  }

  workspacesUpdated(): void {
    this.workspacesChanged = false;
  }

  workspaceSelectionChanged(workspaceData: WorkspaceData[]): void {
    this.selectedWorkspaces = workspaceData.map(workspace => workspace.id);
  }

  setWorkspaceUsersAccessRight(users: number[]): void {
    this.backendService.setWorkspaceUsersAccessRight(this.selectedWorkspaces[0], users).subscribe(
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
}
