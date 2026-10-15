import {
  map, Observable, of, shareReplay, switchMap, take
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
    take(1),
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
    }),
    // A submitted permission change must refresh global auth state even if its view closes.
    // The finite operation owns this subscription; view subscribers can still cancel their UI callbacks.
    shareReplay({ bufferSize: 1, refCount: false })
  );
}

export function hasCurrentAuthDataAfterMutation(
  result: MutationAuthDataRefreshResult
): boolean {
  return result.mutationSucceeded &&
    (result.authDataRefreshOutcome === 'updated' || result.authDataRefreshOutcome === 'superseded');
}
