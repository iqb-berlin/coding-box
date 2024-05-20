import {
  Component, Inject, OnInit
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import {
  MatDialogContent, MatDialogActions, MatDialogClose, MAT_DIALOG_DATA
} from '@angular/material/dialog';
import { WorkspacesSelectionComponent } from '../workspaces-selection/workspaces-selection.component';
import { UserFullDto } from '../../../../../api-dto/user/user-full-dto';
import { BackendService } from '../../../services/backend.service';

@Component({
  selector: 'coding-box-workspace-access-rights-dialog',
  templateUrl: './workspace-access-rights-dialog.component.html',
  styleUrls: ['./workspace-access-rights-dialog.component.scss'],
  standalone: true,
  imports: [MatDialogContent, MatIcon, MatDialogActions, MatButton, MatDialogClose, TranslateModule, WorkspacesSelectionComponent]
})

export class WorkspaceAccessRightsDialogComponent implements OnInit{
  selectedUser: UserFullDto;
  selectedWorkspacesIds!: number[];
  constructor(@Inject(MAT_DIALOG_DATA) public data: { selectedUser:UserFullDto }, private backendService: BackendService) {
    console.log(data);
    this.selectedUser = data.selectedUser;
    this.backendService.getWorkspacesByUserList(this.data.selectedUser.id).subscribe(workspaces => {
      this.selectedWorkspacesIds = workspaces;
      console.log(workspaces);
    });
  }

  ngOnInit(): void {

  }
}
