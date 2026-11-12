import {
  filter, fromEvent, interval, merge, Observable, throttleTime
} from 'rxjs';

export function viewRefreshEvents(): Observable<unknown> {
  return merge(
    interval(30_000),
    fromEvent(window, 'focus'),
    fromEvent(window, 'online'),
    fromEvent(document, 'visibilitychange')
  ).pipe(
    filter(() => document.visibilityState !== 'hidden'),
    throttleTime(1000)
  );
}
