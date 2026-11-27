import {
  ChangeDetectionStrategy, Component, computed, inject
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatMenu, MatMenuTrigger } from '@angular/material/menu';
import { MatButton } from '@angular/material/button';
import { MatDivider } from '@angular/material/divider';
import { WrappedIconComponent } from '../../../shared/wrapped-icon/wrapped-icon.component';
import { AccountActionComponent } from '../account-action/account-action.component';
import { AuthService } from '../../../core/services/auth.service';
import { AuthSessionState } from '../../../core/services/auth-session-state.service';

@Component({
  selector: 'coding-box-user-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './user-menu.component.html',
  styleUrls: ['./user-menu.component.scss'],
  imports: [
    MatButton,
    MatMenuTrigger,
    MatTooltip,
    WrappedIconComponent,
    MatMenu,
    TranslateModule,
    AccountActionComponent,
    MatDivider
  ]
})
export class UserMenuComponent {
  private readonly authService = inject(AuthService);
  private readonly session = inject(AuthSessionState);
  protected readonly authData = this.session.authData;
  protected readonly fullName = computed(() => {
    const { firstName, lastName } = this.session.userProfile();
    return [firstName, lastName].filter(Boolean).join(' ');
  });

  protected readonly loginName = computed(() => (
    this.session.loggedUser()?.preferred_username || this.authData().userName || this.session.userProfile().username
  ));

  protected async logout() {
    await this.authService.logout();
  }

  protected async editAccount() {
    await this.authService.redirectToProfile();
  }
}
