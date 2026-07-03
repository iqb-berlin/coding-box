import { inject } from '@angular/core';
import {
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest
} from '@angular/common/http';
import { Router } from '@angular/router';
import {
  catchError,
  finalize,
  from,
  map,
  Observable,
  of,
  switchMap,
  tap
} from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppHttpError } from './app-http-error.class';
import {
  SUPPRESS_AUTH_ERROR_REDIRECT,
  SUPPRESS_GLOBAL_HTTP_ERROR
} from './http-error-context';
import { AppService } from '../services/app.service';
import { AuthService } from '../services/auth.service';
import { SERVER_URL } from '../../injection-tokens';

const AUTH_ENDPOINTS_WITHOUT_ACCESS_TOKEN = [
  '/auth/exchange',
  '/auth/refresh',
  '/auth/login',
  '/auth/logout',
  '/auth/profile'
];

export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  const appService = inject(AppService);
  const authService = inject(AuthService);
  const snackBar = inject(MatSnackBar);
  const router = inject(Router);
  const serverUrl = inject(SERVER_URL);
  let httpErrorInfo: AppHttpError | null = null;
  let suppressGlobalErrorMessage = false;

  return getRequestWithAuthHeader(req, authService, appService, router, serverUrl)
    .pipe(
      switchMap(modifiedReq => next(modifiedReq)
        .pipe(
          tap({
            error: error => {
              httpErrorInfo = new AppHttpError(error);
              const suppressBackendLoginAuthDataError = shouldSuppressBackendLoginAuthDataError(req, error, appService);
              suppressGlobalErrorMessage = req.context.get(SUPPRESS_GLOBAL_HTTP_ERROR) ||
                suppressBackendLoginAuthDataError;

              if (suppressBackendLoginAuthDataError) {
                return;
              }

              if (error.status === 500 || error.status === 999) {
                appService.setBackendUnavailable(true);
                snackBar.open(
                  'Backend ist nicht verfügbar. Bitte versuchen Sie es später erneut.',
                  'Schließen',
                  {
                    duration: 0,
                    panelClass: ['error-snackbar']
                  }
                );
              } else if (
                (error.status === 401 || error.status === 403) &&
                !req.context.get(SUPPRESS_AUTH_ERROR_REDIRECT)
              ) {
                suppressGlobalErrorMessage = true;
                const errorMessage = error.error?.message || error.message || '';

                if (errorMessage.includes('Access level')) {
                  snackBar.open(
                    'Sie haben nicht die erforderliche Zugriffsberechtigung für diese Aktion',
                    'Schließen',
                    {
                      duration: 5000,
                      panelClass: ['error-snackbar']
                    }
                  );
                } else if (error.status === 401) {
                  appService.requireReAuthentication(router.url);
                } else {
                  snackBar.open(
                    'Sie haben keine Berechtigung für diese Aktion',
                    'Schließen',
                    {
                      duration: 5000,
                      panelClass: ['error-snackbar']
                    }
                  );
                }
              }
            }
          }),
          finalize(() => {
            if (httpErrorInfo && !suppressGlobalErrorMessage) {
              httpErrorInfo.method = req.method;
              httpErrorInfo.urlWithParams = req.urlWithParams;
              appService.addErrorMessage(httpErrorInfo);
            }
          })
        ))
    );
};

function getRequestWithAuthHeader(
  req: HttpRequest<unknown>,
  authService: AuthService,
  appService: AppService,
  router: Router,
  serverUrl: string
): Observable<HttpRequest<unknown>> {
  if (!isBackendRequest(req.url, serverUrl)) {
    return of(req);
  }

  if (isAuthEndpointWithoutAccessToken(req.url, serverUrl)) {
    return of(req);
  }

  const authorizationHeader = req.headers.get('Authorization');
  const shouldPreserveExplicitAuthorization =
    authorizationHeader &&
    authorizationHeader !== `Bearer ${authService.getToken()}` &&
    authorizationHeader !== 'Bearer null' &&
    authorizationHeader !== 'Bearer undefined';

  if (shouldPreserveExplicitAuthorization) {
    return of(req);
  }

  if (appService.needsReAuthentication) {
    return of(req);
  }

  return from(authService.getValidToken())
    .pipe(
      catchError(() => {
        appService.requireReAuthentication(router.url);
        return of(undefined);
      }),
      map(token => {
        if (!token) {
          return authorizationHeader ? req.clone({
            headers: req.headers.delete('Authorization')
          }) : req;
        }

        return req.clone({
          setHeaders: {
            Authorization: `Bearer ${token}`
          }
        });
      })
    );
}

function isBackendRequest(url: string, serverUrl: string): boolean {
  const normalizedServerUrl = serverUrl.trim();
  if (!normalizedServerUrl) {
    return false;
  }

  const withoutTrailingSlash = normalizedServerUrl.replace(/\/+$/, '');
  const withTrailingSlash = `${withoutTrailingSlash}/`;
  const absoluteOrConfiguredMatch = url === withoutTrailingSlash ||
    url.startsWith(withTrailingSlash) ||
    url.startsWith(normalizedServerUrl);

  if (absoluteOrConfiguredMatch) {
    return true;
  }

  if (!withoutTrailingSlash.startsWith('/')) {
    const slashPrefixed = `/${withoutTrailingSlash}`;
    return url === slashPrefixed || url.startsWith(`${slashPrefixed}/`);
  }

  return false;
}

function isAuthEndpointWithoutAccessToken(url: string, serverUrl: string): boolean {
  const backendPath = getBackendRelativePath(url, serverUrl);
  return AUTH_ENDPOINTS_WITHOUT_ACCESS_TOKEN.some(endpoint => backendPath === endpoint ||
    backendPath.startsWith(`${endpoint}/`));
}

function getBackendRelativePath(url: string, serverUrl: string): string {
  const requestPath = getPathname(url);
  const serverPath = getPathname(serverUrl).replace(/\/+$/, '');

  if (serverPath && requestPath === serverPath) {
    return '/';
  }

  if (serverPath && requestPath.startsWith(`${serverPath}/`)) {
    return requestPath.slice(serverPath.length);
  }

  return requestPath.startsWith('/') ? requestPath : `/${requestPath}`;
}

function getPathname(url: string): string {
  const baseUrl = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;

  try {
    return new URL(url, baseUrl).pathname;
  } catch {
    return url.split(/[?#]/, 1)[0];
  }
}

function shouldSuppressBackendLoginAuthDataError(
  req: HttpRequest<unknown>,
  error: { status?: number },
  appService: AppService
): boolean {
  return error.status === 401 &&
    req.urlWithParams.includes('/auth-data') &&
    appService.isBackendLoginRunning();
}
