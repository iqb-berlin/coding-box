import {
  ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatMenu, MatMenuTrigger } from '@angular/material/menu';
import { MatButton } from '@angular/material/button';
import { MatDivider } from '@angular/material/divider';
import { WrappedIconComponent } from '../../../shared/wrapped-icon/wrapped-icon.component';
import { AccountActionComponent } from '../account-action/account-action.component';
import { AuthService } from '../../../core/services/auth.service';
import { AppService } from '../../../core/services/app.service';
import { AuthDataDto } from '../../../../../../../api-dto/auth-data-dto';

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
export class UserMenuComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly authService = inject(AuthService);
  private readonly appService: AppService = inject(AppService);

  readonly userName = signal('');
  readonly userStatus = signal('');

  async ngOnInit() {
    try {
      const userProfile = await this.authService.loadUserProfile();
      if (this.destroyRef.destroyed) return;
      if (userProfile.firstName && userProfile.lastName) {
        this.userName.set(`${userProfile.firstName} ${userProfile.lastName}`);
      } else if (userProfile.username) {
        this.userName.set(userProfile.username);
      }

      this.appService.authData$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((authData: AuthDataDto) => {
        this.userStatus.set(authData.isAdmin ? 'Administrator' : 'Nutzer');
      });
    } catch (error) {
      // Handle error silently or log to a service if needed
    }
  }

  async logout() {
    await this.authService.logout();
  }

  async editAccount() {
    await this.authService.redirectToProfile();
  }
}
