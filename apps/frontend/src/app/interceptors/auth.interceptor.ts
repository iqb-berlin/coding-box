import { inject } from '@angular/core';
import {
  HttpEvent, HttpHandlerFn, HttpHeaders, HttpInterceptorFn, HttpRequest
} from '@angular/common/http';
import { finalize, Observable, tap } from 'rxjs';
import { AppHttpError } from './app-http-error.class';
import { AppService } from '../services/app.service';

/**
 * Functional interceptor for adding authentication headers and handling errors
 */
export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  const appService = inject(AppService);
  const idToken = localStorage.getItem('id_token');
  const headers = new HttpHeaders({ Authorization: `Bearer ${idToken}` });
  let httpErrorInfo: AppHttpError | null = null;

  return next(req.clone({ headers }))
    .pipe(
      tap({
        error: error => {
          httpErrorInfo = new AppHttpError(error);
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
