import {
  Component, OnInit, OnDestroy, effect, inject
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
import { KeycloakProfile } from 'keycloak-js';
import { KEYCLOAK_EVENT_SIGNAL } from 'keycloak-angular';
import { Subscription, filter, firstValueFrom } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppService } from './core/services/app.service';
import { AuthService } from './core/services/auth.service';

import { WrappedIconComponent } from './shared/wrapped-icon/wrapped-icon.component';
import { UserMenuComponent } from './sys-admin/components/user-menu/user-menu.component';
import { AuthDataDto } from '../../../../api-dto/auth-data-dto';
import { ExportToastComponent } from './components/export-toast/export-toast.component';
import { ErrorMessageDisplayComponent } from './shared/components/error-message-display/error-message-display.component';
import { handleKeycloakSessionEvent } from './core/services/keycloak-session-events';
import { hasAdminBypass } from './core/guards/admin-access';
import { AuthSessionActivityService } from './core/services/auth-session-activity.service';

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

  url = inject(LocationStrategy);
  private router = inject(Router);
  private keycloakEvent = inject(KEYCLOAK_EVENT_SIGNAL);
  private snackBar = inject(MatSnackBar);
  private authSessionActivity = inject(AuthSessionActivityService);

  title = 'IQB-Kodierbox';
  loggedInKeycloak: boolean = false;
  errorMessage = '';
  authData: AuthDataDto = AppService.defaultAuthData;
  currentWorkspaceName = '';
  private routerSubscription: Subscription | null = null;

  constructor() {
    effect(() => {
      handleKeycloakSessionEvent(this.keycloakEvent(), this.appService, this.router);
      if (this.authService.isLoggedIn() && !this.appService.needsReAuthentication) {
        this.authSessionActivity.start();
      } else {
        this.authSessionActivity.restart();
      }
    });

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
    this.authSessionActivity.stop();
  }

  async loadAuthData(identity: string): Promise<boolean> {
    this.errorMessage = '';
    this.appService.errorMessagesDisabled = true;

    try {
      const success = await firstValueFrom(this.appService.loadAuthenticatedUser(identity));
      if (success) {
        this.snackBar.dismiss();
      } else {
        this.snackBar.open(
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
    if (this.authService.isLoggedIn()) {
      this.setAuthState();

      try {
        const keycloakUserProfile = await this.authService.loadUserProfile();
        this.appService.userProfile = keycloakUserProfile;
        const identity = this.authService.getIdentity();

        if (this.isValidUserProfile(keycloakUserProfile) && identity) {
          this.appService.keycloakIdentity = identity;
          await this.loadAuthData(identity);
        } else {
          this.appService.markAuthDataFailed();
        }
      } catch {
        this.appService.requireReAuthentication(this.router.url);
      }
    } else {
      this.appService.setAuthBootstrapStatus('ready');
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

  isAdminUser(): boolean {
    return hasAdminBypass(this.authService.getRoles(), this.authData.isAdmin);
  }
}
