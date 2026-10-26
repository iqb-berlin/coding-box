import {
  ApplicationConfig, importProvidersFrom, LOCALE_ID,
  provideAppInitializer
} from '@angular/core';
import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import {
  HttpClient,
  provideHttpClient,
  withInterceptors
} from '@angular/common/http';
import { HashLocationStrategy, LocationStrategy, registerLocaleData } from '@angular/common';
import localeDeAt from '@angular/common/locales/de-AT';
import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { journalInterceptor } from './core/interceptors/journal-interceptor';
import { SERVER_URL } from './injection-tokens';
import { CacheBustingTranslateLoader } from './core/services/translation-loader';

registerLocaleData(localeDeAt);

export { CacheBustingTranslateLoader } from './core/services/translation-loader';

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
    // AppComponent starts routing after the browser-bound login exchange and
    // auth-data bootstrap, before protected views can issue their own requests.
    provideRouter(routes, withDisabledInitialNavigation()),
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
