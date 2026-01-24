import { inject } from '@angular/core';
import {
  HttpEvent,
  HttpHandlerFn,
  HttpHeaders,
  HttpInterceptorFn,
  HttpRequest
} from '@angular/common/http';
import {
  finalize,
  Observable,
  tap
} from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppHttpError } from './app-http-error.class';
import { AppService } from '../services/app.service';
import { AuthService } from '../services/auth.service';

/**
 * Functional interceptor for adding authentication headers and handling errors
 */
export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  const appService: AppService = inject(AppService);
  const snackBar = inject(MatSnackBar);
  const authService = inject(AuthService);
  let httpErrorInfo: AppHttpError | null = null;

  let modifiedReq = req;

  if (!req.headers.has('Authorization')) {
    const idToken = localStorage.getItem('id_token');
    const headers = new HttpHeaders({ Authorization: `Bearer ${idToken}` });
    modifiedReq = req.clone({ headers });
  }

  return next(modifiedReq)
    .pipe(
      tap({
        error: error => {
          httpErrorInfo = new AppHttpError(error);
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
              appService.setNeedsReAuthentication(true);
              snackBar.open(
                'Sie sind nicht angemeldet oder Ihre Sitzung ist abgelaufen',
                'Anmelden',
                {
                  duration: 0,
                  panelClass: ['error-snackbar']
                }
              ).onAction().subscribe(() => {
                authService.login();
              });
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
        if (httpErrorInfo) {
          httpErrorInfo.method = req.method;
          httpErrorInfo.urlWithParams = req.urlWithParams;
          appService.addErrorMessage(httpErrorInfo);
        }
      })
    );
};
