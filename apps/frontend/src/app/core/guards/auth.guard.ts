import {
  ActivatedRouteSnapshot, Router, RouterStateSnapshot, CanActivateFn, UrlTree
} from '@angular/router';
import { inject } from '@angular/core';
import { filter, firstValueFrom, timeout } from 'rxjs';
import { createAuthGuard, AuthGuardData } from 'keycloak-angular';
import { AppService } from '../services/app.service';
import { createAuthDataFailedUrlTree, createReAuthenticationUrlTree } from './auth-redirect';

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
    await firstValueFrom(
      appService.authData$.pipe(
        filter(data => data.userId > 0),
        timeout(5000)
      )
    );
    return true;
  } catch (error) {
    return createAuthDataFailedUrlTree(router, state.url);
  }
};

export const canActivateAuth = createAuthGuard<CanActivateFn>(isAccessAllowed);
