import { NextFunction, Response } from 'express';
import {
  REQUEST_ID_HEADER,
  RequestWithRequestId,
  createRequestId,
  normalizeRequestId
} from './request-id';

export function requestIdMiddleware(
  request: RequestWithRequestId,
  response: Response,
  next: NextFunction
): void {
  const requestId = normalizeRequestId(request.header(REQUEST_ID_HEADER)) || createRequestId();

  request.requestId = requestId;
  response.setHeader(REQUEST_ID_HEADER, requestId);

  next();
}
