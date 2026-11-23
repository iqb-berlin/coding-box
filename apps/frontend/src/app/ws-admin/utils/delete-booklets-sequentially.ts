import {
  Observable, catchError, concatMap, defer, from, map, of, reduce
} from 'rxjs';

export function deleteBookletsSequentially(
  bookletIds: readonly number[],
  deleteBooklet: (id: number) => Observable<{ success: boolean }>
): Observable<{ successCount: number; failCount: number }> {
  return from(bookletIds).pipe(
    concatMap(id => defer(() => deleteBooklet(id)).pipe(
      map(result => result.success),
      catchError(() => of(false))
    )),
    reduce((counts, success) => ({
      successCount: counts.successCount + Number(success),
      failCount: counts.failCount + Number(!success)
    }), { successCount: 0, failCount: 0 })
  );
}
