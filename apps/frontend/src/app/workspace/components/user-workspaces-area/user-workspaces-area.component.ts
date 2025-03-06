import { Component, Input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { MatButton } from '@angular/material/button';
import { WrappedIconComponent } from '../../../shared/wrapped-icon/wrapped-icon.component';
import { WorkspaceFullDto } from '../../../../../../../api-dto/workspaces/workspace-full-dto';
import { UserWorkspacesComponent } from '../user-workspaces/user-workspaces.component';
import { UserMenuComponent } from '../../../sys-admin/components/user-menu/user-menu.component';

@Component({
    selector: 'coding-box-user-workspaces-area',
    templateUrl: './user-workspaces-area.component.html',
    styleUrls: ['./user-workspaces-area.component.scss'],
    // eslint-disable-next-line max-len
    imports: [MatButton, RouterLink, MatTooltip, WrappedIconComponent, TranslateModule, WrappedIconComponent, UserMenuComponent, UserWorkspacesComponent]
})
export class UserWorkspacesAreaComponent {
  @Input() warning!: string;
  @Input() isAdmin!: boolean;
  @Input() workspaces!: WorkspaceFullDto[];
}
