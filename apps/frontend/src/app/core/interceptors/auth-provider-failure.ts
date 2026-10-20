import { HttpErrorResponse } from '@angular/common/http';
import { AuthErrorCode } from '../../../../../../api-dto/auth-error-dto';

export function getAuthProviderFailureCode(error: unknown): Exclude<AuthErrorCode, 'session-invalid'> | undefined {
  if (!(error instanceof HttpErrorResponse) || error.status !== 503) return undefined;
  const code = error.error?.code;
  return code === 'provider-unavailable' || code === 'configuration-error' ? code : undefined;
}
