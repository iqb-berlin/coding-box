import { Component, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { WorkspaceFullDto } from '../../../../../../../api-dto/workspaces/workspace-full-dto';
import { UserWorkspacesComponent } from '../user-workspaces/user-workspaces.component';
import { AuthBootstrapStatus } from '../../../core/services/app.service';

@Component({
  selector: 'coding-box-user-workspaces-area',
  templateUrl: './user-workspaces-area.component.html',
  styleUrls: ['./user-workspaces-area.component.scss'],
  imports: [TranslateModule, UserWorkspacesComponent]
})
export class UserWorkspacesAreaComponent {
  readonly workspaces = input.required<WorkspaceFullDto[]>();
  readonly authBootstrapStatus = input<AuthBootstrapStatus>('checking');
  readonly authDataLoaded = input(false);
}
