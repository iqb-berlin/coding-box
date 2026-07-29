import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  Observable, catchError, finalize, map, of, shareReplay
} from 'rxjs';
import { CodingStatusRevisionDto } from '../../../../../../api-dto/coding/coding-status-revision.dto';
import { SERVER_URL } from '../../injection-tokens';
import {
  CODING_STATUS_SNAPSHOT_KEY_PREFIX,
  clearCodingStatusSnapshots,
  getCodingStatusSessionStorage
} from '../../core/services/coding-status-session-storage';
import {
  CodingOverviewStatusSnapshot,
  CodingStatusSnapshotSurface,
  ManualCodingSnapshotDisplayParameters,
  ManualCodingSnapshotTab,
  ManualCodingStatusSnapshot,
  PlanningStatusState
} from './coding-status-snapshot.model';

type CodingStatusSnapshot =
  CodingOverviewStatusSnapshot | ManualCodingStatusSnapshot;
type SnapshotMetadataKeys =
  'schemaVersion' | 'checkedAt' | 'surface' | 'fullyChecked';

const PLANNING_STATUS_STATES = new Set<PlanningStatusState>([
  'not-checked',
  'loading',
  'planning-data-required',
  'preparation-required',
  'warning',
  'planning-incomplete',
  'planning-ready',
  'training-ready',
  'execution-ready',
  'double-coding-review-ready',
  'stale-source-review',
  'completion-ready',
  'progress-unavailable',
  'complete'
]);
const MANUAL_CODING_TABS = new Set<ManualCodingSnapshotTab>([
  'preparation',
  'planning',
  'training',
  'execution',
  'completion'
]);
const MANUAL_DISPLAY_PARAMETER_KEYS: (keyof ManualCodingSnapshotDisplayParameters)[] = [
  'variableConflicts',
  'missingVariables',
  'unassignedCases',
  'activeTrainingJobs',
  'staleSourceJobs',
  'openDoubleCodingConflicts',
  'manualCodeAvailabilityWarnings'
];

@Injectable({ providedIn: 'root' })
export class CodingStatusSnapshotService {
  private readonly http = inject(HttpClient);
  private readonly serverUrl = inject(SERVER_URL);
  private readonly revisionRequests = new Map<
  number,
  Observable<CodingStatusRevisionDto>
  >();

  restoreOverview(userId: number, workspaceId: number) {
    return this.restore<CodingOverviewStatusSnapshot>(
      userId,
      workspaceId,
      'overview'
    );
  }

  restoreManual(userId: number, workspaceId: number) {
    return this.restore<ManualCodingStatusSnapshot>(
      userId,
      workspaceId,
      'manual'
    );
  }

  saveOverview(
    snapshot: Omit<CodingOverviewStatusSnapshot, SnapshotMetadataKeys>
  ): void {
    this.save({
      ...snapshot,
      schemaVersion: 1,
      checkedAt: new Date().toISOString(),
      surface: 'overview',
      fullyChecked: true
    });
  }

  saveManual(
    snapshot: Omit<ManualCodingStatusSnapshot, SnapshotMetadataKeys>
  ): void {
    this.save({
      ...snapshot,
      schemaVersion: 1,
      checkedAt: new Date().toISOString(),
      surface: 'manual',
      fullyChecked: true
    });
  }

