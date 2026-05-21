import { Request } from 'express';
import { randomUUID } from 'crypto';

export const REQUEST_ID_HEADER = 'X-Request-Id';

export interface RequestWithRequestId extends Request {
  requestId?: string;
}

export function createRequestId(): string {
  return randomUUID();
}

export function normalizeRequestId(value: unknown): string | undefined {
  const requestId = Array.isArray(value) ? value[0] : value;

  if (typeof requestId !== 'string') {
    return undefined;
  }

  const trimmedRequestId = requestId.trim();

  if (
    trimmedRequestId.length < 1 ||
    trimmedRequestId.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(trimmedRequestId)
  ) {
    return undefined;
  }

  return trimmedRequestId;
}
