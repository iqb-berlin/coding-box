import { Component, Input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { RouterLink } from '@angular/router';
import { MatAnchor, MatButton } from '@angular/material/button';
import { KeycloakService } from 'keycloak-angular';
import { WorkspaceFullDto } from '../../../../../../../api-dto/workspaces/workspace-full-dto';
import { AuthService } from '../../../auth/service/auth.service';

@Component({
  selector: 'coding-book-user-workspaces',
  templateUrl: './user-workspaces.component.html',
  styleUrls: ['./user-workspaces.component.scss'],
  providers: [KeycloakService],
  // eslint-disable-next-line max-len
  imports: [MatAnchor, RouterLink, TranslateModule, MatButton]
})

export class UserWorkspacesComponent {
  constructor(public keycloakService: KeycloakService, public authService:AuthService) {}
  @Input() workspaces!: WorkspaceFullDto[];
}
