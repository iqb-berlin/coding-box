import { Logger } from '@nestjs/common';
import { AuthErrorCode } from '../../../../../api-dto/auth-error-dto';
import { normalizeRequestId } from '../http/request-id';
import { AuthFailureException } from './auth-failure.exception';

export class JwksEndpointFailure extends AuthFailureException {
  constructor(readonly providerStatus: number) {
    super([400, 401, 403, 404].includes(providerStatus) ? 'configuration-error' : 'provider-unavailable');
  }
}

export function isHttpEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function logAuthProviderFailure(
  logger: Logger,
  event: string,
  endpoint: string,
  errorClass: AuthErrorCode,
  httpStatus: number | null,
  requestId?: string
): void {
  let publicEndpoint = 'invalid-provider-endpoint';
  try {
    const url = new URL(endpoint);
    publicEndpoint = `${url.origin}${url.pathname}`;
  } catch {
    // Never include an invalid URL, credentials, query, or provider response.
  }
  logger.warn({
    event,
    errorClass,
    endpoint: publicEndpoint,
    httpStatus,
    requestId: normalizeRequestId(requestId)
  });
}

/** Passport returns failed strategies as info, including an array for fallback strategies. */
export function getAuthProviderFailure(info: unknown): AuthFailureException | undefined {
  return (Array.isArray(info) ? info : [info]).find(value => value instanceof AuthFailureException);
}
