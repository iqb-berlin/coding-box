import {
  MonoTypeOperatorFunction, retry, throwError, timer
} from 'rxjs';

export function retryTransientStatus<T>(): MonoTypeOperatorFunction<T> {
  return retry({
    count: 3,
    delay: (error: { status?: number }, attempt) => (
      [0, 408, 429, 500, 502, 503, 504].includes(error?.status ?? -1) ?
        timer(2000 * 2 ** (attempt - 1)) :
        throwError(() => error)
    )
  });
}
