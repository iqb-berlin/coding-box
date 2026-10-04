import {
  Component, DestroyRef, inject, signal, input
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
  private readonly destroyRef = inject(DestroyRef);
  authService = inject(AuthService);
  appService = inject(AppService);
  readonly workspaces = input<WorkspaceFullDto[]>([]);
  readonly authBootstrapStatus = input<AuthBootstrapStatus>('checking');
  readonly authDataLoaded = input(false);
  readonly authDataReloadRunning = signal(false);

  get showLoading(): boolean {
    const authBootstrapStatus = this.authBootstrapStatus();
    return this.authService.isLoggedIn() === true &&
      !this.authDataLoaded() &&
      (authBootstrapStatus === 'checking' || authBootstrapStatus === 'backend-login-running');
  }

  get showSessionExpired(): boolean {
    return this.authService.isLoggedIn() === true &&
      !this.authDataLoaded() &&
      this.authBootstrapStatus() === 'session-expired';
  }

  get showAuthDataError(): boolean {
    const authBootstrapStatus = this.authBootstrapStatus();
    return this.authService.isLoggedIn() === true &&
      !this.authDataLoaded() &&
      (authBootstrapStatus === 'auth-data-failed' || authBootstrapStatus === 'ready');
  }

  get showEmptyWorkspaces(): boolean {
    return this.authService.isLoggedIn() === true &&
      this.authDataLoaded() &&
      (this.workspaces() || []).length === 0;
  }

  reloadAuthData(): void {
    if (this.authDataReloadRunning()) {
      return;
    }

    this.authDataReloadRunning.set(true);
    this.appService.retryAuthDataLoad()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
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
