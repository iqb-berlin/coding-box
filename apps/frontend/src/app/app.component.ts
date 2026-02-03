import {
  Component, OnInit, OnDestroy, inject
} from '@angular/core';
import {
  RouterLink, RouterOutlet, Router, ActivatedRoute,NavigationEnd
} from '@angular/router';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatButton } from '@angular/material/button';
import { LocationStrategy, Location } from '@angular/common';
import { filter, firstValueFrom, Subscription } from 'rxjs';
import { UserProfile, AuthService } from './core/services/auth.service';

import { AppService } from './services/app.service';
import { LocationStrategy } from '@angular/common';
import { KeycloakProfile } from 'keycloak-js';
import { Subscription, filter } from 'rxjs';
import { AppService } from './core/services/app.service';
import { AuthService } from './core/services/auth.service';
import { CreateUserDto } from '../../../../api-dto/user/create-user-dto';

import { WrappedIconComponent } from './shared/wrapped-icon/wrapped-icon.component';
import { UserMenuComponent } from './sys-admin/components/user-menu/user-menu.component';
import { AuthDataDto } from '../../../../api-dto/auth-data-dto';
import { ExportToastComponent } from './components/export-toast/export-toast.component';
import { ErrorMessageDisplayComponent } from './shared/components/error-message-display/error-message-display.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, MatSlideToggleModule, MatProgressSpinner, RouterLink, TranslateModule, MatTooltip, MatButton, UserMenuComponent, WrappedIconComponent, ExportToastComponent, ErrorMessageDisplayComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  providers: [AuthService]
})
export class AppComponent implements OnInit, OnDestroy {
  appService = inject(AppService);
  authService = inject(AuthService);
  backendService = inject(BackendService);
  url = inject(LocationStrategy);
  route = inject(ActivatedRoute);
  location = inject(Location);
  private router = inject(Router);

  title = 'IQB-Kodierbox';
  isLoggedIn: boolean = false;
  errorMessage = '';
  authData: AuthDataDto = AppService.defaultAuthData;
  currentWorkspaceName = '';
  private routerSubscription: Subscription | null = null;

  constructor() {
    this.appService.authData$.subscribe(authData => {
      this.authData = authData;
      this.updateCurrentWorkspaceName();
    });

    this.routerSubscription = this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe(() => {
        this.updateCurrentWorkspaceName();
      });
  }

  private updateCurrentWorkspaceName(): void {
    const workspaceId = this.getWorkspaceIdFromUrl();
    if (workspaceId > 0 && this.authData.workspaces) {
      const workspace = this.authData.workspaces.find(ws => ws.id === workspaceId);
      this.currentWorkspaceName = workspace?.name || '';
    } else {
      this.currentWorkspaceName = '';
    }
  }

  private getWorkspaceIdFromUrl(): number {
    const url = this.router.url;
    const match = url.match(/workspace-admin\/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  ngOnDestroy(): void {
    this.routerSubscription?.unsubscribe();
  }

  async backendLogin(): Promise<void> {
    this.errorMessage = '';
    this.appService.errorMessagesDisabled = true;
    if (this.authService.isLoggedIn()) {
      try {
        this.appService.authData = await firstValueFrom(this.backendService.getAuthData());
      } catch (error) {
        if (!this.authService.hasValidToken()) {
          this.authService.login();
        }
      }
      return;
    }

    this.authService.login();
    this.appService.oidcLogin(user).subscribe(success => {
      if (success) {
        this.appService.setNeedsReAuthentication(false);
      }
    });
  }

  async ngOnInit(): Promise<void> {
    await this.handleAuthCallback();

    if (this.authService.isLoggedIn()) {
      this.setAuthState();

      const userProfile = await this.authService.loadUserProfile();
      const isAdmin = this.authService.getRoles().includes('admin');

      if (this.isValidUserProfile(userProfile)) {
        this.appService.user = this.createUser(userProfile, isAdmin);
        await this.backendLogin();
      }
    }

    window.addEventListener('message', event => {
      this.appService.processMessagePost(event);
    }, false);
  }

  private setAuthState(): void {
    this.isLoggedIn = true;
    this.appService.isLoggedIn = true;
    this.appService.loggedUser = this.authService.getLoggedUser();
  }

  private isValidUserProfile(userProfile: UserProfile): boolean {
    return !!userProfile?.id && !!userProfile?.username;
  }

  private createUser(userProfile: UserProfile, isAdmin: boolean): CreateUserDto {
    return {
      issuer: this.appService.loggedUser?.sub || '',
      identity: userProfile.id || '',
      username: userProfile.username || '',
      lastName: userProfile.lastName || '',
      firstName: userProfile.firstName || '',
      email: userProfile.email || '',
      isAdmin: isAdmin
    };
  }

  private async handleAuthCallback(): Promise<void> {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const token = urlParams.get('token');
      const idToken = urlParams.get('id_token');
      const refreshToken = urlParams.get('refresh_token');

      if (token) {
        this.authService.setToken(token);

        if (idToken) {
          this.authService.setIdToken(idToken);
        }

        if (refreshToken) {
          this.authService.setRefreshToken(refreshToken);
        }

        urlParams.delete('token');
        urlParams.delete('id_token');
        urlParams.delete('refresh_token');

        // Update the URL without the token parameters
        const newUrl = urlParams.toString() ?
          `${window.location.pathname}?${urlParams.toString()}` :
          window.location.pathname;

        this.location.replaceState(newUrl);
      }
    } catch (error) {
      this.authService.login();
    }
  }
}
