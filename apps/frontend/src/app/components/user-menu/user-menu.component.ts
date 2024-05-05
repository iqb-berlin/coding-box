import { Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatMenu, MatMenuTrigger } from '@angular/material/menu';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { WrappedIconComponent } from '../wrapped-icon/wrapped-icon.component';
import { AccountActionComponent } from '../account-action/account-action.component';

@Component({
  selector: 'coding-box-user-menu',
  templateUrl: './user-menu.component.html',
  styleUrls: ['./user-menu.component.scss'],
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [MatButton, MatMenuTrigger, MatTooltip, WrappedIconComponent, MatMenu, TranslateModule, MatIcon, AccountActionComponent]
})
export class UserMenuComponent {
}
