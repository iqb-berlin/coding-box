import {
  Component, OnInit, OnDestroy, DestroyRef, computed, effect, inject, signal, untracked, ChangeDetectionStrategy
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  Router, RouterLink, RouterOutlet, NavigationEnd
} from '@angular/router';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatButton } from '@angular/material/button';
import { LocationStrategy } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { filter, firstValueFrom } from 'rxjs';
import { MatSnackBar, MatSnackBarRef, TextOnlySnackBar } from '@angular/material/snack-bar';
import { AppService } from './core/services/app.service';
import { AuthService } from './core/services/auth.service';
import { AuthRefreshUnavailableError } from './core/interceptors/auth-refresh-unavailable.error';
import { AuthSessionState } from './core/services/auth-session-state.service';

import { WrappedIconComponent } from './shared/wrapped-icon/wrapped-icon.component';
import { UserMenuComponent } from './sys-admin/components/user-menu/user-menu.component';
import { ExportToastComponent } from './components/export-toast/export-toast.component';
import { ErrorMessageDisplayComponent } from './shared/components/error-message-display/error-message-display.component';
import { hasAdminBypass } from './core/guards/admin-access';
import { AuthSessionActivityService } from './core/services/auth-session-activity.service';
import { SystemNotificationBannerComponent } from './components/system-notification-banner/system-notification-banner.component';
import { SystemNotificationService } from './core/services/system-notification.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-root',
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
    ErrorMessageDisplayComponent,
    SystemNotificationBannerComponent
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit, OnDestroy {
  protected appService = inject(AppService);
  protected authService = inject(AuthService);

  protected url = inject(LocationStrategy);
  private router = inject(Router);
  private authSessionActivity = inject(AuthSessionActivityService);
  private systemNotifications = inject(SystemNotificationService);
  private readonly session = inject(AuthSessionState);

  title = 'IQB-Kodierbox';
  readonly isLoggedIn = this.session.isLoggedIn;
  readonly errorMessage = signal('');
  readonly authData = toSignal(this.appService.authData$, { initialValue: AppService.defaultAuthData });
  private readonly navigationEnd = toSignal(this.router.events.pipe(filter(event => event instanceof NavigationEnd)));
  protected readonly currentWorkspaceName = computed(() => {
    this.navigationEnd();
    const workspaceId = this.getWorkspaceIdFromUrl();
    return workspaceId > 0 ? this.authData().workspaces?.find(workspace => workspace.id === workspaceId)?.name || '' : '';
  });

  private readonly destroyRef = inject(DestroyRef);
  private readonly snackBar = inject(MatSnackBar);
  private authDataFailureSnackBar?: MatSnackBarRef<TextOnlySnackBar>;

  constructor() {
    effect(() => {
      if (this.appService.authBootstrapStatus === 'ready') {
        this.authDataFailureSnackBar?.dismiss();
        this.authDataFailureSnackBar = undefined;
      }
    });

    effect(() => {
      const sessionActive = this.authService.isLoggedIn() && !this.appService.needsReAuthentication;
      untracked(() => {
        if (sessionActive) {
          this.authSessionActivity.start();
        } else {
          this.authSessionActivity.restart();
        }
      });
    });
  }

  async loadAuthData(identity: string): Promise<boolean> {
    this.errorMessage.set('');
    this.appService.errorMessagesDisabled = true;

    try {
      const success = await firstValueFrom(this.appService.loadAuthenticatedUser(identity));
      if (success) {
        this.snackBar.dismiss();
      } else {
        this.authDataFailureSnackBar = this.snackBar.open(
          'Ihre Anmeldung wurde erkannt, aber die Sitzungsdaten konnten nicht geladen werden. Bitte laden Sie die Seite neu oder melden Sie sich erneut an.',
          'Schließen',
          {
            duration: 8000,
            panelClass: ['snackbar-error']
          }
        );
      }
      return success;
    } finally {
      this.appService.errorMessagesDisabled = false;
    }
  }

  async ngOnInit(): Promise<void> {
    this.authService.authenticationRecovered$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.appService.authBootstrapStatus === 'checking' || this.appService.authBootstrapStatus === 'backend-login-running') return;
        this.handleAuthenticationRestored().catch(() => undefined);
      });
    this.systemNotifications.startPolling();
    await this.handleAuthCallback();
    let refreshUnavailable = false;
    const activeToken = await this.authService.getValidToken(0).catch(error => {
      if (!(error instanceof AuthRefreshUnavailableError)) throw error;
      refreshUnavailable = true;
      this.appService.setAuthBootstrapStatus('refresh-unavailable');
      return undefined;
    });

    if (activeToken) {
      this.setAuthState();
      await this.loadAuthData(this.session.loggedUser()?.sub || '');
    } else if (!refreshUnavailable) {
      this.appService.setAuthBootstrapStatus('ready');
    }

    // The callback has already replaced the URL with the validated return
    // route. Starting earlier races replay requests against the token exchange.
    this.router.initialNavigation();

    window.addEventListener('message', event => {
      this.appService.processMessagePost(event);
    }, false);
  }

  ngOnDestroy(): void {
    this.authSessionActivity.stop();
    this.systemNotifications.stopPolling();
  }

  protected async handleAuthenticationRestored(): Promise<void> {
    if (this.isLoggedIn() && (this.appService.authProviderFailure || this.appService.authBootstrapStatus === 'auth-data-failed')) {
      this.setAuthState();
      await firstValueFrom(this.appService.retryAuthDataLoad());
      return;
    }
    if (this.isLoggedIn() && this.appService.authBootstrapStatus === 'ready') {
      this.appService.completeBackendLogin();
      return;
    }
    this.setAuthState();
    await this.loadAuthData(this.session.loggedUser()?.sub || '');
  }

  private getWorkspaceIdFromUrl(): number {
    const url = this.router.url;
    const match = url.match(/workspace-admin\/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  private setAuthState(): void {
    this.session.establish(this.authService.getLoggedUser());
  }

  private async handleAuthCallback(): Promise<string | undefined> {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const authCode = urlParams.get('auth_code');

      if (urlParams.get('error') === 'authentication_failed') {
        this.appService.markLoginFailed(urlParams.get('auth_error'), urlParams.get('request_id'));
        this.removeAuthCallbackParams();
        return undefined;
      }

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
    } catch (error) {
      let code: unknown;
      if (error instanceof HttpErrorResponse) {
        const unavailable = [0, 408, 429, 500, 502, 503, 504].includes(error.status);
        code = error.error?.code || (unavailable ? 'provider-unavailable' : 'session-invalid');
      }
      this.appService.markLoginFailed(code, error instanceof HttpErrorResponse ? error.headers.get('X-Request-Id') : undefined);
      this.removeAuthCallbackParams();
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
    ['auth_code', 'token', 'id_token', 'refresh_token', 'error', 'auth_error', 'request_id'].forEach(param => url.searchParams.delete(param));
    if (postLoginReturnUrl) {
      url.hash = postLoginReturnUrl;
    }

    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`
    );
  }

  protected isAdminUser(): boolean {
    return hasAdminBypass(this.authService.getRoles(), this.authData().isAdmin);
  }
}
