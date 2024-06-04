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
import { UsersSelectionComponent } from '../users-selection/users-selection.component';

@Component({
  selector: 'coding-box-user-access-rights-dialog',
  templateUrl: './user-access-rights-dialog.component.html',
  styleUrls: ['./user-access-rights-dialog.component.scss'],
  standalone: true,
  imports: [MatDialogContent, MatIcon, MatDialogActions, MatButton, MatDialogClose, TranslateModule, WorkspacesSelectionComponent, JsonPipe, UsersSelectionComponent]
})

export class UserAccessRightsDialogComponent implements OnInit {
  selectedUserIds!: number[];
  result: number[] = [];
  constructor(@Inject(MAT_DIALOG_DATA) public data: { selectedWorkspace:number },
              private backendService: BackendService) {
    this.backendService.getUsersByWorkspaceList(this.data.selectedWorkspace).subscribe(users => {
      this.selectedUserIds = users;
    });
  }

  ngOnInit(): void {

  }

  setUsersSelection(result: UserFullDto[]): void {
    this.result = result.map(workspace => workspace.id);
    console.log(this.result);
  }
}
