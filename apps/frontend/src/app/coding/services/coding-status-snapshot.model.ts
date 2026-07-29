import { AutocodingReadinessDto } from '../../../../../../api-dto/coding/autocoding-readiness.dto';
import { CodingFreshnessSummaryDto } from '../../../../../../api-dto/coding/coding-freshness.dto';
import type { AppliedResultsOverview } from './test-person-coding.service';

export type CodingStatusSnapshotSurface = 'overview' | 'manual';

export interface CodingStatusSnapshotMetadata {
  schemaVersion: 1;
  userId: number;
  workspaceId: number;
  revision: number;
  statusRevision: string;
  checkedAt: string;
  surface: CodingStatusSnapshotSurface;
  fullyChecked: true;
}

export interface CodingOverviewStatusSnapshot extends CodingStatusSnapshotMetadata {
  surface: 'overview';
  freshness: CodingFreshnessSummaryDto;
  readiness: AutocodingReadinessDto;
  appliedResultsOverview: AppliedResultsOverview | null;
}

export type PlanningStatusState =
  | 'not-checked'
  | 'loading'
  | 'planning-data-required'
  | 'preparation-required'
  | 'warning'
  | 'planning-incomplete'
  | 'planning-ready'
  | 'training-ready'
  | 'execution-ready'
  | 'double-coding-review-ready'
  | 'stale-source-review'
  | 'completion-ready'
  | 'progress-unavailable'
  | 'complete';

export type ManualCodingSnapshotTab =
  'preparation' | 'planning' | 'training' | 'execution' | 'completion';

export interface ManualCodingSnapshotTarget {
  tab: ManualCodingSnapshotTab;
  sectionId: string;
  action: 'navigate' | 'double-coding-review';
}

export interface ManualCodingSnapshotDisplayParameters {
  variableConflicts: number;
  missingVariables: number;
  unassignedCases: number;
  activeTrainingJobs: number;
  staleSourceJobs: number;
  openDoubleCodingConflicts: number;
  manualCodeAvailabilityWarnings: number;
}

export interface ManualCodingStatusSnapshot extends CodingStatusSnapshotMetadata {
  surface: 'manual';
  planningStatus: PlanningStatusState;
  displayParameters: ManualCodingSnapshotDisplayParameters;
  freshness: CodingFreshnessSummaryDto | null;
  nextTarget: ManualCodingSnapshotTarget;
}
