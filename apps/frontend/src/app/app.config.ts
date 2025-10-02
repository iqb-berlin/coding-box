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
import { HashLocationStrategy, LocationStrategy } from '@angular/common';
import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { journalInterceptor } from './core/interceptors/journal-interceptor';
import { SERVER_URL } from './injection-tokens';

export function createTranslateLoader(http: HttpClient): TranslateHttpLoader {
  return new TranslateHttpLoader(http, './assets/i18n/', '.json');
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
    provideAppInitializer(() => {
    })
  ]
};
