import { HttpErrorResponse } from '@angular/common/http';

export interface AppHttpErrorRequest {
  method: string;
  urlWithParams: string;
  requestId?: string;
}

export const BACKEND_CONNECTIVITY_ERROR_MESSAGE =
  'Der Server antwortet gerade nicht. Einige Daten konnten nicht geladen werden. Bitte versuchen Sie es in einem Moment erneut.';

export const GENERIC_HTTP_ERROR_MESSAGE =
  'Die Anfrage konnte nicht ausgeführt werden. Bitte versuchen Sie es erneut.';

export const SERVER_ERROR_MESSAGE =
  'Auf dem Server ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.';

export function isBackendConnectivityStatus(status: number): boolean {
  return [0, 502, 503, 504].includes(status);
}

export class AppHttpError {
  status: number;
  message: string;
  userMessage: string;
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
      this.message = BACKEND_CONNECTIVITY_ERROR_MESSAGE;
      this.userMessage = this.message;
      this.technicalMessage = this.extractErrorMessage(errorObj);
      return;
    }

    this.technicalMessage = this.extractErrorMessage(errorObj);
    this.userMessage = this.extractUserMessage(errorObj, this.technicalMessage);
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

  private extractUserMessage(errorObj: HttpErrorResponse, technicalMessage: string): string {
    if (errorObj.error instanceof ErrorEvent) {
      return GENERIC_HTTP_ERROR_MESSAGE;
    }

    if (errorObj.status >= 500) {
      return SERVER_ERROR_MESSAGE;
    }

    switch (errorObj.status) {
      case 400:
        return this.toUserSafeClientErrorMessage(
          technicalMessage,
          'Die Anfrage konnte nicht verarbeitet werden. Bitte prüfen Sie die Eingaben.'
        );
      case 401:
        return 'Ihre Sitzung ist abgelaufen oder Sie sind nicht angemeldet. Bitte melden Sie sich erneut an.';
      case 403:
        return 'Sie haben keine Berechtigung für diese Aktion.';
      case 404:
        return 'Die angeforderten Daten wurden nicht gefunden.';
      case 409:
        return this.toUserSafeClientErrorMessage(
          technicalMessage,
          'Die Aktion konnte wegen eines Konflikts nicht abgeschlossen werden.'
        );
      default:
        return this.toUserSafeClientErrorMessage(technicalMessage, GENERIC_HTTP_ERROR_MESSAGE);
    }
  }

  private toUserSafeClientErrorMessage(message: string, fallback: string): string {
    const normalizedMessage = message.trim();

    if (!normalizedMessage || this.isTechnicalMessage(normalizedMessage)) {
      return fallback;
    }

    return normalizedMessage;
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
