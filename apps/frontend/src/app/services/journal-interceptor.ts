import { inject } from '@angular/core';
import {
  HttpInterceptorFn,
  HttpRequest,
  HttpHandlerFn,
  HttpEvent,
  HttpResponse
} from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { AppService } from './app.service';
import { JournalService } from './journal.service';

/**
 * Functional interceptor for logging HTTP requests to the journal
 */
export const journalInterceptor: HttpInterceptorFn = (
  request: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  const appService = inject(AppService);
  const journalService = inject(JournalService);

  // Only intercept requests to the backend API
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
        // Only log successful requests that modify data
        if (isDataModifyingRequest(request) && event.status >= 200 && event.status < 300) {
          logAction(request, event, appService, journalService);
        }
      }
    })
  );
};

/**
 * Checks if the request method indicates data modification
 */
function isDataModifyingRequest(request: HttpRequest<unknown>): boolean {
  // Check if the request method indicates data modification
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
}

/**
 * Logs an action to the journal
 */
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

  // Extract information from the request
  const url = request.url;
  const method = request.method;
  const actionType = getActionType(method);
  const entityType = getEntityType(url);
  const entityId = getEntityId(url);

  // Create details from the request body and response
  const details = JSON.stringify({
    method,
    url,
    requestBody: request.body ? sanitizeBody(request.body) : null,
    responseStatus: response.status,
    responseBody: response.body ? sanitizeBody(response.body) : null
  });

  // Log the action to the journal
  journalService.createJournalEntry(
    workspaceId,
    actionType,
    entityType,
    entityId,
    details
  ).subscribe();
}

/**
 * Gets the action type based on the HTTP method
 */
function getActionType(method: string): string {
  switch (method) {
    case 'POST': return 'create';
    case 'PUT':
    case 'PATCH': return 'update';
    case 'DELETE': return 'delete';
    default: return 'unknown';
  }
}

/**
 * Gets the entity type based on the URL
 */
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

/**
 * Gets the entity ID from the URL
 */
function getEntityId(url: string): string {
  // Try to extract an ID from the URL
  const parts = url.split('/');
  const idPattern = /^[0-9]+$/;

  for (let i = parts.length - 1; i >= 0; i--) {
    if (idPattern.test(parts[i])) {
      return parts[i];
    }
  }

  return 'unknown';
}

/**
 * Sanitizes the request/response body by removing sensitive information
 */
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
