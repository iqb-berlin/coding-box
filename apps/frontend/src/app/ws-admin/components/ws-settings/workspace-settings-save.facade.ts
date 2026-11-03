import {
  DestroyRef, Injectable, WritableSignal, inject, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import {
  EMPTY, Observable, Subject, catchError, concatMap, defer, finalize, tap
} from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';

interface SettingSnapshot {
  restore: () => void;
  revision: number;
  inputRevision: number;
  pending: number;
  hasSaved: boolean;
  hasDraft: boolean;
}

interface SettingWriteField {
  state: object;
  snapshot: SettingSnapshot;
  commit: () => void;
  rollback: () => void;
}

interface SettingWrite {
  workspaceId: number;
  generation: number;
  revision: number;
  fields: SettingWriteField[];
  persist: (workspaceId: number) => Observable<unknown>;
  successMessage: string;
}

/** Serialize writes, retaining the last confirmed value for each optimistic input. */
@Injectable()
export class WorkspaceSettingsSaveFacade {
  private readonly appService = inject(AppService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly snackBar = inject(MatSnackBar);
  private readonly translate = inject(TranslateService);
  private readonly writes = new Subject<SettingWrite>();
  private readonly snapshots = new Map<object, SettingSnapshot>();
  private readonly pendingFields = signal<ReadonlySet<object>>(new Set());
  private generation = 0;
  private revision = 0;

  constructor() {
    let workspaceId = this.appService.selectedWorkspaceId;
    this.appService.selectedWorkspaceId$.pipe(takeUntilDestroyed()).subscribe(id => {
      if (id === workspaceId) return;
      workspaceId = id;
      this.generation += 1;
      this.snapshots.clear();
      this.pendingFields.set(new Set());
    });
    this.writes.pipe(
      concatMap(write => {
        if (!this.isCurrent(write)) return EMPTY;
        return defer(() => write.persist(write.workspaceId)).pipe(
          takeUntilWorkspaceChanged(this.appService, write.workspaceId),
          tap(() => {
            write.fields.forEach(field => field.commit());
            if (this.isLatest(write)) this.showMessage(write.successMessage);
          }),
          catchError(() => {
            write.fields.forEach(field => field.rollback());
            if (this.isLatest(write)) this.showMessage('ws-settings.error-saving-setting', true);
            return EMPTY;
          }),
          finalize(() => write.fields.forEach(({ state, snapshot }) => {
            snapshot.pending -= 1;
            if (this.isCurrent(write) && snapshot.pending === 0) {
              this.pendingFields.update(fields => {
                const pending = new Set(fields);
                pending.delete(state);
                return pending;
              });
            }
          }))
        );
      }),
      takeUntilDestroyed()
    ).subscribe();
    this.destroyRef.onDestroy(() => {
      this.writes.complete();
      this.snapshots.clear();
      this.pendingFields.set(new Set());
    });
  }

  isPending<T>(state: WritableSignal<T>): boolean {
    return this.pendingFields().has(state);
  }

  initialize<T>(state: WritableSignal<T>, value: T): void {
    const snapshot = this.getSnapshot(state);
    // A delayed initial read must not overwrite an accepted write or pending input.
    if (snapshot.hasSaved) return;
    snapshot.restore = () => state.set(value);
    if (snapshot.pending === 0 && !snapshot.hasDraft) state.set(value);
  }

  edit<T>(state: WritableSignal<T>, value: T): void {
    const snapshot = this.getSnapshot(state);
    snapshot.inputRevision += 1;
    snapshot.hasDraft = true;
    state.set(value);
  }

  change<T>(
    changes: { state: WritableSignal<T>; value: T }[],
    persist: (workspaceId: number) => Observable<unknown>,
    successMessage: string
  ): void {
    if (!this.appService.selectedWorkspaceId || this.destroyRef.destroyed) return;
    this.revision += 1;
    const revision = this.revision;
    const fields = changes.map(({ state, value }) => {
      const snapshot = this.getSnapshot(state);
      snapshot.revision = revision;
      snapshot.inputRevision += 1;
      const inputRevision = snapshot.inputRevision;
      snapshot.hasDraft = false;
      snapshot.pending += 1;
      state.set(value);
      return {
        state,
        snapshot,
        commit: () => {
          snapshot.restore = () => state.set(value);
          snapshot.hasSaved = true;
        },
        rollback: () => {
          if (snapshot.revision === revision && snapshot.inputRevision === inputRevision && Object.is(state(), value)) {
            snapshot.restore();
          }
        }
      };
    });
    this.pendingFields.update(pending => new Set([...pending, ...changes.map(change => change.state)]));
    this.enqueue(fields, persist, successMessage, revision);
  }

  private enqueue(
    fields: SettingWriteField[],
    persist: SettingWrite['persist'],
    successMessage: string,
    revision: number
  ): void {
    this.writes.next({
      workspaceId: this.appService.selectedWorkspaceId,
      generation: this.generation,
      fields,
      persist,
      successMessage,
      revision
    });
  }

  private getSnapshot<T>(state: WritableSignal<T>): SettingSnapshot {
    let snapshot = this.snapshots.get(state);
    if (!snapshot) {
      const initial = state();
      snapshot = {
        restore: () => state.set(initial),
        revision: 0,
        inputRevision: 0,
        pending: 0,
        hasSaved: false,
        hasDraft: false
      };
      this.snapshots.set(state, snapshot);
    }
    return snapshot;
  }

  private isCurrent(write: SettingWrite): boolean {
    return write.generation === this.generation && write.workspaceId === this.appService.selectedWorkspaceId;
  }

  private isLatest(write: SettingWrite): boolean {
    return this.isCurrent(write) && (write.fields.length === 0 ||
      write.fields.some(({ snapshot }) => snapshot.revision === write.revision));
  }

  private showMessage(key: string, error = false): void {
    this.snackBar.open(this.translate.instant(key), this.translate.instant('close'), {
      duration: 3000,
      ...(error ? { panelClass: ['error-snackbar'] } : {})
    });
  }
}
