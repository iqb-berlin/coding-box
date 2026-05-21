import {
  ActivatedRouteSnapshot, Router, RouterStateSnapshot, CanActivateFn, UrlTree
} from '@angular/router';
import { inject } from '@angular/core';
import { createAuthGuard, AuthGuardData } from 'keycloak-angular';
import { AppService } from '../services/app.service';
import { createAuthDataFailedUrlTree, createReAuthenticationUrlTree } from './auth-redirect';
import { createRequiredAuthDataGuardResult, waitForRequiredAuthData } from './auth-data-ready';

const isAccessAllowed = async (
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

  try {
    const authDataStatus = await waitForRequiredAuthData(appService);
    return createRequiredAuthDataGuardResult(router, state.url, authDataStatus);
  } catch (error) {
    return createAuthDataFailedUrlTree(router, state.url);
  }
};

export const canActivateAuth = createAuthGuard<CanActivateFn>(isAccessAllowed);
