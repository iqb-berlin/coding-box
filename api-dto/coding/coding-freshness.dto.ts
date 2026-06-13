export type CodingFreshnessVersion = 'v1' | 'v2' | 'v3';

export type CodingFreshnessState =
  | 'CURRENT'
  | 'PENDING'
  | 'STALE'
  | 'MANUAL_REVIEW_REQUIRED';

export type CodingFreshnessReason =
  | 'RESULT_ADDED'
  | 'RESULT_UPDATED'
  | 'RESULT_DELETED'
  | 'AUTOCODE_RUN'
  | 'MANUAL_CODING_APPLIED'
  | 'RESET'
  | 'CODING_SCHEME_CHANGED';

export interface CodingFreshnessSummaryItemDto {
  version: CodingFreshnessVersion;
  state: CodingFreshnessState;
  unitCount: number;
  affectedResponseCount: number;
}

export interface CodingFreshnessSummaryDto {
  workspaceId: number;
  currentRevision: number;
  items: CodingFreshnessSummaryItemDto[];
}

export interface CodingFreshnessGroupDto {
  groupName: string;
  personCount: number;
  unitCount: number;
  affectedResponseCount: number;
  items: CodingFreshnessSummaryItemDto[];
}

export interface CodingFreshnessScopeDto {
  workspaceId: number;
  currentRevision: number;
  versions: CodingFreshnessVersion[];
  states: CodingFreshnessState[];
  unitCount: number;
  personCount: number;
  groupCount: number;
  affectedResponseCount: number;
  unitIds: number[];
  personIds: number[];
  groupNames: string[];
  groups: CodingFreshnessGroupDto[];
}

export interface CodingFreshnessUnitDto {
  unitId: number;
  unitName: string;
  unitAlias: string | null;
  bookletName: string | null;
  personId: number | null;
  personLogin: string | null;
  personCode: string | null;
  personGroup: string | null;
  version: CodingFreshnessVersion;
  state: CodingFreshnessState;
  reason: CodingFreshnessReason;
  affectedResponseCount: number;
  sourceRevision: number;
  codedRevision: number | null;
  updatedAt: string;
}

export interface CodingFreshnessImpactDto {
  autoCodingV1: number;
  manualCodingV2: number;
  autoCodingV3: number;
  affectedUnits: number;
}

export interface StartCodingFreshnessJobDto {
  version: Extract<CodingFreshnessVersion, 'v1' | 'v3'>;
  states?: Extract<CodingFreshnessState, 'PENDING' | 'STALE'>[];
}

export interface CodingFreshnessJobResultDto {
  totalResponses: number;
  statusCounts: Record<string, number>;
  jobId?: string;
  message?: string;
  unitCount: number;
  personCount: number;
  groupNames: string[];
}
