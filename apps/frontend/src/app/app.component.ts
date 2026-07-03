import {
  Component, OnInit, OnDestroy, inject
} from '@angular/core';
import {
  Router, RouterLink, RouterOutlet, NavigationEnd
} from '@angular/router';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatButton } from '@angular/material/button';
import { LocationStrategy } from '@angular/common';
import { Subscription, filter, firstValueFrom } from 'rxjs';
import { AppService } from './core/services/app.service';
import { AuthService } from './core/services/auth.service';
import { AuthDataDto } from '../../../../api-dto/auth-data-dto';

import { WrappedIconComponent } from './shared/wrapped-icon/wrapped-icon.component';
import { UserMenuComponent } from './sys-admin/components/user-menu/user-menu.component';
import { ExportToastComponent } from './components/export-toast/export-toast.component';
import { ErrorMessageDisplayComponent } from './shared/components/error-message-display/error-message-display.component';
import { hasAdminBypass } from './core/guards/admin-access';
import { AuthSessionActivityService } from './core/services/auth-session-activity.service';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    MatSlideToggleModule,
    MatProgressSpinner,
    RouterLink,
    TranslateModule,
    MatTooltip,
    MatButton,
    UserMenuComponent,
    WrappedIconComponent,
    ExportToastComponent,
    ErrorMessageDisplayComponent
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit, OnDestroy {
  appService = inject(AppService);
  authService = inject(AuthService);

  url = inject(LocationStrategy);
  private router = inject(Router);
  private authSessionActivity = inject(AuthSessionActivityService);

  title = 'IQB-Kodierbox';
  isLoggedIn = false;
  errorMessage = '';
  authData: AuthDataDto = AppService.defaultAuthData;
  currentWorkspaceName = '';
  private routerSubscription: Subscription | null = null;
  private authDataSubscription: Subscription | null = null;

  constructor() {
    this.authDataSubscription = this.appService.authData$.subscribe(authData => {
      this.authData = authData;
      this.updateCurrentWorkspaceName();
    });

    this.routerSubscription = this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe(() => {
        this.updateCurrentWorkspaceName();
      });
  }

  async ngOnInit(): Promise<void> {
    const postLoginReturnUrl = await this.handleAuthCallback();

    if (this.authService.isLoggedIn()) {
      this.setAuthState();
      this.appService.refreshAuthData();
      this.authSessionActivity.start();
      if (postLoginReturnUrl) {
        this.router.navigateByUrl(postLoginReturnUrl).catch(() => undefined);
      }
    } else {
      this.appService.setAuthBootstrapStatus('ready');
    }

    window.addEventListener('message', event => {
      this.appService.processMessagePost(event);
    }, false);
  }

  ngOnDestroy(): void {
    this.routerSubscription?.unsubscribe();
    this.authDataSubscription?.unsubscribe();
    this.authSessionActivity.stop();
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

  private setAuthState(): void {
    this.isLoggedIn = true;
    this.appService.isLoggedIn = true;
    this.appService.loggedUser = this.authService.getLoggedUser();
  }

  private async handleAuthCallback(): Promise<string | undefined> {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const authCode = urlParams.get('auth_code');

      const hasLegacyTokenParams = urlParams.has('token') || urlParams.has('id_token') || urlParams.has('refresh_token');

      if (authCode) {
        const tokenResponse = await firstValueFrom(this.authService.exchangeLoginCode(authCode));
        this.authService.setToken(tokenResponse.access_token);

        if (tokenResponse.id_token) {
          this.authService.setIdToken(tokenResponse.id_token);
        }

        if (tokenResponse.refresh_token) {
          this.authService.setRefreshToken(tokenResponse.refresh_token);
        }

        const postLoginReturnUrl = this.getPostLoginReturnUrl();
        this.removeAuthCallbackParams(postLoginReturnUrl);
        return postLoginReturnUrl;
      }
      if (hasLegacyTokenParams) {
        this.removeAuthCallbackParams();
      }
    } catch {
      this.authService.login();
    }
    return undefined;
  }

  private getPostLoginReturnUrl(): string | undefined {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
    const queryStart = hash.indexOf('?');
    if (queryStart < 0) {
      return undefined;
    }

    const hashParams = new URLSearchParams(hash.slice(queryStart + 1));
    return this.appService.normalizeInternalRoute(hashParams.get('returnUrl') || undefined);
  }

  private removeAuthCallbackParams(postLoginReturnUrl?: string): void {
    const url = new URL(window.location.href);
    ['auth_code', 'token', 'id_token', 'refresh_token'].forEach(param => url.searchParams.delete(param));
    if (postLoginReturnUrl) {
      url.hash = postLoginReturnUrl;
    }

    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`
    );
  }

  isAdminUser(): boolean {
    return hasAdminBypass(this.authService.getRoles(), this.authData.isAdmin);
  }
}
