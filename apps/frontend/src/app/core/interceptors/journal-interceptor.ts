import { inject } from '@angular/core';
import {
  HttpInterceptorFn,
  HttpRequest,
  HttpHandlerFn,
  HttpEvent,
  HttpResponse
} from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { AppService } from '../../services/app.service';
import { JournalService } from '../../services/journal.service';

export const journalInterceptor: HttpInterceptorFn = (
  request: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  const appService = inject(AppService);
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function logAction(
  request: HttpRequest<unknown>,
  response: HttpResponse<unknown>,
  appService: AppService,
  journalService: JournalService
): void {
  const workspaceId = appService.selectedWorkspaceId;
  if (!workspaceId) {
    return;
  }

  const url = request.url;
  const method = request.method;
  const actionType = getActionType(method);
  const entityType = getEntityType(url);
  const entityId = getEntityId(url);

  const details = JSON.stringify({
    method,
    url,
    requestBody: request.body ? sanitizeBody(request.body) : null,
    responseStatus: response.status,
    responseBody: response.body ? sanitizeBody(response.body) : null
  });

  journalService.createJournalEntry(
    workspaceId,
    actionType,
    entityType,
    entityId,
    details
  ).subscribe();
}

function getActionType(method: string): string {
  switch (method) {
    case 'POST': return 'create';
    case 'PUT':
    case 'PATCH': return 'update';
    case 'DELETE': return 'delete';
    default: return 'unknown';
  }
}

function getEntityType(url: string): string {
  // Extract entity type from URL
  if (url.includes('/test-results')) return 'test-results';
  if (url.includes('/coding')) return 'coding';
  if (url.includes('/files')) return 'files';
  if (url.includes('/unit-tags')) return 'unit-tags';
  if (url.includes('/unit-notes')) return 'unit-notes';
  if (url.includes('/resource-packages')) return 'resource-packages';
  if (url.includes('/units')) return 'units';
  if (url.includes('/responses')) return 'responses';

  return 'unknown';
}

function getEntityId(url: string): string {
  const parts = url.split('/');
  const idPattern = /^[0-9]+$/;

  for (let i = parts.length - 1; i >= 0; i--) {
    if (idPattern.test(parts[i])) {
      return parts[i];
    }
  }
  return '0';
}

function sanitizeBody(body: unknown): unknown {
  // Remove sensitive information from the body
  if (!body) return null;
  if (typeof body !== 'object') return body;

  const sanitized = { ...body as Record<string, unknown> };

  // Remove sensitive fields
  if (sanitized.password) sanitized.password = '***';
  if (sanitized.token) sanitized.token = '***';
  if (sanitized.authToken) sanitized.authToken = '***';

  return sanitized;
}
