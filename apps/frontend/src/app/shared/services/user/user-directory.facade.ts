import {
  computed, inject, Injectable, DestroyRef, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  catchError, defer, finalize, Observable, of, Subject, switchMap, tap
} from 'rxjs';
import type { UserFullDto } from '../../../../../../../api-dto/user/user-full-dto';
import { viewRefreshEvents } from '../../utils/view-refresh';

export type UserDirectoryStatus = 'idle' | 'loading' | 'loaded' | 'error';
type DirectoryState = { status: 'loaded'; users: UserFullDto[] } |
{ status: Exclude<UserDirectoryStatus, 'loaded'> };

/** One directory per view. A reload replaces its predecessor, including late errors. */
@Injectable()
export class UserDirectoryFacade {
  private readonly state = signal<DirectoryState>({ status: 'idle' });
  private readonly requests = new Subject<{ request: (background: boolean) => Observable<UserFullDto[]>; background: boolean }>();
  private currentRequest?: (background: boolean) => Observable<UserFullDto[]>;
  private loading = false;
  readonly status = computed(() => this.state().status);
  readonly users = computed(() => {
    const state = this.state();
    return state.status === 'loaded' ? state.users : [];
  });

  constructor() {
    this.requests.pipe(
      switchMap(({ request, background }) => defer(() => {
        let settled = false;
        this.loading = true;
        if (!background) this.state.set({ status: 'loading' });
        return defer(() => request(background)).pipe(
          tap(users => { settled = true; this.state.set({ status: 'loaded', users }); }),
          catchError(() => {
            settled = true;
            if (!background) this.state.set({ status: 'error' });
            return of(null);
          }),
          finalize(() => {
            this.loading = false;
            if (!settled && !background) this.state.set({ status: 'idle' });
          })
        );
      })),
      takeUntilDestroyed()
    ).subscribe();
    viewRefreshEvents().pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.currentRequest && !this.loading && this.status() !== 'idle') {
        this.requests.next({ request: this.currentRequest, background: true });
      }
    });
    inject(DestroyRef).onDestroy(() => this.requests.complete());
  }

  load(request: (background: boolean) => Observable<UserFullDto[]>): void {
    this.currentRequest = request;
    this.requests.next({ request, background: false });
  }
}
