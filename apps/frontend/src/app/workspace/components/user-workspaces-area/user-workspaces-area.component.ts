import { Component, Input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { WorkspaceFullDto } from '../../../../../../../api-dto/workspaces/workspace-full-dto';
import { UserWorkspacesComponent } from '../user-workspaces/user-workspaces.component';

@Component({
  selector: 'coding-box-user-workspaces-area',
  templateUrl: './user-workspaces-area.component.html',
  styleUrls: ['./user-workspaces-area.component.scss'],
  imports: [TranslateModule, UserWorkspacesComponent]
})
export class UserWorkspacesAreaComponent {
  @Input() workspaces!: WorkspaceFullDto[];
}
