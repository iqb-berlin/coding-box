import {
  ApplicationConfig, importProvidersFrom,
  provideAppInitializer
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import {
  HttpClient,
  provideHttpClient,
  withInterceptors
} from '@angular/common/http';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import {
  AutoRefreshTokenService, createInterceptorCondition,
  INCLUDE_BEARER_TOKEN_INTERCEPTOR_CONFIG, IncludeBearerTokenCondition,
  provideKeycloak,
  UserActivityService,
  withAutoRefreshToken
} from 'keycloak-angular';
import { HashLocationStrategy, LocationStrategy } from '@angular/common';
import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { journalInterceptor } from './core/interceptors/journal-interceptor';
import { SERVER_URL } from './injection-tokens';

export function createTranslateLoader(http: HttpClient): TranslateHttpLoader {
  return new TranslateHttpLoader(http, './assets/i18n/', '.json');
}

const allUrlsCondition = createInterceptorCondition<IncludeBearerTokenCondition>({
  urlPattern: /^(https?:\/\/.*)(\/.*)?$/i // Match all URLs starting with http or https
});

export const provideKeycloakAngular = () => provideKeycloak({
  config: {
    url: 'https://www.iqb-login.de',
    realm: 'iqb',
    clientId: 'coding-box'
  },
  initOptions: {
    onLoad: 'check-sso',
    // redirectUri: 'https://iqb-kodierbox.de',
    // onLoad: 'login-required',
    checkLoginIframe: false
  },
  features: [
    withAutoRefreshToken({
      onInactivityTimeout: 'logout',
      sessionTimeout: 60000
    })
  ],

  providers: [
    {
      provide: INCLUDE_BEARER_TOKEN_INTERCEPTOR_CONFIG,
      useValue: allUrlsCondition
    },
    AutoRefreshTokenService, UserActivityService]
});

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(
      withInterceptors([journalInterceptor, authInterceptor])
    ),
    importProvidersFrom(TranslateModule.forRoot({
      defaultLanguage: 'de',
      loader: {
        provide: TranslateLoader,
        useFactory: createTranslateLoader,
        deps: [HttpClient]
      }
    })),
    provideKeycloakAngular(),
    provideRouter(routes),
    provideAnimationsAsync(),
    {
      provide: SERVER_URL,
      useValue: environment.backendUrl
    },
    {
      provide: LocationStrategy,
      useClass: HashLocationStrategy
    },
    provideAppInitializer(() => {
    })
  ]
};
