import { inject } from '@angular/core';
import {
  HttpEvent, HttpHandlerFn, HttpHeaders, HttpInterceptorFn, HttpRequest, HttpErrorResponse
} from '@angular/common/http';
import {
  finalize, Observable, tap, catchError, throwError
} from 'rxjs';
import { AppHttpError } from './app-http-error.class';
import { AppService } from '../../services/app.service';
import { AuthService } from '../services/auth.service';

/**
 * Functional interceptor for adding authentication headers and handling errors
 */
export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  const appService = inject(AppService);
  const authService = inject(AuthService);
  let httpErrorInfo: AppHttpError | null = null;

  let modifiedReq = req;

  // Add auth token to request if available and not already present
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
        // Handle 401 Unauthorized responses by redirecting to login
        if (error.status === 401) {
          authService.login();
        }

        httpErrorInfo = new AppHttpError(error);
        return throwError(() => error);
      }),
      tap({
        error: error => {
          if (!httpErrorInfo) {
            httpErrorInfo = new AppHttpError(error);
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
