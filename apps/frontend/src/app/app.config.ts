import {
  ApplicationConfig, importProvidersFrom, LOCALE_ID,
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
import { HashLocationStrategy, LocationStrategy } from '@angular/common';
import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { journalInterceptor } from './core/interceptors/journal-interceptor';
import { SERVER_URL } from './injection-tokens';
import { AUTH_SESSION_IDLE_TIMEOUT_MS } from './core/services/auth-session.config';

const translationCacheBust = Date.now().toString();

export class CacheBustingTranslateLoader implements TranslateLoader {
  constructor(private http: HttpClient) {}

  getTranslation(lang: string): Observable<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(
      `./assets/i18n/${lang}.json?v=${translationCacheBust}`
    );
  }
}

export function createTranslateLoader(http: HttpClient): CacheBustingTranslateLoader {
  return new CacheBustingTranslateLoader(http);
}

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
    provideAppInitializer(() => {
    })
  ]
};
