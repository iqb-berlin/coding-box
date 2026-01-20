import { Component, inject, OnInit } from '@angular/core';
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
  private authService = inject(AuthService);
  private appService: AppService = inject(AppService);

  userName: string = '';
  userStatus: string = '';

  async ngOnInit() {
    try {
      const userProfile = await this.authService.loadUserProfile();
      if (userProfile.firstName && userProfile.lastName) {
        this.userName = `${userProfile.firstName} ${userProfile.lastName}`;
      } else if (userProfile.username) {
        this.userName = userProfile.username;
      }

      this.appService.authData$.subscribe((authData: AuthDataDto) => {
        this.userStatus = authData.isAdmin ? 'Administrator' : 'Nutzer';
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
