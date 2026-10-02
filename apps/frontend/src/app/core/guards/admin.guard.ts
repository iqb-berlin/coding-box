import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Router,
  RouterStateSnapshot,
  UrlTree
} from '@angular/router';
import { inject } from '@angular/core';
import { AppService } from '../services/app.service';
import { AuthService } from '../services/auth.service';
import {
  createAccessDeniedUrlTree,
  createAuthDataFailedUrlTree,
  createReAuthenticationUrlTree
} from './auth-redirect';
import { createRequiredAuthDataGuardResult, waitForRequiredAuthData } from './auth-data-ready';
import { hasAdminBypass } from './admin-access';

const isAdminAccessAllowed = async (
  _route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot
): Promise<boolean | UrlTree> => {
  const appService = inject(AppService);
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isLoggedIn()) {
    return createReAuthenticationUrlTree(router, state.url);
  }

  const userRoles = authService.getRoles() || [];

  try {
    const authDataStatus = await waitForRequiredAuthData(appService);
    const authDataGuardResult = createRequiredAuthDataGuardResult(router, state.url, authDataStatus);
    if (authDataGuardResult !== true) {
      return authDataGuardResult;
    }

    return hasAdminBypass(userRoles, appService.authData.isAdmin) ?
      true :
      createAccessDeniedUrlTree(router, state.url);
  } catch {
    return createAuthDataFailedUrlTree(router, state.url);
  }
};

export const canActivateAdmin: CanActivateFn = isAdminAccessAllowed;
