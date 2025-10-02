import { inject } from '@angular/core';
import {
  HttpEvent,
  HttpHandlerFn,
  HttpHeaders,
  HttpInterceptorFn,
  HttpRequest,
  HttpErrorResponse
} from '@angular/common/http';
import { Router } from '@angular/router';
import {
  Observable,
  catchError,
  finalize,
  tap,
  throwError
} from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppHttpError } from './app-http-error.class';
import { SUPPRESS_GLOBAL_HTTP_ERROR } from './http-error-context';
import { AppService } from '../services/app.service';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  const appService = inject(AppService);
  const authService = inject(AuthService);
  const snackBar = inject(MatSnackBar);
  const router = inject(Router);
  let httpErrorInfo: AppHttpError | null = null;
  let suppressGlobalErrorMessage = false;

  let modifiedReq = req;

  if (!req.headers.has('Authorization')) {
    const token = authService.getToken();
    if (token) {
      const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
      modifiedReq = req.clone({ headers });
    }
  }

  return next(modifiedReq)
    .pipe(
      catchError((error: HttpErrorResponse) => {
        httpErrorInfo = new AppHttpError(error);
        return throwError(() => error);
      }),
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
          } else if (error.status === 401 || error.status === 403) {
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
          if (!httpErrorInfo) {
            httpErrorInfo = new AppHttpError(error);
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
    );
};

function shouldSuppressBackendLoginAuthDataError(
  req: HttpRequest<unknown>,
  error: { status?: number },
  appService: AppService
): boolean {
  return error.status === 401 &&
    req.urlWithParams.includes('/auth-data') &&
    appService.isBackendLoginRunning();
}
