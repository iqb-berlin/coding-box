import {
  ActivatedRouteSnapshot, RouterStateSnapshot, CanActivateFn, UrlTree
} from '@angular/router';
import { createAuthGuard, AuthGuardData } from 'keycloak-angular';
import { inject } from '@angular/core';
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
  const userRoles = authService.getRoles();

  const adminRoles = ['admin', 'system-admin', 'sys-admin', 'administrator'];
  const hasAdminRole = userRoles.some((role : string) => adminRoles.includes(role.toLowerCase())
  );

  return hasAdminRole;
};

export const canActivateAdmin = createAuthGuard<CanActivateFn>(isAdminAccessAllowed);
