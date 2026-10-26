import {
  computed, inject, Injectable, DestroyRef, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  catchError, defer, finalize, Observable, of, Subject, switchMap, tap
} from 'rxjs';
import type { UserFullDto } from '../../../../../../../api-dto/user/user-full-dto';

export type UserDirectoryStatus = 'idle' | 'loading' | 'loaded' | 'error';
type DirectoryState = { status: 'loaded'; users: UserFullDto[] } |
{ status: Exclude<UserDirectoryStatus, 'loaded'> };

/** One directory per view. A reload replaces its predecessor, including late errors. */
@Injectable()
export class UserDirectoryFacade {
  private readonly state = signal<DirectoryState>({ status: 'idle' });
  private readonly requests = new Subject<() => Observable<UserFullDto[]>>();
  readonly status = computed(() => this.state().status);
  readonly users = computed(() => {
    const state = this.state();
    return state.status === 'loaded' ? state.users : [];
  });

  constructor() {
    this.requests.pipe(
      switchMap(request => defer(() => {
        let settled = false;
        this.state.set({ status: 'loading' });
        return defer(request).pipe(
          tap(users => { settled = true; this.state.set({ status: 'loaded', users }); }),
          catchError(() => {
            settled = true;
            this.state.set({ status: 'error' });
            return of(null);
          }),
          finalize(() => { if (!settled) this.state.set({ status: 'idle' }); })
        );
      })),
      takeUntilDestroyed()
    ).subscribe();
    inject(DestroyRef).onDestroy(() => this.requests.complete());
  }

  load(request: () => Observable<UserFullDto[]>): void { this.requests.next(request); }
}
