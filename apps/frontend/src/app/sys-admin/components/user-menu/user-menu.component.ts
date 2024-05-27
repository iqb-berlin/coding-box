import { Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatMenu, MatMenuTrigger } from '@angular/material/menu';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { WrappedIconComponent } from '../../../shared/wrapped-icon/wrapped-icon.component';
import { AccountActionComponent } from '../account-action/account-action.component';
import { AuthService } from '../../../auth/service/auth.service';
import { ChangePasswordDirective } from '../../directives/change-password.directive';
import { AppService } from '../../../services/app.service';

@Component({
  selector: 'coding-box-user-menu',
  templateUrl: './user-menu.component.html',
  styleUrls: ['./user-menu.component.scss'],
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [MatButton, MatMenuTrigger, MatTooltip, WrappedIconComponent, MatMenu, TranslateModule, MatIcon, AccountActionComponent, ChangePasswordDirective]
})
export class UserMenuComponent {
  constructor(
    private authService: AuthService,
    private appService: AppService
  ) {
  }

  async logout() {
    await this.authService.logout();
  }

  async editAccount() {
    await this.authService.redirectToProfile();
  };
}
