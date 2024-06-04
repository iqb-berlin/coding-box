import { APP_INITIALIZER, Component, OnInit } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { KeycloakService } from 'keycloak-angular';
import { MatButton } from '@angular/material/button';
import { AppService } from './services/app.service';
import { AuthService } from './auth/service/auth.service';
import { initializer } from './auth/keycloak-initializer';
import { CreateUserDto } from '../../api-dto/user/create-user-dto';
import { BackendService } from './services/backend.service';
import { WrappedIconComponent } from './shared/wrapped-icon/wrapped-icon.component';
import { UserMenuComponent } from './sys-admin/components/user-menu/user-menu.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, MatSlideToggleModule, MatProgressSpinner, RouterLink, TranslateModule, MatTooltip, MatButton, UserMenuComponent, WrappedIconComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  providers: [AuthService,
    {
      provide: APP_INITIALIZER,
      useFactory: initializer,
      multi: true,
      deps: [KeycloakService]
    }
  ]
})
export class AppComponent implements OnInit {
  title = 'coding-box';
  loggedInKeycloak: boolean = false;
  errorMessage = '';
  constructor(
    public appService: AppService,
    public authService:AuthService,
    public keycloakService:KeycloakService,
    public backendService:BackendService,
    private router: Router) {}

  async keycloakLogin(user: CreateUserDto): Promise<void> {
    this.errorMessage = '';
    this.appService.errorMessagesDisabled = true;
    //const initLoginMode = !this.appService.appConfig.hasUsers;
    this.backendService.keycloakLogin(user).subscribe(async ok => {
      console.log('keycloakLogin', ok);
      // await this.validLoginCheck(ok, initLoginMode);
    });
  }

  async ngOnInit(): Promise<void> {
    if (!this.keycloakService.isLoggedIn()) {
      await this.authService.login();
    } else {
      this.loggedInKeycloak = true;
      this.appService.isLoggedInKeycloak = true;
      this.appService.loggedUser = this.authService.getLoggedUser();
      this.appService.userProfile = await this.authService.loadUserProfile();
      const isAdmin = this.authService.getRoles().includes('admin');
      if (this.appService.userProfile.id && this.appService.userProfile.username) {
        const keycloakUser: CreateUserDto = {
          issuer: this.appService.loggedUser?.iss || '',
          identity: this.appService.userProfile.id,
          username: this.appService.userProfile.username,
          lastName: this.appService.userProfile.lastName || '',
          firstName: this.appService.userProfile.firstName || '',
          email: this.appService.userProfile.email || '',
          isAdmin: isAdmin
        };
        await this.keycloakLogin(keycloakUser);
      }
      const token = localStorage.getItem('id_token');
      if (token) {
        this.backendService.getAuthData(this.appService.userProfile.id || '').subscribe(async authData => {
          this.appService.authData = authData;
        });
      }
    }
    window.addEventListener('message', event => {
      this.appService.processMessagePost(event);
    }, false);
  }
}
