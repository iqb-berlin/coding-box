import {
  Component, inject, signal, output, ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { AuthService } from '../../../core/services/auth.service';
import { AuthRefreshUnavailableError } from '../../../core/interceptors/auth-refresh-unavailable.error';
import {
  AppHttpError,
  AppHttpErrorRequest
} from '../../../core/interceptors/app-http-error.class';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-error-message-display',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, TranslateModule],
  templateUrl: './error-message-display.component.html',
  styleUrls: ['./error-message-display.component.scss']
})
export class ErrorMessageDisplayComponent {
  readonly authenticationRestored = output<void>();
  protected readonly retryingAuthentication = signal(false);
  protected appService: AppService = inject(AppService);
  authService = inject(AuthService);
  private router = inject(Router);
  private readonly routeUrl = toSignal(this.router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    map(event => event.urlAfterRedirects)
  ), { initialValue: this.router.url });

  readonly expandedErrorIds = signal(new Set<number>());

  protected get showGlobalReAuthenticationMessage(): boolean {
    return this.appService.needsReAuthentication && !this.isHomeRoute();
  }

  protected get showSessionExpiryWarning(): boolean {
    return this.appService.sessionExpiryWarning &&
      !this.appService.needsReAuthentication &&
      !this.isHomeRoute();
  }

  protected dismissError(errorId: number): void {
    this.appService.errorMessages = this.appService.errorMessages.filter((e: AppHttpError) => e.id !== errorId);
    this.expandedErrorIds.update(value => {
      const next = new Set(value);
      next.delete(errorId);
      return next;
    });
  }

  protected dismissBackendUnavailable(): void {
    this.appService.setBackendUnavailable(false);
  }

  handleLogin(): void {
    this.authService.login(this.appService.reAuthenticationReturnUrl);
  }

  async handleExtendSession(): Promise<void> {
    const generation = this.authService.getSessionGeneration();
    const refreshToken = this.authService.getRefreshToken();
    const requireCurrentSessionReauthentication = () => {
      if (generation === this.authService.getSessionGeneration() && refreshToken === this.authService.getRefreshToken()) {
        this.appService.requireReAuthentication(this.router.url);
      }
    };
    try {
      const token = await this.authService.getValidToken(-1);
      if (!token) {
        requireCurrentSessionReauthentication();
        return;
      }
      if (generation === this.authService.getSessionGeneration()) this.appService.setSessionExpiryWarning(false);
    } catch (error) {
      if (!(error instanceof AuthRefreshUnavailableError)) requireCurrentSessionReauthentication();
    }
  }

  protected async retryAuthentication(): Promise<void> {
    if (this.retryingAuthentication() || this.appService.authBootstrapStatus === 'backend-login-running') return;
    const generation = this.authService.getSessionGeneration();
    const refreshRecoveryPending = this.authService.refreshFailure() !== null;
    this.retryingAuthentication.set(true);
    try {
      const token = await this.authService.getValidToken();
      if (token && generation === this.authService.getSessionGeneration() && !refreshRecoveryPending) {
        this.authenticationRestored.emit();
      }
    } catch {
      // AuthService owns error classification and preserves a newer session.
    } finally {
      this.retryingAuthentication.set(false);
    }
  }

  toggleErrorDetails(errorId: number): void {
    if (this.expandedErrorIds().has(errorId)) {
      this.expandedErrorIds.update(value => {
        const next = new Set(value);
        next.delete(errorId);
        return next;
      });
      return;
    }

    this.expandedErrorIds.update(value => {
      const next = new Set(value);
      next.add(errorId);
      return next;
    });
  }

  protected isErrorDetailsExpanded(errorId: number): boolean {
    return this.expandedErrorIds().has(errorId);
  }

  protected hasErrorDetails(error: AppHttpError): boolean {
    return this.hasRequestId(error) ||
      this.hasHttpStatus(error) ||
      this.hasTechnicalMessage(error) ||
      this.getAffectedRequests(error).length > 0;
  }

  protected hasRequestId(error: AppHttpError): boolean {
    return !!error.requestId?.trim();
  }

  protected hasHttpStatus(error: AppHttpError): boolean {
    return Number.isFinite(error.status);
  }

  protected hasTechnicalMessage(error: AppHttpError): boolean {
    return !!error.technicalMessage?.trim() &&
      error.technicalMessage.trim() !== this.getDisplayMessage(error).trim();
  }

  protected getDisplayMessage(error: AppHttpError): string {
    return error.userMessage || error.message;
  }

  protected shouldShowAffectedRequestId(error: AppHttpError, request: AppHttpErrorRequest): boolean {
    const requestId = request.requestId?.trim();

    return !!requestId &&
      (requestId !== error.requestId?.trim() || this.getAffectedRequests(error).length > 1);
  }

  protected getAffectedRequests(error: AppHttpError): AppHttpErrorRequest[] {
    if (error.affectedRequests?.length) {
      return error.affectedRequests;
    }

    if (error.method || error.urlWithParams) {
      return [{
        method: error.method,
        urlWithParams: error.urlWithParams,
        requestId: error.requestId?.trim() || undefined
      }];
    }

    return [];
  }

  private isHomeRoute(): boolean {
    const url = this.routeUrl();
    return url === '/home' || url.startsWith('/home?');
  }
}
