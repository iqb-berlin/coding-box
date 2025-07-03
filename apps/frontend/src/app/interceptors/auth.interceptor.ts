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
