import {
  ActivatedRouteSnapshot, RouterStateSnapshot, Router, CanActivateFn, UrlTree
} from '@angular/router';
import { inject } from '@angular/core';
import { createAuthGuard, AuthGuardData } from 'keycloak-angular';

const isAccessAllowed = async (
  route: ActivatedRouteSnapshot,
  _: RouterStateSnapshot,
  authData: AuthGuardData
): Promise<boolean | UrlTree> => {
  const { authenticated, grantedRoles } = authData;

  // @ts-ignore
  const requiredRole = route.data.role;
  if (!requiredRole) {
    return false;
  }

  const hasRequiredRole = (role: string): boolean => Object.values(grantedRoles.resourceRoles)
    .some(roles => roles.includes(role));

  if (authenticated && hasRequiredRole(requiredRole)) {
    return true;
  }

  const router = inject(Router);
  return router.parseUrl('/forbidden');
};

export const canActivateAuthRole = createAuthGuard<CanActivateFn>(isAccessAllowed);
