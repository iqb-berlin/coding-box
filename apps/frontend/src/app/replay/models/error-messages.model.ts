import type { HttpErrorResponse } from '@angular/common/http';

export interface ErrorMessages {
  QueryError: string;
  ParamsError: string;
  401: string;
  UnitIdError: string;
  TestPersonError: string;
  PlayerError: string;
  ResponsesError: string;
  ambiguousResponses: string;
  notInList: string;
  notCurrent: string;
  unknown: string;
  tokenExpired: string;
  tokenInvalid: string;
}

export function replayErrorKey(error: HttpErrorResponse, hasResponseContext: boolean): keyof ErrorMessages {
  if (error.status === 401) return 401;
  if (error.status === 404 && hasResponseContext) return 'ResponsesError';
  if (error.status === 409 && error.error?.code === 'REPLAY_RESPONSE_AMBIGUOUS') return 'ambiguousResponses';
  return error.message as keyof ErrorMessages;
}
