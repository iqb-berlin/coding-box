import { Router } from '@angular/router';
import {
  KeycloakEvent,
  KeycloakEventType,
  ReadyArgs,
  typeEventArgs
} from 'keycloak-angular';
import { AppService } from './app.service';

function getReturnUrl(router: Router, appService: AppService): string | undefined {
  return appService.normalizeInternalRoute(router.url) || appService.reAuthenticationReturnUrl;
}

export function handleKeycloakSessionEvent(
  keycloakEvent: KeycloakEvent,
  appService: AppService,
  router: Router
): void {
  switch (keycloakEvent.type) {
    case KeycloakEventType.Ready: {
      const authenticated = typeEventArgs<ReadyArgs>(keycloakEvent.args);
      if (!authenticated && appService.hasStoredAuthToken()) {
        appService.requireReAuthentication(getReturnUrl(router, appService));
      }
      break;
    }
    case KeycloakEventType.AuthLogout:
      if (appService.consumeExplicitLogoutInProgress()) {
        appService.clearAuthState({ clearReAuthentication: true });
      } else {
        appService.requireReAuthentication(getReturnUrl(router, appService));
      }
      break;
    case KeycloakEventType.AuthRefreshError:
      appService.requireReAuthentication(getReturnUrl(router, appService));
      break;
    case KeycloakEventType.AuthSuccess:
    case KeycloakEventType.AuthRefreshSuccess:
      appService.setNeedsReAuthentication(false);
      break;
    default:
      break;
  }
}
