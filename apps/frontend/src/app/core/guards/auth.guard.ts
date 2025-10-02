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
import { createAuthDataFailedUrlTree, createReAuthenticationUrlTree } from './auth-redirect';
import { createRequiredAuthDataGuardResult, waitForRequiredAuthData } from './auth-data-ready';

const isAccessAllowed = async (
  _route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot
): Promise<boolean | UrlTree> => {
  const appService = inject(AppService);
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isLoggedIn()) {
    return createReAuthenticationUrlTree(router, state.url);
  }

  try {
    const authDataStatus = await waitForRequiredAuthData(appService);
    return createRequiredAuthDataGuardResult(router, state.url, authDataStatus);
  } catch {
    return createAuthDataFailedUrlTree(router, state.url);
  }
};

export const canActivateAuth: CanActivateFn = isAccessAllowed;
