import { inject } from '@angular/core';
import {
  HttpEvent,
  HttpHandlerFn,
  HttpHeaders,
  HttpInterceptorFn,
  HttpRequest
} from '@angular/common/http';
import { Router } from '@angular/router';
import {
  finalize,
  Observable,
  tap
} from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppHttpError } from './app-http-error.class';
import { AppService } from '../services/app.service';

/**
 * Functional interceptor for adding authentication headers and handling errors
 */
export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  const appService: AppService = inject(AppService);
  const snackBar = inject(MatSnackBar);
  const router = inject(Router);
  let httpErrorInfo: AppHttpError | null = null;
  let suppressErrorMessage = false;

  let modifiedReq = req;

  if (!req.headers.has('Authorization')) {
    const idToken = localStorage.getItem('id_token');
    if (idToken) {
      const headers = new HttpHeaders({ Authorization: `Bearer ${idToken}` });
      modifiedReq = req.clone({ headers });
    }
  }

  return next(modifiedReq)
    .pipe(
      tap({
        error: error => {
          httpErrorInfo = new AppHttpError(error);
          suppressErrorMessage = shouldSuppressBackendLoginAuthDataError(req, error, appService);
          if (suppressErrorMessage) {
            return;
          }

          if (error.status === 401 || error.status === 403) {
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
        if (httpErrorInfo && !suppressErrorMessage) {
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
