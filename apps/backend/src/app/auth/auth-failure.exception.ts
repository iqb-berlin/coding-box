import { HttpException, HttpStatus } from '@nestjs/common';
import { AuthErrorCode } from '../../../../../api-dto/auth-error-dto';

const failures: Record<AuthErrorCode, { status: number; message: string }> = {
  'session-invalid': { status: HttpStatus.UNAUTHORIZED, message: 'The authentication session is no longer valid' },
  'provider-unavailable': { status: HttpStatus.SERVICE_UNAVAILABLE, message: 'The authentication provider is temporarily unavailable' },
  'configuration-error': { status: HttpStatus.SERVICE_UNAVAILABLE, message: 'The authentication provider configuration requires attention' }
};

/** Contains only fixed, public diagnostics; provider responses must never be forwarded. */
export class AuthFailureException extends HttpException {
  constructor(readonly code: AuthErrorCode) {
    super({ code, message: failures[code].message }, failures[code].status);
  }
}