  getRevision(
    workspaceId: number,
    fresh = false
  ): Observable<CodingStatusRevisionDto> {
    if (fresh) {
      return this.requestRevision(workspaceId);
    }
    const pending = this.revisionRequests.get(workspaceId);
    if (pending) {
      return pending;
    }

    const request$ = this.requestRevision(workspaceId).pipe(
      finalize(() => this.revisionRequests.delete(workspaceId)),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    this.revisionRequests.set(workspaceId, request$);
    return request$;
  }

  clearWorkspace(workspaceId: number): void {
    clearCodingStatusSnapshots(workspaceId);
  }

  clearAll(): void {
    clearCodingStatusSnapshots();
  }

  private requestRevision(
    workspaceId: number
  ): Observable<CodingStatusRevisionDto> {
    return this.http.get<CodingStatusRevisionDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/revision`
    );
  }

  private restore<T extends CodingStatusSnapshot>(
    userId: number,
    workspaceId: number,
    surface: CodingStatusSnapshotSurface
  ): Observable<T | null> {
    const key = this.buildKey(userId, workspaceId, surface);
    const snapshot = this.read<T>(key, userId, workspaceId, surface);
    if (!snapshot) {
      return of(null);
    }

    return this.getRevision(workspaceId).pipe(
      map(revision => {
        if (
          !this.isRevisionValid(revision, workspaceId) ||
          !revision.stable ||
          revision.revision !== snapshot.revision ||
          revision.statusRevision !== snapshot.statusRevision
        ) {
          this.remove(key);
          return null;
        }
        return snapshot;
      }),
      catchError(() => of(null))
    );
  }

  private save(snapshot: CodingStatusSnapshot): void {
    if (
      !this.isSnapshotValid(
        snapshot,
        snapshot.userId,
        snapshot.workspaceId,
        snapshot.surface
      )
    ) {
      return;
    }
    try {
      getCodingStatusSessionStorage()?.setItem(
        this.buildKey(snapshot.userId, snapshot.workspaceId, snapshot.surface),
        JSON.stringify(snapshot)
      );
    } catch {
      // Browser storage is optional.
    }
  }

  private read<T extends CodingStatusSnapshot>(
    key: string,
    userId: number,
    workspaceId: number,
    surface: CodingStatusSnapshotSurface
  ): T | null {
    try {
      const raw = getCodingStatusSessionStorage()?.getItem(key);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as CodingStatusSnapshot;
      if (!this.isSnapshotValid(parsed, userId, workspaceId, surface)) {
        this.remove(key);
        return null;
      }
      return parsed as T;
    } catch {
      this.remove(key);
      return null;
    }
  }

  private isSnapshotValid(
    value: unknown,
    userId: number,
    workspaceId: number,
    surface: CodingStatusSnapshotSurface
  ): value is CodingStatusSnapshot {
    if (
      !this.isObject(value) ||
      value.schemaVersion !== 1 ||
      value.userId !== userId ||
      value.workspaceId !== workspaceId ||
      value.surface !== surface ||
      value.fullyChecked !== true ||
      !this.isPositiveInteger(value.userId) ||
      !this.isPositiveInteger(value.workspaceId) ||
      !this.isNonNegativeInteger(value.revision) ||
      typeof value.statusRevision !== 'string' ||
      !/^(0|[1-9]\d*)$/.test(value.statusRevision) ||
      typeof value.checkedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.checkedAt))
    ) {
      return false;
    }
    if (surface === 'overview') {
      return (
        this.isObject(value.freshness) &&
        this.isObject(value.readiness) &&
        value.freshness.workspaceId === workspaceId &&
        value.readiness.workspaceId === workspaceId
      );
    }
    return (
      typeof value.planningStatus === 'string' &&
      PLANNING_STATUS_STATES.has(value.planningStatus as PlanningStatusState) &&
      this.isObject(value.displayParameters) &&
      MANUAL_DISPLAY_PARAMETER_KEYS.every(key => this.isNonNegativeNumber(
        (value.displayParameters as Record<string, unknown>)[key]
      )) &&
      (value.freshness === null || (
        this.isObject(value.freshness) &&
        value.freshness.workspaceId === workspaceId
      )) &&
      this.isObject(value.nextTarget) &&
      typeof value.nextTarget.tab === 'string' &&
      MANUAL_CODING_TABS.has(value.nextTarget.tab as ManualCodingSnapshotTab) &&
      typeof value.nextTarget.sectionId === 'string' &&
      (value.nextTarget.action === 'navigate' ||
        value.nextTarget.action === 'double-coding-review')
    );
  }

  private isRevisionValid(
    value: unknown,
    workspaceId: number
  ): value is CodingStatusRevisionDto {
    return (
      this.isObject(value) &&
      value.workspaceId === workspaceId &&
      this.isNonNegativeInteger(value.revision) &&
      typeof value.statusRevision === 'string' &&
      /^(0|[1-9]\d*)$/.test(value.statusRevision) &&
      typeof value.stable === 'boolean'
    );
  }

  private buildKey(
    userId: number,
    workspaceId: number,
    surface: CodingStatusSnapshotSurface
  ) {
    return `${CODING_STATUS_SNAPSHOT_KEY_PREFIX}${userId}:${workspaceId}:${surface}`;
  }

  private remove(key: string): void {
    try {
      getCodingStatusSessionStorage()?.removeItem(key);
    } catch {
      // Browser storage is optional.
    }
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private isPositiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
  }

  private isNonNegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
  }

  private readonly isNonNegativeNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
