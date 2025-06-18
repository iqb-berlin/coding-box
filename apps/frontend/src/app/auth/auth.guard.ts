import {
  ActivatedRouteSnapshot, RouterStateSnapshot, CanActivateFn, UrlTree
} from '@angular/router';
import { createAuthGuard, AuthGuardData } from 'keycloak-angular';

const isAccessAllowed = async (
  route: ActivatedRouteSnapshot,
  _: RouterStateSnapshot,
  authData: AuthGuardData
): Promise<boolean | UrlTree> => {
  const { authenticated } = authData;

  return authenticated;
};

export const canActivateAuth = createAuthGuard<CanActivateFn>(isAccessAllowed);
