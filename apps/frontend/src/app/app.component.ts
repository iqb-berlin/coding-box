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
import { KeycloakProfile } from 'keycloak-js';
import { Subscription, filter } from 'rxjs';
import { AppService } from './services/app.service';
import { AuthService } from './core/services/auth.service';
import { CreateUserDto } from '../../../../api-dto/user/create-user-dto';
import { BackendService } from './services/backend.service';
import { WrappedIconComponent } from './shared/wrapped-icon/wrapped-icon.component';
import { UserMenuComponent } from './sys-admin/components/user-menu/user-menu.component';
import { AuthDataDto } from '../../../../api-dto/auth-data-dto';
import { ExportToastComponent } from './components/export-toast/export-toast.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, MatSlideToggleModule, MatProgressSpinner, RouterLink, TranslateModule, MatTooltip, MatButton, UserMenuComponent, WrappedIconComponent, ExportToastComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  providers: [AuthService]
})
export class AppComponent implements OnInit, OnDestroy {
  appService = inject(AppService);
  authService = inject(AuthService);
  backendService = inject(BackendService);
  url = inject(LocationStrategy);
  private router = inject(Router);

  title = 'IQB-Kodierbox';
  loggedInKeycloak: boolean = false;
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

  async keycloakLogin(user: CreateUserDto): Promise<void> {
    this.errorMessage = '';
    this.appService.errorMessagesDisabled = true;
    this.appService.keycloakLogin(user).subscribe(() => {
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
