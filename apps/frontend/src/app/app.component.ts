import {
  Component, OnInit
} from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatButton } from '@angular/material/button';
import { LocationStrategy } from '@angular/common';
import { KeycloakProfile } from 'keycloak-js';
import { AppService } from './services/app.service';
import { AuthService } from './auth/service/auth.service';
import { CreateUserDto } from '../../../../api-dto/user/create-user-dto';
import { BackendService } from './services/backend.service';
import { WrappedIconComponent } from './shared/wrapped-icon/wrapped-icon.component';
import { UserMenuComponent } from './sys-admin/components/user-menu/user-menu.component';
import { AuthDataDto } from '../../../../api-dto/auth-data-dto';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, MatSlideToggleModule, MatProgressSpinner, RouterLink, TranslateModule, MatTooltip, MatButton, UserMenuComponent, WrappedIconComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  providers: [AuthService]
})
export class AppComponent implements OnInit {
  title = 'IQB-Kodierbox';
  loggedInKeycloak: boolean = false;
  errorMessage = '';
  authData :AuthDataDto = AppService.defaultAuthData;

  constructor(
    public appService: AppService,
    public authService:AuthService,
    public backendService:BackendService,
    public url:LocationStrategy) {
    this.appService.authData$.subscribe(authData => {
      this.authData = authData;
    });
  }

  async keycloakLogin(user: CreateUserDto): Promise<void> {
    this.errorMessage = '';
    this.appService.errorMessagesDisabled = true;
    this.backendService.keycloakLogin(user).subscribe(() => {
    });
  }

  async ngOnInit(): Promise<void> {
    if (this.authService.isLoggedIn()) {
      this.setAuthState();

      const keycloakUserProfile = await this.authService.loadUserProfile();
      const isAdmin = this.authService.getRoles().includes('admin');

      if (this.isValidUserProfile(keycloakUserProfile)) {
        const keycloakUser = this.createKeycloakUser(keycloakUserProfile, isAdmin);
        this.appService.kcUser = keycloakUser;
        await this.keycloakLogin(keycloakUser);
      }
    }

    window.addEventListener('message', event => {
      this.appService.processMessagePost(event);
    }, false);
  }

  private setAuthState(): void {
    this.loggedInKeycloak = true;
    this.appService.isLoggedInKeycloak = true;
    this.appService.loggedUser = this.authService.getLoggedUser();
  }

  private isValidUserProfile(userProfile: KeycloakProfile): boolean {
    return !!userProfile?.id && !!userProfile?.username;
  }

  private createKeycloakUser(userProfile: KeycloakProfile, isAdmin: boolean): CreateUserDto {
    return {
      issuer: this.appService.loggedUser?.iss || '',
      identity: userProfile.id,
      username: userProfile.username || '',
      lastName: userProfile.lastName || '',
      firstName: userProfile.firstName || '',
      email: userProfile.email || '',
      isAdmin: isAdmin
    };
  }
}
