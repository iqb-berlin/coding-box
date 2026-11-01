import { EntityManager } from 'typeorm';
import { CodingFreshnessReason, CodingFreshnessState, CodingFreshnessVersion } from '../../../../../../../api-dto/coding/coding-freshness.dto';

export type UnitCodingPresence = Record<CodingFreshnessVersion, boolean>;

export type FreshnessSummaryRow = {
  version: CodingFreshnessVersion;
  state: CodingFreshnessState;
  unitCount: string;
  affectedResponseCount: string;
};

export type FreshnessScopeRow = {
  unitId: string;
  personId: string;
  groupName: string | null;
  version: CodingFreshnessVersion;
  state: CodingFreshnessState;
  affectedResponseCount: string;
};

export type ImportedResponseScopeRow = {
  responseId: string;
  unitId: string;
};

export type DeleteImpactRow = {
  affectedUnits: string;
  autoCodingV1: string;
  manualCodingV2: string;
  autoCodingV3: string;
};

export type ManualJobFreshnessRow = {
  jobCount?: string | number;
  affectedUnits?: string | number;
  affectedResponses?: string | number;
};

export type FreshnessUpsert = {
  workspace_id: number;
  unit_id: number;
  version: CodingFreshnessVersion;
  state: CodingFreshnessState;
  reason: CodingFreshnessReason;
  affected_response_count: number;
  source_revision: number;
  coded_revision: number | null;
};

export type ResetFreshnessUnitMap = Partial<Record<CodingFreshnessVersion, number[]>>;

export type ResetFreshnessScopeOptions = {
  unitIds?: number[];
  manager?: EntityManager;
};

export type MarkManualCodingCurrentOptions = {
  codingJobId?: number;
  clearCoveredReviewJobs?: boolean;
  manager?: EntityManager;
};

export type ReconcileAppliedManualCodingJobsOptions = {
  unitNames?: string[];
  variableIds?: string[];
  manager?: EntityManager;
};
