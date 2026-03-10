import {
  ActivatedRouteSnapshot, RouterStateSnapshot, CanActivateFn, UrlTree
} from '@angular/router';
import { inject } from '@angular/core';
import { filter, firstValueFrom, timeout } from 'rxjs';
import { createAuthGuard, AuthGuardData } from 'keycloak-angular';
import { AppService } from '../services/app.service';

const isAccessAllowed = async (
  route: ActivatedRouteSnapshot,
  _: RouterStateSnapshot,
  authData: AuthGuardData
): Promise<boolean | UrlTree> => {
  const { authenticated } = authData;

  if (!authenticated) {
    return false;
  }

  const appService = inject(AppService);

  try {
    await firstValueFrom(
      appService.authData$.pipe(
        filter(data => data.userId > 0),
        timeout(5000)
      )
    );
    return true;
  } catch (error) {
    return false;
  }
};

export const canActivateAuth = createAuthGuard<CanActivateFn>(isAccessAllowed);
