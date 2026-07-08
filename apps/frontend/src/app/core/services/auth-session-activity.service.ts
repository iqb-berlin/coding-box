import {
  Injectable, NgZone, OnDestroy, inject
} from '@angular/core';
import { Router } from '@angular/router';
import Keycloak from 'keycloak-js';
import { AppService } from './app.service';
import {
  DEFAULT_AUTH_SESSION_IDLE_TIMEOUT_MINUTES,
  AUTH_SESSION_IDLE_TIMEOUT_MS,
  getAuthSessionWarningDelayMs
} from './auth-session.config';
import { WorkspaceSettingsService } from '../../ws-admin/services/workspace-settings.service';

@Injectable({
  providedIn: 'root'
})
export class AuthSessionActivityService implements OnDestroy {
  private readonly keycloak = inject(Keycloak);
  private readonly appService = inject(AppService);
  private readonly workspaceSettingsService = inject(WorkspaceSettingsService);
  private readonly router = inject(Router);
  private readonly ngZone = inject(NgZone);
  private readonly activityEvents = ['mousemove', 'touchstart', 'keydown', 'click', 'scroll'];
  private readonly activityStorageKey = 'coding-box-auth-session-activity';
  private readonly activityChannelName = 'coding-box-auth-session';
  private readonly activityBroadcastIntervalMs = 1000;
  private readonly tabId = Math.random().toString(36).slice(2);
  private readonly cleanupActivityListeners: (() => void)[] = [];
  private activityChannel?: BroadcastChannel;
  private warningTimeoutId?: ReturnType<typeof setTimeout>;
  private expiryTimeoutId?: ReturnType<typeof setTimeout>;
  private lastActivityBroadcastAt = 0;
  private lastObservedExternalActivityAt = 0;
  private started = false;
  private idleTimeoutMs = AUTH_SESSION_IDLE_TIMEOUT_MS;
  private timeoutSettingsWorkspaceId: number | null = null;
  private timeoutSettingsRequestId = 0;

  start(): void {
    if (this.started) {
      this.restart();
      return;
    }

    this.started = true;
    this.registerActivityListeners();
    this.registerCrossTabActivityListeners();
    this.registerWorkspaceSelectionListeners();
    this.registerTimeoutSettingsListeners();
    this.restart();
  }

  restart(): void {
    this.clearTimers();
    this.appService.setSessionExpiryWarning(false);

    if (!this.isAuthenticatedSession()) {
      return;
    }

    this.scheduleTimers();
    this.refreshTimeoutSettingsForCurrentWorkspace();
  }

  private scheduleTimers(): void {
    this.ngZone.runOutsideAngular(() => {
      this.warningTimeoutId = setTimeout(
        () => this.showWarning(),
        getAuthSessionWarningDelayMs(this.idleTimeoutMs)
      );
      this.expiryTimeoutId = setTimeout(() => this.expireSession(), this.idleTimeoutMs);
    });
  }

  stop(): void {
    this.started = false;
    this.timeoutSettingsRequestId += 1;
    this.timeoutSettingsWorkspaceId = null;
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
    this.broadcastActivity();

    if (!this.isAuthenticatedSession()) {
      this.restart();
      return;
    }

    const warningWasVisible = this.appService.sessionExpiryWarning;
    this.restart();

    if (warningWasVisible) {
      this.keycloak.updateToken(-1).catch(() => this.expireSession());
    }
  }

  private registerCrossTabActivityListeners(): void {
    const storageListener = (event: StorageEvent) => {
      if (event.key === this.activityStorageKey) {
        this.handleActivityMessage(event.newValue);
      }
    };
    window.addEventListener('storage', storageListener);
    this.cleanupActivityListeners.push(() => window.removeEventListener('storage', storageListener));

    if (typeof BroadcastChannel === 'undefined') {
      return;
    }

    this.activityChannel = new BroadcastChannel(this.activityChannelName);
    this.activityChannel.onmessage = event => this.handleActivityMessage(event.data);
    this.cleanupActivityListeners.push(() => {
      this.activityChannel?.close();
      this.activityChannel = undefined;
    });
  }

