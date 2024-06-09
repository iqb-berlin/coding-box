import { APP_INITIALIZER, ApplicationConfig, importProvidersFrom } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { HTTP_INTERCEPTORS, HttpClient, provideHttpClient } from '@angular/common/http';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { KeycloakService } from 'keycloak-angular';
import { provideStore } from '@ngrx/store';
import { HashLocationStrategy, LocationStrategy } from '@angular/common';
import { initializer } from './auth/keycloak-initializer';
import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { AuthInterceptor } from './interceptors/auth.interceptor';

export function createTranslateLoader(http: HttpClient): TranslateHttpLoader {
  return new TranslateHttpLoader(http, './assets/i18n/', '.json');
}

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
  provideRouter(routes),
  provideAnimationsAsync(),
  KeycloakService,
  {
    provide: 'SERVER_URL',
    useValue: environment.backendUrl
  },
  {
    provide: LocationStrategy,
    useClass: HashLocationStrategy
  },
  {
    provide: APP_INITIALIZER,
    useFactory: initializer,
    multi: true,
    deps: [KeycloakService]
  }, provideStore()]
};
