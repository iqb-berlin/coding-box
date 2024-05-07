import { APP_INITIALIZER, Component, OnInit } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
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

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, MatSlideToggleModule, MatProgressSpinner, RouterLink, TranslateModule, MatTooltip, MatButton],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  providers: [AuthService, {
    provide: APP_INITIALIZER,
    useFactory: initializer,
    multi: true,
    deps: [KeycloakService]
  }]
})
export class AppComponent implements OnInit {
  constructor(
    // eslint-disable-next-line max-len
    public appService: AppService, public authService:AuthService, public keycloakService:KeycloakService, public backendService:BackendService) {}

  loggedIn = false;
  title = 'coding-box';
  async ngOnInit(): Promise<void> {
    if (!this.keycloakService.isLoggedIn()) {
      await this.authService.login();
      this.loggedIn = false;
    } else {
      this.loggedIn = true;
      this.backendService.getAuthData().subscribe(authData => {
        console.log('authData', authData);
        this.appService.authData = authData;
      });
      const loggedUser = this.authService.getLoggedUser();
      console.log('loggedUser', loggedUser);
      const userProfile = await this.authService.loadUserProfile();
      console.log('userProfile', userProfile);
      if (userProfile.username) {
        const user: CreateUserDto = {
          issuer: loggedUser?.iss || '',
          identity: userProfile.id,
          username: userProfile.username,
          lastName: userProfile.lastName || '',
          firstName: userProfile.firstName || '',
          email: userProfile.email || '',
          isAdmin: false
        };
        this.backendService.login(user).subscribe(async ok => {
          console.log('login ok', ok);
        });
      }
    }
    window.addEventListener('message', event => {
      this.appService.processMessagePost(event);
    }, false);
  }

  logout() {
    this.authService.logout();
  }
}
