import { HttpErrorResponse } from '@angular/common/http';

export interface AppHttpErrorRequest {
  method: string;
  urlWithParams: string;
  requestId?: string;
}

export type AppHttpErrorUserMessage = { readonly key: string } | { readonly text: string };

export const BACKEND_CONNECTIVITY_ERROR_MESSAGE_KEY =
  'ui-text.http-errors.backend-unavailable';

export const GENERIC_HTTP_ERROR_MESSAGE_KEY =
  'ui-text.http-errors.request-failed';

export const SERVER_ERROR_MESSAGE_KEY =
  'journal.load-error-message';

export function isBackendConnectivityStatus(status: number): boolean {
  return [0, 502, 503, 504].includes(status);
}

export class AppHttpError {
  status: number;
  message: string;
  userMessage: string;
  userMessageParts: AppHttpErrorUserMessage[] = [];
  technicalMessage = '';
  requestId = '';
  occurredAt = new Date().toISOString();
  method = '';
  urlWithParams = '';
  id = 0;
  requestCount = 1;
  isBackendConnectivityError = false;
  affectedRequests: AppHttpErrorRequest[] = [];

  constructor(errorObj: HttpErrorResponse) {
    this.status = errorObj.error instanceof ErrorEvent ? 999 : errorObj.status;
    this.requestId = this.extractRequestId(errorObj);
    this.isBackendConnectivityError = isBackendConnectivityStatus(this.status);

    if (this.isBackendConnectivityError) {
      this.message = BACKEND_CONNECTIVITY_ERROR_MESSAGE_KEY;
      this.userMessage = this.message;
      this.userMessageParts = [{ key: BACKEND_CONNECTIVITY_ERROR_MESSAGE_KEY }];
      this.technicalMessage = this.extractErrorMessage(errorObj);
      return;
    }

    this.technicalMessage = this.extractErrorMessage(errorObj);
    const userMessage = this.extractUserMessage(errorObj, this.technicalMessage);
    this.userMessageParts = [userMessage];
    this.userMessage = 'key' in userMessage ? userMessage.key : userMessage.text;
    this.message = this.userMessage;
  }

  private extractErrorMessage(errorObj: HttpErrorResponse): string {
    if (errorObj.error instanceof ErrorEvent) {
      return errorObj.error.message;
    }

    const responseMessage = errorObj.error?.message;
    if (Array.isArray(responseMessage)) {
      return responseMessage.join(' ');
    }

    if (typeof responseMessage === 'string' && responseMessage.trim() !== '') {
      return responseMessage;
    }

    if (typeof errorObj.error === 'string' && errorObj.error.trim() !== '') {
      return errorObj.error;
    }

    return errorObj.message;
  }

  private extractRequestId(errorObj: HttpErrorResponse): string {
    const requestIdFromHeader = errorObj.headers?.get('X-Request-Id');
    if (requestIdFromHeader) {
      return requestIdFromHeader;
    }

    const requestIdFromBody = errorObj.error?.requestId;
    if (typeof requestIdFromBody === 'string') {
      return requestIdFromBody;
    }

    return '';
  }

  private extractUserMessage(errorObj: HttpErrorResponse, technicalMessage: string): AppHttpErrorUserMessage {
    if (errorObj.error instanceof ErrorEvent) {
      return { key: GENERIC_HTTP_ERROR_MESSAGE_KEY };
    }

    if (errorObj.status >= 500) {
      return { key: SERVER_ERROR_MESSAGE_KEY };
    }

    switch (errorObj.status) {
      case 400:
        return this.toUserSafeClientErrorMessage(
          technicalMessage,
          'ui-text.http-errors.invalid-input'
        );
      case 401:
        return { key: 'ui-text.http-errors.session-expired' };
      case 403:
        return { key: 'ui-text.http-errors.forbidden' };
      case 404:
        return { key: 'ui-text.http-errors.not-found' };
      case 409:
        return this.toUserSafeClientErrorMessage(
          technicalMessage,
          'ui-text.http-errors.conflict'
        );
      default:
        return this.toUserSafeClientErrorMessage(technicalMessage, GENERIC_HTTP_ERROR_MESSAGE_KEY);
    }
  }

  private toUserSafeClientErrorMessage(message: string, fallback: string): AppHttpErrorUserMessage {
    const normalizedMessage = message.trim();

    if (!normalizedMessage || this.isTechnicalMessage(normalizedMessage)) {
      return { key: fallback };
    }

    return { text: normalizedMessage };
  }

  private isTechnicalMessage(message: string): boolean {
    const lowerCaseMessage = message.toLowerCase();

    return lowerCaseMessage === 'internal server error' ||
      lowerCaseMessage.startsWith('http failure response') ||
      lowerCaseMessage.startsWith('failed to ') ||
      lowerCaseMessage.startsWith('error ') ||
      lowerCaseMessage.startsWith('an error occurred') ||
      lowerCaseMessage.includes('exception') ||
      lowerCaseMessage.includes('stack trace');
  }
}

/** Translate only application messages; preserve server text and each grouped part. */
export function formatAppHttpErrorMessage(error: AppHttpError, translate: (key: string) => string): string {
  const parts = error.userMessageParts?.length ? error.userMessageParts : [{ text: error.userMessage || error.message || '' }];
  return parts.map(part => ('key' in part ? translate(part.key) : part.text)).join('; ');
}
