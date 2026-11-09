import {
  HttpContext,
  HttpContextToken
} from '@angular/common/http';

export const SUPPRESS_GLOBAL_HTTP_ERROR = new HttpContextToken<boolean>(() => false);
export const SUPPRESS_AUTH_ERROR_REDIRECT = new HttpContextToken<boolean>(() => false);
// Local permission feedback must not suppress application-session expiry (HTTP 401).
export const SUPPRESS_FORBIDDEN_HTTP_ERROR = new HttpContextToken<boolean>(() => false);

export function suppressGlobalHttpErrorContext(): HttpContext {
  return new HttpContext().set(SUPPRESS_GLOBAL_HTTP_ERROR, true);
}

export function suppressGlobalAndAuthRedirectHttpErrorContext(): HttpContext {
  return suppressGlobalHttpErrorContext().set(SUPPRESS_AUTH_ERROR_REDIRECT, true);
}

export function suppressGlobalAndForbiddenHttpErrorContext(): HttpContext {
  return suppressGlobalHttpErrorContext().set(SUPPRESS_FORBIDDEN_HTTP_ERROR, true);
}
