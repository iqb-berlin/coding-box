import { Component, Input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { MatAnchor, MatButton } from '@angular/material/button';
import { KeycloakService } from 'keycloak-angular';
import { WorkspaceFullDto } from '../../../../../../../api-dto/workspaces/workspace-full-dto';
import { WrappedIconComponent } from '../../../shared/wrapped-icon/wrapped-icon.component';
import { AuthService } from '../../../auth/service/auth.service';

@Component({
  selector: 'coding-book-user-workspaces',
  templateUrl: './user-workspaces.component.html',
  styleUrls: ['./user-workspaces.component.scss'],
  providers: [KeycloakService],
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [MatAnchor, RouterLink, MatTooltip, WrappedIconComponent, TranslateModule, MatButton]
})

export class UserWorkspacesComponent {
  constructor(public keycloakService: KeycloakService, public authService:AuthService) {}
  @Input() workspaces!: WorkspaceFullDto[];
}
