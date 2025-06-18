import { Component, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatMenu, MatMenuTrigger } from '@angular/material/menu';
import { MatButton } from '@angular/material/button';
import { WrappedIconComponent } from '../../../shared/wrapped-icon/wrapped-icon.component';
import { AccountActionComponent } from '../account-action/account-action.component';
import { AuthService } from '../../../auth/service/auth.service';

@Component({
  selector: 'coding-box-user-menu',
  templateUrl: './user-menu.component.html',
  styleUrls: ['./user-menu.component.scss'],
  imports: [
    MatButton,
    MatMenuTrigger,
    MatTooltip,
    WrappedIconComponent,
    MatMenu,
    TranslateModule,
    AccountActionComponent
  ]
})
export class UserMenuComponent {
  private authService = inject(AuthService);

  async logout() {
    await this.authService.logout();
  }

  async editAccount() {
    await this.authService.redirectToProfile();
  }
}
