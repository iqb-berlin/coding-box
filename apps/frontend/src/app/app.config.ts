import {
  ApplicationConfig, importProvidersFrom,
  provideAppInitializer
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { HTTP_INTERCEPTORS, HttpClient, provideHttpClient } from '@angular/common/http';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import {
  AutoRefreshTokenService, provideKeycloak, UserActivityService, withAutoRefreshToken
} from 'keycloak-angular';
import { provideStore } from '@ngrx/store';
import { HashLocationStrategy, LocationStrategy } from '@angular/common';
import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { AuthInterceptor } from './interceptors/auth.interceptor';

export function createTranslateLoader(http: HttpClient): TranslateHttpLoader {
  return new TranslateHttpLoader(http, './assets/i18n/', '.json');
}

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
  providers: [AutoRefreshTokenService, UserActivityService]
});

export const appConfig: ApplicationConfig = {
  providers: [provideHttpClient(), {
    provide: HTTP_INTERCEPTORS,
    useClass: AuthInterceptor,
    multi: true
  },
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
    provide: 'SERVER_URL',
    useValue: environment.backendUrl
  },
  {
    provide: LocationStrategy,
    useClass: HashLocationStrategy
  },
  provideAppInitializer(() => {
  }), provideStore()]
};
