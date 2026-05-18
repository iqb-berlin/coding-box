import {
  HttpContext,
  HttpContextToken
} from '@angular/common/http';

export const SUPPRESS_GLOBAL_HTTP_ERROR = new HttpContextToken<boolean>(() => false);

export function suppressGlobalHttpErrorContext(): HttpContext {
  return new HttpContext().set(SUPPRESS_GLOBAL_HTTP_ERROR, true);
}