  private registerTimeoutSettingsListeners(): void {
    const subscription =
      this.workspaceSettingsService.authSessionIdleTimeoutChanged$
        .subscribe(change => {
          if (change.workspaceId !== this.appService.selectedWorkspaceId) {
            return;
          }

          this.timeoutSettingsWorkspaceId = change.workspaceId;
          this.applyIdleTimeoutMinutes(change.timeoutMinutes);
        });
    this.cleanupActivityListeners.push(() => subscription.unsubscribe());
  }

  private registerWorkspaceSelectionListeners(): void {
    const subscription = this.appService.selectedWorkspaceId$
      .subscribe(() => this.handleWorkspaceSelectionChanged());
    this.cleanupActivityListeners.push(() => subscription.unsubscribe());
  }

  private handleWorkspaceSelectionChanged(): void {
    this.timeoutSettingsRequestId += 1;
    this.timeoutSettingsWorkspaceId = null;
    this.idleTimeoutMs = AUTH_SESSION_IDLE_TIMEOUT_MS;
    if (this.started) {
      this.restart();
    }
  }

  private broadcastActivity(): void {
    const now = Date.now();
    if (now - this.lastActivityBroadcastAt < this.activityBroadcastIntervalMs) {
      return;
    }
    this.lastActivityBroadcastAt = now;

    const message = {
      source: this.tabId,
      timestamp: now
    };

    try {
      localStorage.setItem(this.activityStorageKey, JSON.stringify(message));
    } catch {
      // Ignore storage errors; BroadcastChannel may still notify sibling tabs.
    }

    try {
      this.activityChannel?.postMessage(message);
    } catch {
      // Ignore browser channel errors.
    }
  }

  private handleActivityMessage(rawMessage: unknown): void {
    const message = typeof rawMessage === 'string' ?
      this.parseActivityMessage(rawMessage) :
      rawMessage as { source?: string; timestamp?: number } | null;
    if (!message || message.source === this.tabId || typeof message.timestamp !== 'number') {
      return;
    }
    if (message.timestamp <= this.lastObservedExternalActivityAt) {
      return;
    }
    this.lastObservedExternalActivityAt = message.timestamp;

    if (!this.isAuthenticatedSession()) {
      this.restart();
      return;
    }

    const warningWasVisible = this.appService.sessionExpiryWarning;
    this.restart();

    if (warningWasVisible) {
      this.keycloak.updateToken(-1).catch(() => this.expireSession());
    }
  }

  private parseActivityMessage(rawMessage: string): { source?: string; timestamp?: number } | null {
    try {
      return JSON.parse(rawMessage) as { source?: string; timestamp?: number };
    } catch {
      return null;
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
    return !!this.keycloak.authenticated && !this.appService.needsReAuthentication;
  }

  private refreshTimeoutSettingsForCurrentWorkspace(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.timeoutSettingsRequestId += 1;
      this.timeoutSettingsWorkspaceId = null;
      this.applyIdleTimeoutMinutes(DEFAULT_AUTH_SESSION_IDLE_TIMEOUT_MINUTES);
      return;
    }

    if (this.timeoutSettingsWorkspaceId === workspaceId) {
      return;
    }

    this.timeoutSettingsWorkspaceId = workspaceId;
    this.timeoutSettingsRequestId += 1;
    const requestId = this.timeoutSettingsRequestId;
    this.workspaceSettingsService
      .getAuthSessionIdleTimeoutMinutes(workspaceId)
      .subscribe({
        next: timeoutMinutes => {
          if (requestId === this.timeoutSettingsRequestId) {
            this.applyIdleTimeoutMinutes(timeoutMinutes);
          }
        },
        error: () => {
          if (requestId === this.timeoutSettingsRequestId) {
            this.applyIdleTimeoutMinutes(DEFAULT_AUTH_SESSION_IDLE_TIMEOUT_MINUTES);
          }
        }
      });
  }

  private applyIdleTimeoutMinutes(timeoutMinutes: number): void {
    const nextIdleTimeoutMs = timeoutMinutes * 60 * 1000;
    if (nextIdleTimeoutMs === this.idleTimeoutMs) {
      return;
    }

    this.idleTimeoutMs = nextIdleTimeoutMs;
    if (!this.started || !this.isAuthenticatedSession()) {
      return;
    }

    this.clearTimers();
    this.appService.setSessionExpiryWarning(false);
    this.scheduleTimers();
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
