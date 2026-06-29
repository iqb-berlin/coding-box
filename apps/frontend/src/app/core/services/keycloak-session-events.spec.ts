import { Router } from '@angular/router';
import {
  KeycloakEvent,
  KeycloakEventType
} from 'keycloak-angular';
import { AppService } from './app.service';
import { handleKeycloakSessionEvent } from './keycloak-session-events';

describe('handleKeycloakSessionEvent', () => {
  let appService: jest.Mocked<AppService>;
  let router: jest.Mocked<Router>;

  beforeEach(() => {
    appService = {
      hasStoredAuthToken: jest.fn(),
      requireReAuthentication: jest.fn(),
      clearAuthState: jest.fn(),
      setNeedsReAuthentication: jest.fn(),
      setSessionExpiryWarning: jest.fn(),
      consumeExplicitLogoutInProgress: jest.fn(),
      normalizeInternalRoute: jest.fn((returnUrl?: string) => (
        returnUrl && returnUrl.startsWith('/home') ? undefined : returnUrl
      )),
      reAuthenticationReturnUrl: undefined
    } as unknown as jest.Mocked<AppService>;

    router = {
      url: '/workspace-admin/1'
    } as unknown as jest.Mocked<Router>;
  });

  it('should require reauthentication on refresh errors even when no backend token is stored', () => {
    appService.hasStoredAuthToken.mockReturnValue(false);

    handleKeycloakSessionEvent(
      { type: KeycloakEventType.AuthRefreshError } as KeycloakEvent,
      appService,
      router
    );

    expect(appService.requireReAuthentication).toHaveBeenCalledWith('/workspace-admin/1');
    expect(appService.clearAuthState).not.toHaveBeenCalled();
  });

  it('should clear state silently for explicit logouts', () => {
    appService.consumeExplicitLogoutInProgress.mockReturnValue(true);

    handleKeycloakSessionEvent(
      { type: KeycloakEventType.AuthLogout } as KeycloakEvent,
      appService,
      router
    );

    expect(appService.clearAuthState).toHaveBeenCalledWith({ clearReAuthentication: true });
    expect(appService.requireReAuthentication).not.toHaveBeenCalled();
  });

  it('should require reauthentication for non-explicit logout events', () => {
    appService.consumeExplicitLogoutInProgress.mockReturnValue(false);

    handleKeycloakSessionEvent(
      { type: KeycloakEventType.AuthLogout } as KeycloakEvent,
      appService,
      router
    );

    expect(appService.requireReAuthentication).toHaveBeenCalledWith('/workspace-admin/1');
  });

  it('should require reauthentication when Keycloak is ready unauthenticated with a stale backend token', () => {
    appService.hasStoredAuthToken.mockReturnValue(true);

    handleKeycloakSessionEvent(
      { type: KeycloakEventType.Ready, args: false } as KeycloakEvent,
      appService,
      router
    );

    expect(appService.requireReAuthentication).toHaveBeenCalledWith('/workspace-admin/1');
  });

  it('should clear reauthentication state after successful authentication', () => {
    handleKeycloakSessionEvent(
      { type: KeycloakEventType.AuthSuccess } as KeycloakEvent,
      appService,
      router
    );

    expect(appService.setNeedsReAuthentication).toHaveBeenCalledWith(false);
    expect(appService.setSessionExpiryWarning).toHaveBeenCalledWith(false);
  });

  it('should keep reauthentication state after token refresh success', () => {
    handleKeycloakSessionEvent(
      { type: KeycloakEventType.AuthRefreshSuccess } as KeycloakEvent,
      appService,
      router
    );

    expect(appService.setNeedsReAuthentication).not.toHaveBeenCalled();
    expect(appService.setSessionExpiryWarning).toHaveBeenCalledWith(false);
  });
});
