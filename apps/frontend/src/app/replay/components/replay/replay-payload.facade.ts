import { DestroyRef, Injectable, inject } from '@angular/core';
import {
  defer, EMPTY, firstValueFrom, MonoTypeOperatorFunction, Observable, Subject, takeUntil
} from 'rxjs';
import {
  ReplayBackendService, ReplayPayload, ReplayResponsePayload, ReplayServerTimings
} from '../../services/replay-backend.service';
import { ReplayAttemptContext } from '../../utils/replay-attempt-context';
import { ReplayNavigationContext } from '../../utils/replay-navigation-strategy';

export interface ReplayPayloadResult<T> {
  value: T;
  runId: number;
}

/** One replaceable player-data request, shared by full and response-only navigation. */
@Injectable()
export class ReplayPayloadFacade {
  private readonly backend = inject(ReplayBackendService);
  private readonly cancellation = new Subject<void>();
  private runId = 0;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.destroy());
  }

  invalidate(): void {
    this.runId += 1;
    this.cancellation.next();
  }

  isCurrent(runId: number): boolean {
    return !this.destroyed && runId === this.runId;
  }

  untilReplaced<T>(runId: number): MonoTypeOperatorFunction<T> {
    return source => defer(() => (this.isCurrent(runId) ? source.pipe(takeUntil(this.cancellation)) : EMPTY));
  }

  loadFull(
    context: ReplayNavigationContext,
    attempt: ReplayAttemptContext,
    authToken: string | undefined,
    codingMode: boolean
  ): Promise<ReplayPayloadResult<ReplayPayload> | null> {
    return this.load(attempt, () => this.backend.getReplayPayload(
      context.workspaceId, context.testPerson, context.unitId, authToken, codingMode, attempt.id
    ));
  }

  async loadResponse(
    context: ReplayNavigationContext,
    attempt: ReplayAttemptContext,
    authToken?: string
  ): Promise<ReplayPayloadResult<ReplayResponsePayload> | null> {
    const result = await this.load(attempt, () => this.backend.getReplayResponse(
      context.workspaceId, context.testPerson, context.unitId, authToken, attempt.id
    ));
    if (result && this.isCurrent(result.runId)) {
      attempt.recordPayloadServerTimings(this.responseTimings(result.value.serverTimings));
    }
    return result;
  }

  destroy(): void {
    this.destroyed = true;
    this.invalidate();
    this.cancellation.complete();
  }

  private async load<T>(
    attempt: ReplayAttemptContext,
    request: () => Observable<T>
  ): Promise<ReplayPayloadResult<T> | null> {
    if (this.destroyed) return null;
    this.invalidate();
    const runId = this.runId;
    attempt.startPayloadLoad(performance.now());
    try {
      const value = await firstValueFrom(request().pipe(takeUntil(this.cancellation)), { defaultValue: null });
      if (value === null || !this.isCurrent(runId)) return null;
      attempt.recordPayloadResponse(performance.now());
      return { value, runId };
    } catch (error) {
      if (!this.isCurrent(runId)) return null;
      throw error;
    }
  }

  private responseTimings(timings?: ReplayServerTimings): ReplayServerTimings | null {
    if (!timings) return null;
    return Object.fromEntries(Object.entries(timings)
      .filter(([, value]) => typeof value === 'number' || value === null)
      .map(([key, value]) => [`response${key.charAt(0).toUpperCase()}${key.slice(1)}`, value]));
  }
}
