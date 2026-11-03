import { Injectable, inject, signal } from '@angular/core';
import { Params } from '@angular/router';
import { base64ToUtf8 } from '../../../shared/utils/common-utils';
import { ReplayCodingService } from '../../services/replay-coding.service';
import { ReplaySessionLoadError, ReplaySessionLoadRequest, ReplaySessionLoaderService } from '../../services/replay-session-loader.service';
import { UnitsReplay } from '../../services/units-replay.service';
import { ReplayAttemptContext } from '../../utils/replay-attempt-context';

/** Owns route session sources, cache identity and once-per-job initialization. */
@Injectable()
export class ReplayRouteSessionService {
  private readonly loader = inject(ReplaySessionLoaderService);
  private readonly coding = inject(ReplayCodingService);
  readonly unitsData = signal<UnitsReplay | null>(null);
  private loadedUnitsKey: string | null = null;
  private progressJobKey: string | null = null;
  private activeJobKey: string | null = null;

  prepare(params: Params, authToken: string, attempt: ReplayAttemptContext): boolean {
    const request = this.sessionRequest(params, authToken, attempt);
    const retainedKey = this.loader.retainOnly(request);
    return retainedKey !== null && this.unitsData()?.id === Number(params.codingJobId) &&
      this.loadedUnitsKey === retainedKey;
  }

  async load(
    params: Params,
    authToken: string,
    attempt: ReplayAttemptContext,
    isCurrent: () => boolean
  ): Promise<UnitsReplay | null> {
    if (params.unitsData) return this.readUnits(() => base64ToUtf8(params.unitsData));
    const request = this.sessionRequest(params, authToken, attempt);
    if (request) return this.loadSession(request, attempt, isCurrent);
    if (params.bookletKey) return this.readUnits(() => localStorage.getItem(params.bookletKey));
    return null;
  }

  hasLoadedProgress(workspaceId: number, jobId: number): boolean {
    return this.progressJobKey === `${workspaceId}:${jobId}`;
  }

  async restoreProgress(workspaceId: number, jobId: number, isCurrent: () => boolean): Promise<boolean> {
    if (this.hasLoadedProgress(workspaceId, jobId)) return true;
    try {
      await this.coding.loadSavedCodingProgress(workspaceId, jobId);
    } catch (error) {
      if (!isCurrent()) return false;
      this.unitsData.set(null);
      this.progressJobKey = null;
      throw error;
    }
    if (!isCurrent()) return false;
    this.progressJobKey = `${workspaceId}:${jobId}`;
    return true;
  }

  activate(workspaceId: number, jobId: number, review: boolean): void {
    const jobKey = `${workspaceId}:${jobId}`;
    if (review || this.coding.isCompletedJobReview || this.coding.isCodingJobFinalized || this.activeJobKey === jobKey) return;
    this.coding.updateCodingJobStatus(workspaceId, jobId, 'active');
    this.activeJobKey = jobKey;
  }

  clear(): void {
    this.loader.clear();
    this.unitsData.set(null);
    this.loadedUnitsKey = null;
    this.progressJobKey = null;
    this.activeJobKey = null;
  }

  private sessionRequest(params: Params, authToken: string, attempt: ReplayAttemptContext): ReplaySessionLoadRequest | null {
    if (!params.codingJobId || !params.workspaceId || params.unitsData) return null;
    return {
      workspaceId: Number(params.workspaceId),
      codingJobId: Number(params.codingJobId),
      authToken,
      onlyOpen: params.onlyOpen === 'true',
      replayAttemptId: attempt.id
    };
  }

  private readUnits(read: () => string | null): UnitsReplay | null {
    try {
      const stored = read();
      return stored ? JSON.parse(stored) as UnitsReplay : null;
    } catch {
      return null;
    }
  }

  private async loadSession(
    request: ReplaySessionLoadRequest,
    attempt: ReplayAttemptContext,
    isCurrent: () => boolean
  ): Promise<UnitsReplay | null> {
    const unitsKey = this.loader.getRequestKey(request);
    if (this.unitsData()?.id === request.codingJobId && this.loadedUnitsKey === unitsKey) return this.unitsData();
    const pending = this.loader.load(request);
    try {
      const result = await pending;
      if (!isCurrent()) return null;
      this.loader.discard(request, pending);
      attempt.recordCodingSession(result.timings);
      if (result.source === 'session') {
        this.coding.applyReplayCodingSession(result.session);
        this.progressJobKey = `${request.workspaceId}:${request.codingJobId}`;
      }
      if (result.unitsData) this.loadedUnitsKey = unitsKey;
      return result.unitsData;
    } catch (error) {
      if (!isCurrent()) return null;
      this.loader.discard(request, pending);
      if (error instanceof ReplaySessionLoadError) {
        attempt.recordCodingSession(error.timings);
        throw error.requestError;
      }
      throw error;
    }
  }
}
