import { Inject, Injectable } from '@angular/core';
import {
  HttpRequest, HttpHandler, HttpEvent, HttpInterceptor, HttpHeaders
} from '@angular/common/http';
import { finalize, Observable, tap } from 'rxjs';
import { AppHttpError } from './app-http-error.class';
import { AppService } from '../services/app.service';

@Injectable({
  providedIn: 'root'
})
export class AuthInterceptor implements HttpInterceptor {
  constructor(
    private appService: AppService,
    @Inject('APP_VERSION') readonly appVersion: string
  ) {}

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    const idToken = 'ssss';// localStorage.getItem('id_token');
    const headers = new HttpHeaders({ Authorization: `Bearer ${idToken}` });
    let httpErrorInfo: AppHttpError | null = null;
    return next.handle(req.clone({ headers }))
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
            this.appService.addErrorMessage(httpErrorInfo);
          }
        })
      );
  }
}
