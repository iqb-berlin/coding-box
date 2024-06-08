import { KeycloakOptions, KeycloakService } from 'keycloak-angular';
import { environment } from '../../environments/environment';

export function initializer(keycloak: KeycloakService): () => Promise<boolean> {
  if (environment.production) {
    const options: KeycloakOptions = {
      config: {
        url: 'https://www.iqb-login.de',
        realm: 'iqb',
        clientId: 'coding-box'
      },
      loadUserProfileAtStartUp: true,
      initOptions: {
        onLoad: 'check-sso',
        // onLoad: 'login-required',
        checkLoginIframe: false
      },
      bearerExcludedUrls: ['/replay', '/assets']
    };

    return () => keycloak.init(options);
  }
  const options: KeycloakOptions = {
    config: {
      url: 'https://www.iqb-login.de',
      realm: 'iqb',
      clientId: 'coding-box'
    },
    loadUserProfileAtStartUp: true,
    initOptions: {
      onLoad: 'check-sso',
      redirectUri: 'http://localhost:4200/dashboard',
      //onLoad: 'login-required',
      checkLoginIframe: false
    },
    //enableBearerInterceptor: true,
    //bearerExcludedUrls: ['replay']
  };

  return () => keycloak.init(options);
}
