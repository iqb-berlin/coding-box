import { Component, Input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { MatButton } from '@angular/material/button';
import { WrappedIconComponent } from '../wrapped-icon/wrapped-icon.component';
import { UserMenuComponent } from '../user-menu/user-menu.component';

@Component({
  selector: 'coding-box-user-workspaces-area',
  templateUrl: './user-workspaces-area.component.html',
  styleUrls: ['./user-workspaces-area.component.scss'],
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [MatButton, RouterLink, MatTooltip, WrappedIconComponent, TranslateModule, WrappedIconComponent, UserMenuComponent]
})
export class UserWorkspacesAreaComponent {
  @Input() warning!: string;
  @Input() isAdmin!: boolean;
}
