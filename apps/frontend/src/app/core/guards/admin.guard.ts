import {
  ActivatedRouteSnapshot, Router, RouterStateSnapshot, CanActivateFn, UrlTree
} from '@angular/router';
import { createAuthGuard, AuthGuardData } from 'keycloak-angular';
import { inject } from '@angular/core';
import { filter, firstValueFrom, timeout } from 'rxjs';
import { AppService } from '../services/app.service';
import { AuthService } from '../services/auth.service';
import {
  createAccessDeniedUrlTree,
  createAuthDataFailedUrlTree,
  createReAuthenticationUrlTree
} from './auth-redirect';

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
      await firstValueFrom(
        appService.authData$.pipe(
          filter(data => data.userId > 0),
          timeout(5000)
        )
      );
      return true;
    } catch {
      return createAuthDataFailedUrlTree(router, state.url);
    }
  }

  return createAccessDeniedUrlTree(router, state.url);
};

export const canActivateAdmin = createAuthGuard<CanActivateFn>(isAdminAccessAllowed);
