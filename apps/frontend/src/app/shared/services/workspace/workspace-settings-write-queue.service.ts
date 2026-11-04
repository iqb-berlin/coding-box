import { Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  BehaviorSubject, EMPTY, Observable, ReplaySubject, Subject, catchError,
  concatMap, defer, filter, finalize, map, take, tap
} from 'rxjs';

interface SettingWrite {
  workspaceId: number;
  persist: (workspaceId: number) => Observable<unknown>;
  result: ReplaySubject<unknown>;
}

/** Own accepted writes beyond the lifetime of the settings page. */
@Injectable({ providedIn: 'root' })
export class WorkspaceSettingsWriteQueueService {
  private readonly writes = new Subject<SettingWrite>();
  private readonly pending = new BehaviorSubject<ReadonlyMap<number, number>>(new Map());

  constructor() {
    this.writes.pipe(
      concatMap(write => defer(() => write.persist(write.workspaceId)).pipe(
        tap(value => write.result.next(value)),
        catchError(error => {
          write.result.error(error);
          return EMPTY;
        }),
        finalize(() => {
          write.result.complete();
          this.updatePending(write.workspaceId, -1);
        })
      )),
      takeUntilDestroyed()
    ).subscribe();
  }

  enqueue(workspaceId: number, persist: SettingWrite['persist']): Observable<unknown> {
    const result = new ReplaySubject<unknown>(1);
    this.updatePending(workspaceId, 1);
    this.writes.next({ workspaceId, persist, result });
    return result.asObservable();
  }

  whenIdle(workspaceId: number): Observable<void> {
    return this.pending.pipe(
      filter(pending => !pending.has(workspaceId)),
      take(1),
      map(() => undefined)
    );
  }

  private updatePending(workspaceId: number, change: number): void {
    const pending = new Map(this.pending.value);
    const count = (pending.get(workspaceId) ?? 0) + change;
    if (count > 0) pending.set(workspaceId, count);
    else pending.delete(workspaceId);
    this.pending.next(pending);
  }
}
