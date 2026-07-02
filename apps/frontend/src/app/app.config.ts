import {
  ApplicationConfig, importProvidersFrom, inject, LOCALE_ID,
  provideAppInitializer
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { TranslateLoader, TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  HttpClient,
  provideHttpClient,
  withInterceptors
} from '@angular/common/http';
import { registerLocaleData, HashLocationStrategy, LocationStrategy } from '@angular/common';
import localeDeAt from '@angular/common/locales/de-AT';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import {
  AutoRefreshTokenService, createInterceptorCondition,
  INCLUDE_BEARER_TOKEN_INTERCEPTOR_CONFIG, IncludeBearerTokenCondition,
  provideKeycloak,
  UserActivityService,
  withAutoRefreshToken
} from 'keycloak-angular';
import {
  catchError, firstValueFrom, Observable, of
} from 'rxjs';
import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { journalInterceptor } from './core/interceptors/journal-interceptor';
import { SERVER_URL } from './injection-tokens';
import { AUTH_SESSION_IDLE_TIMEOUT_MS } from './core/services/auth-session.config';

export class VersionedTranslateLoader implements TranslateLoader {
  constructor(private http: HttpClient) {}

  getTranslation(lang: string): Observable<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(
      `./assets/i18n/${lang}.json?v=${encodeURIComponent(environment.appVersion)}`
    );
  }
}

export function createTranslateLoader(http: HttpClient): VersionedTranslateLoader {
  return new VersionedTranslateLoader(http);
}

export function initializeTranslations(): Promise<Record<string, unknown>> {
  const translateService = inject(TranslateService);
  translateService.setDefaultLang('de');
  return firstValueFrom(
    translateService.use('de').pipe(
      catchError(() => of({}))
    )
  );
}

const allUrlsCondition = createInterceptorCondition<IncludeBearerTokenCondition>({
  urlPattern: /^(https?:\/\/.*)(\/.*)?$/i // Match all URLs starting with http or https
});

export const provideKeycloakAngular = () => provideKeycloak({
  config: {
    url: environment.keycloak.url,
    realm: environment.keycloak.realm,
    clientId: environment.keycloak.clientId
  },
  initOptions: {
    onLoad: 'check-sso',
    checkLoginIframe: false
  },
  features: [
    withAutoRefreshToken({
      onInactivityTimeout: 'none',
      sessionTimeout: AUTH_SESSION_IDLE_TIMEOUT_MS
    })
  ],

  providers: [
    {
      provide: INCLUDE_BEARER_TOKEN_INTERCEPTOR_CONFIG,
      useValue: allUrlsCondition
    },
    AutoRefreshTokenService, UserActivityService]
});

registerLocaleData(localeDeAt);

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
    {
      provide: LOCALE_ID,
      useValue: 'de-AT'
    },
    provideAppInitializer(initializeTranslations)
  ]
};
