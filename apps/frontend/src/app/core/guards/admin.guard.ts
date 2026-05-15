import {
  ActivatedRouteSnapshot, Router, RouterStateSnapshot, CanActivateFn, UrlTree
} from '@angular/router';
import { createAuthGuard, AuthGuardData } from 'keycloak-angular';
import { inject } from '@angular/core';
import { AppService } from '../services/app.service';
import { AuthService } from '../services/auth.service';
import {
  createAccessDeniedUrlTree,
  createAuthDataFailedUrlTree,
  createReAuthenticationUrlTree
} from './auth-redirect';
import { createRequiredAuthDataGuardResult, waitForRequiredAuthData } from './auth-data-ready';

const isAdminAccessAllowed = async (
  _route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
  authData: AuthGuardData
): Promise<boolean | UrlTree> => {
  const appService = inject(AppService);
  const router = inject(Router);
  const { authenticated } = authData;
  if (!authenticated) {
    return createReAuthenticationUrlTree(router, state.url);
  }

  const authService = inject(AuthService);
  const userRoles = authService.getRoles();

  const adminRoles = ['admin', 'system-admin', 'sys-admin', 'administrator'];
  const hasAdminRole = userRoles.some((role : string) => adminRoles.includes(role.toLowerCase())
  );

  if (hasAdminRole) {
    try {
      const authDataStatus = await waitForRequiredAuthData(appService);
      return createRequiredAuthDataGuardResult(router, state.url, authDataStatus);
    } catch {
      return createAuthDataFailedUrlTree(router, state.url);
    }
  }

  return createAccessDeniedUrlTree(router, state.url);
};

export const canActivateAdmin = createAuthGuard<CanActivateFn>(isAdminAccessAllowed);
