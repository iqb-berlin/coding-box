import {
  Component, DestroyRef, Input, inject, signal
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
  @Input() workspaces!: WorkspaceFullDto[];
  @Input() authBootstrapStatus: AuthBootstrapStatus = 'checking';
  @Input() authDataLoaded = false;
  readonly authDataReloadRunning = signal(false);

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
