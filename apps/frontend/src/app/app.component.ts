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
import { LocationStrategy, Location } from '@angular/common';
import { Subscription, filter } from 'rxjs';
import { AppService } from './core/services/app.service';
import { AuthService } from './core/services/auth.service';
import { AuthDataDto } from '../../../../api-dto/auth-data-dto';

import { WrappedIconComponent } from './shared/wrapped-icon/wrapped-icon.component';
import { UserMenuComponent } from './sys-admin/components/user-menu/user-menu.component';
import { ExportToastComponent } from './components/export-toast/export-toast.component';
import { ErrorMessageDisplayComponent } from './shared/components/error-message-display/error-message-display.component';

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
  styleUrl: './app.component.scss',
  providers: [AuthService]
})
export class AppComponent implements OnInit, OnDestroy {
  appService = inject(AppService);
  authService = inject(AuthService);

  url = inject(LocationStrategy);
  location = inject(Location);
  private router = inject(Router);

  title = 'IQB-Kodierbox';
  isLoggedIn = false;
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

  async ngOnInit(): Promise<void> {
    await this.handleAuthCallback();

    if (this.authService.isLoggedIn()) {
      this.setAuthState();
      this.appService.loggedUser = this.authService.getLoggedUser();
      this.appService.refreshAuthData();
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
