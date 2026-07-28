import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  Observable,
  catchError,
  finalize,
  map,
  of,
  shareReplay
} from 'rxjs';
import { CodingStatusRevisionDto } from '../../../../../../api-dto/coding/coding-status-revision.dto';
import { SERVER_URL } from '../../injection-tokens';
import {
  CODING_STATUS_SNAPSHOT_KEY_PREFIX,
  getCodingStatusSessionStorage
} from '../../core/services/coding-status-session-storage';
import {
  CodingOverviewStatusSnapshot,
  CodingStatusSnapshotSurface,
  ManualCodingStatusSnapshot,
  PlanningStatusState
} from './coding-status-snapshot.model';

type CodingStatusSnapshot =
  CodingOverviewStatusSnapshot | ManualCodingStatusSnapshot;
type SnapshotMetadataKeys = 'schemaVersion' | 'checkedAt' | 'surface';

const planningStatusStates: readonly PlanningStatusState[] = [
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
];
const manualSnapshotTabs: readonly string[] = [
  'preparation',
  'planning',
  'training',
  'execution',
  'completion'
];
const manualSnapshotActions: readonly string[] = [
  'navigate',
  'double-coding-review'
];

@Injectable({ providedIn: 'root' })
export class CodingStatusSnapshotService {
  private readonly http = inject(HttpClient);
  private readonly serverUrl = inject(SERVER_URL);
  private readonly revisionRequests = new Map<
  number,
  Observable<CodingStatusRevisionDto>
  >();

  restoreOverview(
    userId: number,
    workspaceId: number
  ): Observable<CodingOverviewStatusSnapshot | null> {
    return this.restore<CodingOverviewStatusSnapshot>(
      userId,
      workspaceId,
      'overview'
    );
  }

