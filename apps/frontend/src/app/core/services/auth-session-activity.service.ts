import {
  Injectable, NgZone, OnDestroy, inject
} from '@angular/core';
import { Router } from '@angular/router';
import { AppService } from './app.service';
import { AuthService } from './auth.service';
import {
  AUTH_SESSION_IDLE_TIMEOUT_MS,
  AUTH_SESSION_WARNING_DELAY_MS
} from './auth-session.config';

@Injectable({
  providedIn: 'root'
})
export class AuthSessionActivityService implements OnDestroy {
  private readonly authService = inject(AuthService);
  private readonly appService = inject(AppService);
  private readonly router = inject(Router);
  private readonly ngZone = inject(NgZone);
  private readonly activityEvents = ['mousemove', 'touchstart', 'keydown', 'click', 'scroll'];
  private readonly cleanupActivityListeners: (() => void)[] = [];
  private warningTimeoutId?: ReturnType<typeof setTimeout>;
  private expiryTimeoutId?: ReturnType<typeof setTimeout>;
  private started = false;

  start(): void {
    if (this.started) {
      this.restart();
      return;
    }

    this.started = true;
    this.registerActivityListeners();
    this.restart();
  }

  restart(): void {
    this.clearTimers();
    this.appService.setSessionExpiryWarning(false);

    if (!this.isAuthenticatedSession()) {
      return;
    }

    this.ngZone.runOutsideAngular(() => {
      this.warningTimeoutId = setTimeout(() => this.showWarning(), AUTH_SESSION_WARNING_DELAY_MS);
      this.expiryTimeoutId = setTimeout(() => this.expireSession(), AUTH_SESSION_IDLE_TIMEOUT_MS);
    });
  }

  stop(): void {
    this.started = false;
    this.clearTimers();
    while (this.cleanupActivityListeners.length) {
      this.cleanupActivityListeners.pop()?.();
    }
    this.appService.setSessionExpiryWarning(false);
  }

  ngOnDestroy(): void {
    this.stop();
  }

  private registerActivityListeners(): void {
    this.ngZone.runOutsideAngular(() => {
      this.activityEvents.forEach(eventName => {
        const listener = () => this.handleActivity();
        window.addEventListener(eventName, listener, { passive: true });
        this.cleanupActivityListeners.push(() => window.removeEventListener(eventName, listener));
      });
    });
  }

  private handleActivity(): void {
    if (!this.isAuthenticatedSession()) {
      this.restart();
      return;
    }

    const warningWasVisible = this.appService.sessionExpiryWarning;
    this.restart();

    if (warningWasVisible && !this.authService.hasValidToken()) {
      this.expireSession();
    }
  }

  private showWarning(): void {
    if (!this.isAuthenticatedSession()) {
      return;
    }

    this.ngZone.run(() => this.appService.setSessionExpiryWarning(true));
  }

  private expireSession(): void {
    if (!this.isAuthenticatedSession()) {
      this.restart();
      return;
    }

    this.ngZone.run(() => {
      this.clearTimers();
      this.appService.setSessionExpiryWarning(false);
      this.appService.requireReAuthentication(this.router.url);
    });
  }

  private isAuthenticatedSession(): boolean {
    return this.authService.isLoggedIn() && !this.appService.needsReAuthentication;
  }

  private clearTimers(): void {
    if (this.warningTimeoutId) {
      clearTimeout(this.warningTimeoutId);
      this.warningTimeoutId = undefined;
    }

    if (this.expiryTimeoutId) {
      clearTimeout(this.expiryTimeoutId);
      this.expiryTimeoutId = undefined;
    }
  }
}
