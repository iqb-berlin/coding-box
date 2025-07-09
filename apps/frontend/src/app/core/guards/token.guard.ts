import {
  ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot, UrlTree
} from '@angular/router';
import { inject } from '@angular/core';
import { jwtDecode, JwtPayload } from 'jwt-decode';

/**
 * Guard that allows access if a valid auth token is provided in the query parameters
 * This is used for the replay component to allow access with just a token
 */
export const canActivateWithToken: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _: RouterStateSnapshot
): boolean | UrlTree => {
  const router = inject(Router);

  // Check if there's an auth token in the query parameters
  const authToken = route.queryParamMap.get('auth');

  if (!authToken) {
    // If no token is provided, redirect to the home page with an error code
    return router.createUrlTree(['/home'], {
      queryParams: { error: 'token_missing' }
    });
  }

  try {
    // Decode the token to verify it's a valid JWT
    const decoded: JwtPayload & { workspace: string } = jwtDecode(authToken);

    // Check if the token has expired
    const currentTime = Math.floor(Date.now() / 1000);
    if (decoded.exp && decoded.exp < currentTime) {
      // Token has expired, redirect to home with an error code
      return router.createUrlTree(['/home'], {
        queryParams: { error: 'token_expired' }
      });
    }

    // Check if the token has the required workspace claim
    if (!decoded.workspace) {
      return router.createUrlTree(['/home'], {
        queryParams: { error: 'token_invalid' }
      });
    }

    // Token is valid, allow access
    return true;
  } catch (error) {
    // Token is invalid, redirect to home with an error code
    return router.createUrlTree(['/home'], {
      queryParams: { error: 'token_invalid' }
    });
  }
};
