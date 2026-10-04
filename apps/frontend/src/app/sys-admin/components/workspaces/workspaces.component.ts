import {
  Component, ViewChild, computed, inject, signal
} from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSort } from '@angular/material/sort';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { map } from 'rxjs';
import { WorkspacesMenuComponent } from '../workspaces-menu/workspaces-menu.component';
import { WorkspacesSelectionComponent } from '../workspaces-selection/workspaces-selection.component';
import { WorkspaceInListDto } from '../../../../../../../api-dto/workspaces/workspace-in-list-dto';
import { AppService } from '../../../core/services/app.service';
import { WorkspaceBackendService } from '../../../workspace/services/workspace-backend.service';
import { EditWorkspaceForm } from '../../../workspace/components/edit-workspace/edit-workspace.component';
import {
  MutationAuthDataRefreshResult,
  hasCurrentAuthDataAfterMutation,
  runMutationAndRefreshAuthData
} from '../../../core/utils/auth-data-refresh';

@Component({
  selector: 'coding-box-workspaces',
  templateUrl: './workspaces.component.html',
  styleUrls: ['./workspaces.component.scss'],
  imports: [WorkspacesMenuComponent, FormsModule, TranslateModule, WorkspacesSelectionComponent, MatProgressSpinnerModule]
})
export class WorkspacesComponent {
  private appService = inject(AppService);
  private workspaceBackendService = inject(WorkspaceBackendService);
  private snackBar = inject(MatSnackBar);
  private translateService = inject(TranslateService);

  readonly initialSelectedWorkspaceIds: number[] = [];
  readonly selectedWorkspaceRows = signal<WorkspaceInListDto[]>([]);
  readonly selectedWorkspaces = computed(() => this.selectedWorkspaceRows().map(workspace => workspace.id));
  readonly workspacesChanged = signal<boolean>(false);
  readonly isDeleting = signal<boolean>(false);
  readonly deleteStatus = signal<string>('');

  @ViewChild(MatSort) sort = new MatSort();

  addWorkspace(result: EditWorkspaceForm): void {
    runMutationAndRefreshAuthData(
      this.appService,
      this.workspaceBackendService.addWorkspace({
        name: result.controls.name.value,
        settings: {}
      }).pipe(map(workspaceId => workspaceId !== null))
    ).subscribe(
      mutationResult => {
        if (mutationResult.mutationSucceeded) {
          this.showMutationSuccess('admin.workspace-created', mutationResult);
          this.workspacesChanged.set(true);
        } else {
          this.snackBar.open(
            this.translateService.instant('admin.workspace-not-created'),
            this.translateService.instant('error'),
            { duration: 3000 });
        }
      }
    );
  }

  editWorkspace(value: { selection: number[], formData: EditWorkspaceForm }): void {
    runMutationAndRefreshAuthData(
      this.appService,
      this.workspaceBackendService.changeWorkspace({
        id: value.selection[0],
        name: value.formData.controls.name.value
      })
    )
      .subscribe(
        result => {
          if (result.mutationSucceeded) {
            this.showMutationSuccess('admin.workspace-edited', result);
            this.workspacesChanged.set(true);
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

  deleteWorkspace(workspace_ids: number[]): void {
    this.isDeleting.set(true);

    const deleteSteps = [
      'admin.deleting-workspace-starting',
      'admin.deleting-workspace-files',
      'admin.deleting-workspace-persons',
      'admin.deleting-workspace-finish'
    ];

    let stepIndex = 0;
    const interval = setInterval(() => {
      if (stepIndex < deleteSteps.length) {
        this.deleteStatus.set(this.translateService.instant(deleteSteps[stepIndex]));

        // eslint-disable-next-line no-plusplus
        stepIndex++;
      } else {
        clearInterval(interval);
      }
    }, 1000);

    runMutationAndRefreshAuthData(
      this.appService,
      this.workspaceBackendService.deleteWorkspace(workspace_ids)
    )
      .subscribe(
        result => {
          clearInterval(interval);
          if (result.mutationSucceeded) {
            this.deleteStatus.set(this.translateService.instant('admin.deleting-workspace-success'));

            setTimeout(() => {
              this.showMutationSuccess('admin.workspace-deleted', result);
              this.workspacesChanged.set(true);
              this.isDeleting.set(false);
            }, 1000);
          } else {
            this.snackBar.open(
              this.translateService.instant('admin.workspace-not-deleted'),
              this.translateService.instant('error'),
              { duration: 1000 });
            this.isDeleting.set(false);
          }
        }
      );
  }

  workspacesUpdated(): void {
    this.workspacesChanged.set(false);
  }

  workspaceSelectionChanged(workspaceData: WorkspaceInListDto[]): void {
    this.selectedWorkspaceRows.set([...workspaceData]);
  }

  setWorkspaceUsersAccessRight(users: number[]): void {
    runMutationAndRefreshAuthData(
      this.appService,
      this.workspaceBackendService.setWorkspaceUsersAccessRight(this.selectedWorkspaces()[0], users)
    )
      .subscribe(
        result => {
          if (result.mutationSucceeded) {
            this.showMutationSuccess('admin.workspace-access-right-set', result);
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

  private showMutationSuccess(
    successTranslationKey: string,
    result: MutationAuthDataRefreshResult
  ): void {
    if (hasCurrentAuthDataAfterMutation(result)) {
      this.snackBar.open(
        this.translateService.instant(successTranslationKey),
        '',
        { duration: 1000 }
      );
      return;
    }

    if (result.authDataRefreshOutcome === 'failed') {
      this.snackBar.open(
        this.translateService.instant('admin.change-saved-auth-data-refresh-failed'),
        this.translateService.instant('error'),
        { duration: 5000 }
      );
    }
  }
}
