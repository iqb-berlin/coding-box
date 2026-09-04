import {
  map, Observable, of, switchMap
} from 'rxjs';
import { AppService, AuthDataRefreshOutcome } from '../services/app.service';

export type MutationAuthDataRefreshResult =
  | {
    mutationSucceeded: false;
    authDataRefreshOutcome: 'not-requested';
  }
  | {
    mutationSucceeded: true;
    authDataRefreshOutcome: AuthDataRefreshOutcome;
  };

export function runMutationAndRefreshAuthData(
  appService: AppService,
  mutation$: Observable<boolean>
): Observable<MutationAuthDataRefreshResult> {
  return mutation$.pipe(
    switchMap(mutationSucceeded => {
      if (!mutationSucceeded) {
        return of<MutationAuthDataRefreshResult>({
          mutationSucceeded: false,
          authDataRefreshOutcome: 'not-requested'
        });
      }

      return appService.refreshAuthData().pipe(
        map(authDataRefreshOutcome => ({
          mutationSucceeded: true as const,
          authDataRefreshOutcome
        }))
      );
    })
  );
}

export function hasCurrentAuthDataAfterMutation(
  result: MutationAuthDataRefreshResult
): boolean {
  return result.mutationSucceeded &&
    (result.authDataRefreshOutcome === 'updated' || result.authDataRefreshOutcome === 'superseded');
}
