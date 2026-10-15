import {
  ChangeDetectionStrategy, Component, Input, inject, signal
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { RouterLink } from '@angular/router';
import { MatAnchor, MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { WorkspaceFullDto } from '../../../../../../../api-dto/workspaces/workspace-full-dto';
import { AuthService } from '../../../core/services/auth.service';
import { AppService, AuthBootstrapStatus } from '../../../core/services/app.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-user-workspaces',
  templateUrl: './user-workspaces.component.html',
  styleUrls: ['./user-workspaces.component.scss'],
  imports: [MatAnchor, RouterLink, TranslateModule, MatButton, MatIcon, MatProgressSpinner]
})

export class UserWorkspacesComponent {
  protected authService = inject(AuthService);
  protected appService = inject(AppService);
  @Input() workspaces!: WorkspaceFullDto[];
  @Input() authBootstrapStatus: AuthBootstrapStatus = 'checking';
  @Input() authDataLoaded = false;
  protected readonly authDataReloadRunning = signal(false);

  protected get showLoading(): boolean {
    return this.authService.isLoggedIn() === true &&
      !this.authDataLoaded &&
      (this.authBootstrapStatus === 'checking' || this.authBootstrapStatus === 'backend-login-running');
  }

  protected get showSessionExpired(): boolean {
    return this.authService.isLoggedIn() === true &&
      !this.authDataLoaded &&
      this.authBootstrapStatus === 'session-expired';
  }

  protected get showAuthDataError(): boolean {
    return this.authService.isLoggedIn() === true &&
      !this.authDataLoaded &&
      (this.authBootstrapStatus === 'auth-data-failed' || this.authBootstrapStatus === 'ready');
  }

  protected get showEmptyWorkspaces(): boolean {
    return this.authService.isLoggedIn() === true &&
      this.authDataLoaded &&
      (this.workspaces || []).length === 0;
  }

  reloadAuthData(): void {
    if (this.authDataReloadRunning()) {
      return;
    }

    this.authDataReloadRunning.set(true);
    this.appService.retryAuthDataLoad().subscribe({
      error: () => {
        this.authDataReloadRunning.set(false);
      },
      complete: () => {
        this.authDataReloadRunning.set(false);
      }
    });
  }

  login(): void {
    this.authService.login(this.appService.reAuthenticationReturnUrl);
  }
}