  restoreManual(
    userId: number,
    workspaceId: number
  ): Observable<ManualCodingStatusSnapshot | null> {
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
      surface: 'overview'
    });
  }

  saveManual(
    snapshot: Omit<ManualCodingStatusSnapshot, SnapshotMetadataKeys>
  ): void {
    this.save({
      ...snapshot,
      schemaVersion: 1,
      checkedAt: new Date().toISOString(),
      surface: 'manual'
    });
  }

  getRevision(workspaceId: number): Observable<CodingStatusRevisionDto> {
    const pending = this.revisionRequests.get(workspaceId);
    if (pending) {
      return pending;
    }

    const request$ = this.http.get<CodingStatusRevisionDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/revision`
    ).pipe(
      finalize(() => {
        if (this.revisionRequests.get(workspaceId) === request$) {
          this.revisionRequests.delete(workspaceId);
        }
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    this.revisionRequests.set(workspaceId, request$);
    return request$;
  }

  clearWorkspace(workspaceId: number): void {
    const storage = getCodingStatusSessionStorage();
    if (!storage) {
      return;
    }
    try {
      this.storageKeys(storage)
        .filter(key => this.keyBelongsToWorkspace(key, workspaceId))
        .forEach(key => storage.removeItem(key));
    } catch {
      // Status persistence is best effort and must not block the coding UI.
    }
  }

  clearAll(): void {
    const storage = getCodingStatusSessionStorage();
    if (!storage) {
      return;
    }
    try {
      this.storageKeys(storage).forEach(key => storage.removeItem(key));
    } catch {
      // Status persistence is best effort and must not block the coding UI.
    }
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
      map(({ workspaceId: responseWorkspaceId, revision }) => {
        if (responseWorkspaceId !== workspaceId || revision !== snapshot.revision) {
          this.remove(key);
          return null;
        }
        return snapshot;
      }),
      catchError(() => of(null))
    );
  }

  private save(snapshot: CodingStatusSnapshot): void {
    const storage = getCodingStatusSessionStorage();
    if (!storage) {
      return;
    }
    try {
      storage.setItem(
        this.buildKey(snapshot.userId, snapshot.workspaceId, snapshot.surface),
        JSON.stringify(snapshot)
      );
    } catch {
      // Status persistence is best effort and must not block the coding UI.
    }
  }

  private read<T extends CodingStatusSnapshot>(
    key: string,
    userId: number,
    workspaceId: number,
    surface: CodingStatusSnapshotSurface
  ): T | null {
    const storage = getCodingStatusSessionStorage();
    if (!storage) {
      return null;
    }
    try {
      const raw = storage.getItem(key);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as Partial<CodingStatusSnapshot>;
      if (parsed.schemaVersion !== 1 ||
          parsed.userId !== userId ||
          parsed.workspaceId !== workspaceId ||
          parsed.surface !== surface ||
          !Number.isInteger(parsed.userId) ||
          parsed.userId <= 0 ||
          !Number.isInteger(parsed.workspaceId) ||
          parsed.workspaceId <= 0 ||
          typeof parsed.revision !== 'number' ||
          !Number.isInteger(parsed.revision) ||
          parsed.revision < 0 ||
          typeof parsed.checkedAt !== 'string' ||
          !Number.isFinite(Date.parse(parsed.checkedAt)) ||
          !this.isSnapshotPayloadValid(parsed, surface)) {
        storage.removeItem(key);
        return null;
      }
      return parsed as T;
    } catch {
      this.remove(key);
      return null;
    }
  }

  private buildKey(
    userId: number,
    workspaceId: number,
    surface: CodingStatusSnapshotSurface
  ): string {
    return `${CODING_STATUS_SNAPSHOT_KEY_PREFIX}${userId}:${workspaceId}:${surface}`;
  }

  private isSnapshotPayloadValid(
    snapshot: Partial<CodingStatusSnapshot>,
    surface: CodingStatusSnapshotSurface
  ): boolean {
    if (snapshot.fullyChecked !== true) {
      return false;
    }
    if (surface === 'overview') {
      const overview = snapshot as Partial<CodingOverviewStatusSnapshot>;
      return this.isObject(overview.freshness) &&
        overview.freshness.workspaceId === snapshot.workspaceId &&
        overview.freshness.currentRevision === snapshot.revision &&
        Array.isArray(overview.freshness.items) &&
        this.isObject(overview.readiness) &&
        overview.readiness.workspaceId === snapshot.workspaceId &&
        typeof overview.readiness.readiness === 'string' &&
        (overview.appliedResultsOverview === null ||
          this.isObject(overview.appliedResultsOverview));
    }
    const manual = snapshot as Partial<ManualCodingStatusSnapshot>;
    return planningStatusStates.includes(manual.planningStatus as PlanningStatusState) &&
      this.isDisplayParametersValid(manual.displayParameters) &&
      (manual.freshness === null ||
        (this.isObject(manual.freshness) &&
          manual.freshness.workspaceId === snapshot.workspaceId &&
          manual.freshness.currentRevision === snapshot.revision &&
          Array.isArray(manual.freshness.items))) &&
      this.isObject(manual.nextTarget) &&
      manualSnapshotTabs.includes(manual.nextTarget.tab as string) &&
      typeof manual.nextTarget.sectionId === 'string' &&
      manual.nextTarget.sectionId.length > 0 &&
      manualSnapshotActions.includes(manual.nextTarget.action as string);
  }

  private isDisplayParametersValid(value: unknown): boolean {
    if (!this.isObject(value)) {
      return false;
    }
    return [
      'variableConflicts',
      'missingVariables',
      'unassignedCases',
      'activeTrainingJobs',
      'staleSourceJobs',
      'openDoubleCodingConflicts',
      'manualCodeAvailabilityWarnings'
    ].every(key => (
      typeof value[key] === 'number' &&
      Number.isFinite(value[key]) &&
      value[key] >= 0
    ));
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private storageKeys(storage: Storage): string[] {
    return Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key): key is string => (
        !!key && key.startsWith(CODING_STATUS_SNAPSHOT_KEY_PREFIX)
      ));
  }

  private keyBelongsToWorkspace(key: string, workspaceId: number): boolean {
    const segments = key.slice(CODING_STATUS_SNAPSHOT_KEY_PREFIX.length).split(':');
    return Number(segments[1]) === workspaceId;
  }

  private remove(key: string): void {
    try {
      getCodingStatusSessionStorage()?.removeItem(key);
    } catch {
      // Ignore unavailable browser storage.
    }
  }
}
