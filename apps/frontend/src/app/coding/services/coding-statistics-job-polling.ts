import {
  EMPTY, Observable, Subscription, catchError, exhaustMap, takeWhile, timer
} from 'rxjs';
import { CodingJobStatus } from '../../models/coding-interfaces';
import { retryTransientStatus } from '../../shared/utils/retry-transient-status';

export type ActiveStatisticsFetch = {
  workspaceId: number;
  subscription: Subscription;
};

export function pollCodingStatisticsStatus(
  loadStatus: () => Observable<CodingJobStatus>,
  reportStatusError: () => void
): Observable<CodingJobStatus> {
  return timer(0, 2000).pipe(
    exhaustMap(() => loadStatus().pipe(retryTransientStatus())),
    takeWhile(status => ['pending', 'processing'].includes(status.status), true),
    catchError(() => {
      reportStatusError();
      return EMPTY;
    })
  );
}
