import { Component, Input, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { RouterLink } from '@angular/router';
import { MatAnchor, MatButton } from '@angular/material/button';
import { WorkspaceFullDto } from '../../../../../../../api-dto/workspaces/workspace-full-dto';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'coding-book-user-workspaces',
  templateUrl: './user-workspaces.component.html',
  styleUrls: ['./user-workspaces.component.scss'],
  imports: [MatAnchor, RouterLink, TranslateModule, MatButton]
})

export class UserWorkspacesComponent {
  authService = inject(AuthService);
  @Input() workspaces!: WorkspaceFullDto[];
}
