import {
  map, Observable, of
} from 'rxjs';
import { AppService } from '../services/app.service';

export interface MutationAuthDataRefreshResult {
  mutationSucceeded: boolean;
  authDataRefreshed: boolean;
}

export function refreshAuthDataAfterMutation(
  appService: AppService,
  mutationSucceeded: boolean
): Observable<MutationAuthDataRefreshResult> {
  if (!mutationSucceeded) {
    return of({
      mutationSucceeded: false,
      authDataRefreshed: false
    });
  }

  return appService.refreshAuthData().pipe(
    map(authDataRefreshed => ({
      mutationSucceeded: true,
      authDataRefreshed
    }))
  );
}
