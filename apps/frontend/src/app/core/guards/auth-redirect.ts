import { Router, UrlTree } from '@angular/router';

export const AUTH_QUERY_PARAM_SESSION_EXPIRED = 'session-expired';
export const AUTH_QUERY_PARAM_AUTH_DATA_FAILED = 'auth-data-failed';
export const AUTH_QUERY_PARAM_ACCESS_DENIED = 'access-denied';

type AuthQueryParamReason =
  typeof AUTH_QUERY_PARAM_SESSION_EXPIRED
  | typeof AUTH_QUERY_PARAM_AUTH_DATA_FAILED
  | typeof AUTH_QUERY_PARAM_ACCESS_DENIED;

export function isReturnableRoute(returnUrl?: string): returnUrl is string {
  return !!returnUrl &&
    returnUrl.startsWith('/') &&
    !returnUrl.startsWith('//') &&
    returnUrl !== '/' &&
    !returnUrl.startsWith('/home');
}

export function createAuthRedirectUrlTree(
  router: Router,
  authReason: AuthQueryParamReason,
  returnUrl?: string
): UrlTree {
  const queryParams: Record<string, string> = {
    auth: authReason
  };

  if (isReturnableRoute(returnUrl)) {
    queryParams.returnUrl = returnUrl;
  }

  return router.createUrlTree(['/home'], { queryParams });
}

export function createReAuthenticationUrlTree(
  router: Router,
  returnUrl?: string
): UrlTree {
  return createAuthRedirectUrlTree(router, AUTH_QUERY_PARAM_SESSION_EXPIRED, returnUrl);
}

export function createAuthDataFailedUrlTree(
  router: Router,
  returnUrl?: string
): UrlTree {
  return createAuthRedirectUrlTree(router, AUTH_QUERY_PARAM_AUTH_DATA_FAILED, returnUrl);
}

export function createAccessDeniedUrlTree(
  router: Router,
  returnUrl?: string
): UrlTree {
  return createAuthRedirectUrlTree(router, AUTH_QUERY_PARAM_ACCESS_DENIED, returnUrl);
}
