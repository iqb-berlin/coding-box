import { Component, Input, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { RouterLink } from '@angular/router';
import { MatAnchor, MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { WorkspaceFullDto } from '../../../../../../../api-dto/workspaces/workspace-full-dto';
import { AuthService } from '../../../core/services/auth.service';
import { AppService, AuthBootstrapStatus } from '../../../core/services/app.service';

@Component({
  selector: 'coding-book-user-workspaces',
  templateUrl: './user-workspaces.component.html',
  styleUrls: ['./user-workspaces.component.scss'],
  imports: [MatAnchor, RouterLink, TranslateModule, MatButton, MatIcon, MatProgressSpinner]
})

export class UserWorkspacesComponent {
  authService = inject(AuthService);
  appService = inject(AppService);
  @Input() workspaces!: WorkspaceFullDto[];
  @Input() authBootstrapStatus: AuthBootstrapStatus = 'checking';
  @Input() authDataLoaded = false;
  authDataReloadRunning = false;

  get showLoading(): boolean {
    return this.authService.isLoggedIn() === true &&
      !this.authDataLoaded &&
      (this.authBootstrapStatus === 'checking' || this.authBootstrapStatus === 'backend-login-running');
  }

  get showSessionExpired(): boolean {
    return this.authService.isLoggedIn() === true &&
      !this.authDataLoaded &&
      this.authBootstrapStatus === 'session-expired';
  }

  get showAuthDataError(): boolean {
    return this.authService.isLoggedIn() === true &&
      !this.authDataLoaded &&
      (this.authBootstrapStatus === 'auth-data-failed' || this.authBootstrapStatus === 'ready');
  }

  get showEmptyWorkspaces(): boolean {
    return this.authService.isLoggedIn() === true &&
      this.authDataLoaded &&
      (this.workspaces || []).length === 0;
  }

  reloadAuthData(): void {
    if (this.authDataReloadRunning) {
      return;
    }

    this.authDataReloadRunning = true;
    this.appService.retryAuthDataLoad().subscribe({
      error: () => {
        this.authDataReloadRunning = false;
      },
      complete: () => {
        this.authDataReloadRunning = false;
      }
    });
  }

  login(): void {
    this.authService.login(this.appService.reAuthenticationReturnUrl);
  }
}
