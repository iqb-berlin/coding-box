import { KeycloakOptions, KeycloakService } from 'keycloak-angular';
import { environment } from '../../environments/environment';

export function initializer(keycloak: KeycloakService): () => Promise<boolean> {
  if (environment.production) {
    const options: KeycloakOptions = {
      config: {
        url: 'https://keycloak.iqb-kodierbox.de',
        realm: 'iqb',
        clientId: 'coding-box'
      },
      loadUserProfileAtStartUp: true,
      initOptions: {
        onLoad: 'check-sso',
        // redirectUri: 'https://iqb-kodierbox.de',
        // onLoad: 'login-required',
        checkLoginIframe: false
      }
    };

    return () => keycloak.init(options);
  }
  const options: KeycloakOptions = {
    config: {
      url: 'https://keycloak.iqb-kodierbox.de',
      realm: 'iqb',
      clientId: 'coding-box'
    },
    loadUserProfileAtStartUp: true,
    initOptions: {
      onLoad: 'check-sso',
      // onLoad: 'login-required',
      checkLoginIframe: false
    }
    // enableBearerInterceptor: true,
    // bearerExcludedUrls: ['replay']
  };

  return () => keycloak.init(options);
}
