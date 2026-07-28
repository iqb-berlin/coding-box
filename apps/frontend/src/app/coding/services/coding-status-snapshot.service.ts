import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  Observable, catchError, finalize, map, of, shareReplay
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

interface RevisionRequestOptions {
  fresh?: boolean;
}

const freshnessVersions = ['v1', 'v2', 'v3'] as const;
const freshnessStates = [
  'CURRENT',
  'PENDING',
  'STALE',
  'MANUAL_REVIEW_REQUIRED'
] as const;
const readinessStates = ['READY', 'BLOCKED', 'NO_RESULTS'] as const;
const readinessBlockers = [
  'NO_RELEVANT_RESPONSES',
  'MISSING_UNIT_FILES',
  'MISSING_CODING_SCHEMES',
  'INVALID_CODING_SCHEMES',
  'NO_VALID_VARIABLE_MATCHES',
  'NO_CODEABLE_RESPONSES'
] as const;

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

  getRevision(
    workspaceId: number,
    options: RevisionRequestOptions = {}
  ): Observable<CodingStatusRevisionDto> {
    if (options.fresh) {
      return this.requestRevision(workspaceId);
    }
    const pending = this.revisionRequests.get(workspaceId);
    if (pending) {
      return pending;
    }

    const request$ = this.requestRevision(workspaceId).pipe(
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

  private requestRevision(
    workspaceId: number
  ): Observable<CodingStatusRevisionDto> {
    return this.http.get<CodingStatusRevisionDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/revision`
    );
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
      if (
        parsed.schemaVersion !== 1 ||
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
        typeof parsed.statusRevision !== 'string' ||
        !/^(0|[1-9]\d*)$/.test(parsed.statusRevision) ||
          typeof parsed.checkedAt !== 'string' ||
          !Number.isFinite(Date.parse(parsed.checkedAt)) ||
        !this.isSnapshotPayloadValid(parsed, surface)
      ) {
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
      return (
        this.isFreshnessSummaryValid(
          overview.freshness,
          snapshot.workspaceId,
          snapshot.revision
        ) &&
        this.isReadinessValid(overview.readiness, snapshot.workspaceId) &&
        (overview.appliedResultsOverview === null ||
          this.isAppliedResultsOverviewValid(overview.appliedResultsOverview))
      );
    }
    const manual = snapshot as Partial<ManualCodingStatusSnapshot>;
    return (
      planningStatusStates.includes(
        manual.planningStatus as PlanningStatusState
      ) &&
      this.isDisplayParametersValid(manual.displayParameters) &&
      (manual.freshness === null ||
        this.isFreshnessSummaryValid(
          manual.freshness,
          snapshot.workspaceId,
          snapshot.revision
        )) &&
      this.isObject(manual.nextTarget) &&
      manualSnapshotTabs.includes(manual.nextTarget.tab as string) &&
      typeof manual.nextTarget.sectionId === 'string' &&
      manual.nextTarget.sectionId.length > 0 &&
      manualSnapshotActions.includes(manual.nextTarget.action as string)
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

  private isFreshnessSummaryValid(
    value: unknown,
    workspaceId: unknown,
    revision: unknown
  ): boolean {
    if (
      !this.isObject(value) ||
      value.workspaceId !== workspaceId ||
      value.currentRevision !== revision ||
      !Array.isArray(value.items)
    ) {
      return false;
    }
    return value.items.every(
      item => this.isObject(item) &&
        freshnessVersions.includes(
          item.version as (typeof freshnessVersions)[number]
        ) &&
        freshnessStates.includes(
          item.state as (typeof freshnessStates)[number]
        ) &&
        this.isNonNegativeInteger(item.unitCount) &&
        this.isNonNegativeInteger(item.affectedResponseCount)
    );
  }

  private isReadinessValid(value: unknown, workspaceId: unknown): boolean {
    if (
      !this.isObject(value) ||
      value.workspaceId !== workspaceId ||
      (value.autoCoderRun !== 1 && value.autoCoderRun !== 2) ||
      !readinessStates.includes(
        value.readiness as (typeof readinessStates)[number]
      ) ||
      !this.isStringArray(value.blockers, readinessBlockers) ||
      !this.isStringArray(value.missingUnitFiles) ||
      !this.isStringArray(value.missingCodingSchemes) ||
      !this.isStringArray(value.invalidCodingSchemes) ||
      !Array.isArray(value.invalidVariableSamples)
    ) {
      return false;
    }
    const counts = [
      'rawResponsesTotal',
      'rawResponsesWithRelevantStatus',
      'resultUnitsTotal',
      'resultUnitKeysTotal',
      'matchedUnitFiles',
      'matchedCodingSchemes',
      'validVariablePairs',
      'validResponses',
      'codeableResponses'
    ];
    if (!counts.every(key => this.isNonNegativeInteger(value[key]))) {
      return false;
    }
    if (
      !value.invalidVariableSamples.every(
        sample => this.isObject(sample) &&
          typeof sample.unitName === 'string' &&
          this.isNonNegativeInteger(sample.responseCount) &&
          this.isStringArray(sample.sampleVariableIds) &&
          this.isStringArray(sample.knownVariableIds)
      )
    ) {
      return false;
    }
    return (
      (value.computedAt === undefined ||
        (typeof value.computedAt === 'string' &&
          Number.isFinite(Date.parse(value.computedAt)))) &&
      (value.computationMs === undefined ||
        this.isNonNegativeNumber(value.computationMs)) &&
      (value.fromCache === undefined || typeof value.fromCache === 'boolean') &&
      (value.sourceRevision === undefined ||
        this.isNonNegativeInteger(value.sourceRevision)) &&
      (value.fileRevision === undefined ||
        typeof value.fileRevision === 'string')
    );
  }

  private isAppliedResultsOverviewValid(value: unknown): boolean {
    if (!this.isObject(value)) {
      return false;
    }
    const requiredCounts = [
      'totalIncompleteResponses',
      'appliedResponses',
      'remainingResponses',
      'completionPercentage',
      'rawTotalIncompleteResponses',
      'rawAppliedResponses',
      'rawCompletionPercentage',
      'aggregatedDuplicateCases'
    ];
    const optionalCounts = [
      'statusTotalIncompleteResponses',
      'responseAnalysisRawCases',
      'coveredSourceVariableCount',
      'coveredSourceResponseCount',
      'deriveErrorTotalResponses',
      'deriveErrorAppliedResponses',
      'deriveErrorRemainingResponses',
      'deriveErrorRawTotalResponses',
      'deriveErrorRawAppliedResponses'
    ];
    return (
      requiredCounts.every(key => this.isNonNegativeNumber(value[key])) &&
      optionalCounts.every(
        key => value[key] === undefined || this.isNonNegativeNumber(value[key])
      ) &&
      typeof value.aggregationActive === 'boolean' &&
      (value.aggregationThreshold === null ||
        this.isNonNegativeNumber(value.aggregationThreshold))
    );
  }

  private isStringArray(
    value: unknown,
    allowed?: readonly string[]
  ): value is string[] {
    return (
      Array.isArray(value) &&
      value.every(
        item => typeof item === 'string' && (!allowed || allowed.includes(item))
      )
    );
  }

  private isNonNegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
  }

  private isNonNegativeNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
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
    ].every(
      key => typeof value[key] === 'number' &&
      Number.isFinite(value[key]) &&
      value[key] >= 0
    );
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private storageKeys(storage: Storage): string[] {
    return Array.from({ length: storage.length }, (_, index) => storage.key(index)
    ).filter(
      (key): key is string => !!key && key.startsWith(CODING_STATUS_SNAPSHOT_KEY_PREFIX)
    );
  }

  private keyBelongsToWorkspace(key: string, workspaceId: number): boolean {
    const segments = key
      .slice(CODING_STATUS_SNAPSHOT_KEY_PREFIX.length)
      .split(':');
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
