import { Router, UrlTree } from '@angular/router';
import {
  firstValueFrom,
  filter,
  map,
  merge,
  timeout
} from 'rxjs';
import { AppService } from '../services/app.service';
import { createAuthDataFailedUrlTree, createReAuthenticationUrlTree } from './auth-redirect';

const AUTH_DATA_READY_TIMEOUT_MS = 15000;
export type RequiredAuthDataStatus = 'ready' | 'auth-data-failed' | 'session-expired';

export async function waitForRequiredAuthData(appService: AppService): Promise<RequiredAuthDataStatus> {
  return firstValueFrom(
    merge(
      appService.authData$.pipe(
        filter(data => data.userId > 0),
        map(() => 'ready' as const)
      ),
      appService.authBootstrapStatus$.pipe(
        filter(status => status === 'auth-data-failed' || status === 'session-expired'),
        map(status => status as RequiredAuthDataStatus)
      )
    ).pipe(timeout(AUTH_DATA_READY_TIMEOUT_MS))
  );
}

export function createRequiredAuthDataGuardResult(
  router: Router,
  returnUrl: string,
  status: RequiredAuthDataStatus
): true | UrlTree {
  switch (status) {
    case 'ready':
      return true;
    case 'session-expired':
      return createReAuthenticationUrlTree(router, returnUrl);
    case 'auth-data-failed':
    default:
      return createAuthDataFailedUrlTree(router, returnUrl);
  }
}
