import { AuthErrorCode } from '../../../../../../api-dto/auth-error-dto';
import { AuthRequestCancelledError } from './auth-request-cancelled.error';

export class AuthRefreshUnavailableError extends AuthRequestCancelledError {
  constructor(
    readonly code: Exclude<AuthErrorCode, 'session-invalid'> = 'provider-unavailable',
    readonly status = 0,
    readonly requestId = ''
  ) {
    super();
    this.name = 'AuthRefreshUnavailableError';
    this.message = 'Authentication renewal is unavailable; the stored session is preserved';
  }
}
