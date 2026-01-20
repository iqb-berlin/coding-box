import { inject } from '@angular/core';
import {
  HttpInterceptorFn,
  HttpRequest,
  HttpHandlerFn,
  HttpEvent,
  HttpResponse
} from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { AppService } from '../services/app.service';

export const journalInterceptor: HttpInterceptorFn = (
  request: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  const appService: AppService = inject(AppService);
  // const journalService = inject(JournalService);

  if (!request.url.startsWith(appService.serverUrl)) {
    return next(request);
  }

  // Skip journal-related requests to avoid infinite loops
  if (request.url.includes('/journal')) {
    return next(request);
  }

  return next(request).pipe(
    tap(event => {
      if (event instanceof HttpResponse) {
        // Only log successful requests that modify data and are related to test results
        if (isDataModifyingRequest(request) && event.status >= 200 && event.status < 300 &&
            isTestResultsRequest(request)) {
          // logAction(request, event, appService, journalService);
        }
      }
    })
  );
};

function isDataModifyingRequest(request: HttpRequest<unknown>): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
}

function isTestResultsRequest(request: HttpRequest<unknown>): boolean {
  return request.url.includes('/test-results') ||
         request.url.includes('/responses') ||
         request.url.includes('/units') ||
         request.url.includes('/booklets');
}
