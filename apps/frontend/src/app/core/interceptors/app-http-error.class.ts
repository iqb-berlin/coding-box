import { HttpErrorResponse } from '@angular/common/http';

export interface AppHttpErrorRequest {
  method: string;
  urlWithParams: string;
}

export const BACKEND_CONNECTIVITY_ERROR_MESSAGE =
  'Der Server antwortet gerade nicht. Einige Daten konnten nicht geladen werden. Bitte versuchen Sie es in einem Moment erneut.';

export function isBackendConnectivityStatus(status: number): boolean {
  return [0, 502, 503, 504].includes(status);
}

export class AppHttpError {
  status: number;
  message: string;
  method = '';
  urlWithParams = '';
  id = 0;
  requestCount = 1;
  isBackendConnectivityError = false;
  affectedRequests: AppHttpErrorRequest[] = [];

  constructor(errorObj: HttpErrorResponse) {
    this.status = errorObj.error instanceof ErrorEvent ? 999 : errorObj.status;
    this.isBackendConnectivityError = isBackendConnectivityStatus(this.status);

    if (this.isBackendConnectivityError) {
      this.message = BACKEND_CONNECTIVITY_ERROR_MESSAGE;
      return;
    }

    this.message = this.extractErrorMessage(errorObj);
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
}
