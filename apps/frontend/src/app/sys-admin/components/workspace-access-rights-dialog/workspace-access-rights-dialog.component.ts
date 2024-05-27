import {
  Component, Inject, OnInit
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import {
  MatDialogContent, MatDialogActions, MatDialogClose, MAT_DIALOG_DATA
} from '@angular/material/dialog';
import { JsonPipe } from '@angular/common';
import { WorkspacesSelectionComponent } from '../workspaces-selection/workspaces-selection.component';
import { UserFullDto } from '../../../../../api-dto/user/user-full-dto';
import { BackendService } from '../../../services/backend.service';
import { WorkspaceInListDto } from '../../../../../api-dto/workspaces/workspace-in-list-dto';

@Component({
  selector: 'coding-box-workspace-access-rights-dialog',
  templateUrl: './workspace-access-rights-dialog.component.html',
  styleUrls: ['./workspace-access-rights-dialog.component.scss'],
  standalone: true,
  imports: [MatDialogContent, MatIcon, MatDialogActions, MatButton, MatDialogClose, TranslateModule, WorkspacesSelectionComponent, JsonPipe]
})

export class WorkspaceAccessRightsDialogComponent implements OnInit {
  selectedWorkspacesIds!: number[];
  result: number[] = [];
  constructor(@Inject(MAT_DIALOG_DATA) public data: { selectedUser:UserFullDto[] },
              private backendService: BackendService) {
    this.backendService.getWorkspacesByUserList(this.data.selectedUser[0].id).subscribe(workspaces => {
      this.selectedWorkspacesIds = workspaces;
    });
  }

  ngOnInit(): void {

  }

  setWorkspacesSelection(result: WorkspaceInListDto[]): void {
    this.result = result.map(workspace => workspace.id);
  }
}
