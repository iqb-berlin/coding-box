import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import {
  AppHttpError,
  BACKEND_CONNECTIVITY_ERROR_MESSAGE,
  SERVER_ERROR_MESSAGE
} from './app-http-error.class';

describe('AppHttpError', () => {
  it('should replace generic server messages with a user-friendly message', () => {
    const error = new AppHttpError(new HttpErrorResponse({
      error: { message: 'Internal server error' },
      status: 500,
      statusText: 'Internal Server Error',
      url: '/api/admin/workspace/5/journal?page=1&limit=20'
    }));

    expect(error.message).toBe(SERVER_ERROR_MESSAGE);
    expect(error.userMessage).toBe(SERVER_ERROR_MESSAGE);
    expect(error.technicalMessage).toBe('Internal server error');
  });

  it('should extract the request id from the response header', () => {
    const error = new AppHttpError(new HttpErrorResponse({
      error: { message: 'Internal server error', requestId: 'body-request-id' },
      headers: new HttpHeaders({ 'X-Request-Id': 'header-request-id' }),
      status: 500,
      statusText: 'Internal Server Error',
      url: '/api/admin/workspace/5/journal?page=1&limit=20'
    }));

    expect(error.requestId).toBe('header-request-id');
  });

  it('should keep backend connectivity errors grouped under the connectivity message', () => {
    const error = new AppHttpError(new HttpErrorResponse({
      error: 'Gateway Timeout',
      status: 504,
      statusText: 'Gateway Timeout',
      url: '/api/admin/workspace/5/journal?page=1&limit=20'
    }));

    expect(error.message).toBe(BACKEND_CONNECTIVITY_ERROR_MESSAGE);
    expect(error.userMessage).toBe(BACKEND_CONNECTIVITY_ERROR_MESSAGE);
    expect(error.technicalMessage).toBe('Gateway Timeout');
  });

  it('should preserve user-safe validation messages', () => {
    const error = new AppHttpError(new HttpErrorResponse({
      error: { message: 'Das Datum ist ungültig.' },
      status: 400,
      statusText: 'Bad Request',
      url: '/api/admin/workspace/5/journal'
    }));

    expect(error.userMessage).toBe('Das Datum ist ungültig.');
  });
});
