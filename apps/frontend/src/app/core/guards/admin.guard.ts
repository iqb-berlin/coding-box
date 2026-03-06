import {
  ActivatedRouteSnapshot, RouterStateSnapshot, CanActivateFn, UrlTree
} from '@angular/router';
import { createAuthGuard, AuthGuardData } from 'keycloak-angular';
import { inject } from '@angular/core';
import { filter, firstValueFrom, timeout } from 'rxjs';
import { AppService } from '../services/app.service';
import { AuthService } from '../services/auth.service';

const isAdminAccessAllowed = async (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
  authData: AuthGuardData
): Promise<boolean | UrlTree> => {
  const { authenticated } = authData;
  if (!authenticated) {
    return false;
  }

  const authService = inject(AuthService);
  const appService = inject(AppService);
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
      return false;
    }
  }

  return false;
};

export const canActivateAdmin = createAuthGuard<CanActivateFn>(isAdminAccessAllowed);
