import { Component, ChangeDetectionStrategy } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { RouterLinkActive, RouterLink, RouterOutlet } from '@angular/router';

import { MatTabNav, MatTabLink, MatTabNavPanel } from '@angular/material/tabs';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-admin',
  templateUrl: './admin.component.html',
  styleUrls: ['./admin.component.scss'],
  imports: [MatTabNav, MatTabLink, RouterLinkActive, RouterLink, MatTabNavPanel, RouterOutlet, TranslateModule]
})
export class AdminComponent {
  protected navLinks = [
    'users',
    'workspaces',
    'notifications',
    'settings'
  ];
}
