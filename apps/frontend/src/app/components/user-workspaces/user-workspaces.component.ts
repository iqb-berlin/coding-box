import { Component, Input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { MatAnchor } from '@angular/material/button';
import { WorkspaceFullDto } from '../../../../api-dto/workspaces/workspace-full-dto';
import { WrappedIconComponent } from '../wrapped-icon/wrapped-icon.component';

@Component({
  selector: 'coding-book-user-workspaces',
  templateUrl: './user-workspaces.component.html',
  styleUrls: ['./user-workspaces.component.scss'],
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [MatAnchor, RouterLink, MatTooltip, WrappedIconComponent, TranslateModule]
})

export class UserWorkspacesComponent {
  @Input() workspaces!: WorkspaceFullDto[];
}
