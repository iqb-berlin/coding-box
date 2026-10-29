import {
  TestResultsDeletePreviewDto,
  TestResultsTimestampSource
} from '../../../../../../../api-dto/test-results/test-results-deletion.dto';

export interface PersonWhere {
  code: string;
  login: string;
  workspace_id: number;
  consider: boolean;
  group?: string;
}

export type ResponseSearchSortBy =
  'unitname' |
  'variableid' |
  'value' |
  'codedstatus' |
  'code' |
  'score' |
  'person_code' |
  'person_login' |
  'person_group' |
  'booklet_id';

export type ResponseSearchSortDirection = 'asc' | 'desc';

export const EFFECTIVE_CODING_STATUS_SORT_ALIAS = 'effective_coding_status_sort';

export const EFFECTIVE_CODING_STATUS_OUTPUT_ALIAS = 'effective_coding_status_output';

export type WorkspaceOverviewStats = {
  testPersons: number;
  testGroups: number;
  uniqueBooklets: number;
  uniqueUnits: number;
  uniqueResponses: number;
  responseStatusCounts: Record<string, number>;
  sessionBrowserCounts: Record<string, number>;
  sessionOsCounts: Record<string, number>;
  sessionScreenCounts: Record<string, number>;
};

export type QuickSearchResultKind = 'person' | 'booklet' | 'unit' | 'response';

export type QuickSearchResultItem = {
  kind: QuickSearchResultKind;
  id: number;
  label: string;
  secondaryLabel?: string;
  personId?: number;
  personLogin?: string;
  personCode?: string;
  personGroup?: string;
  bookletId?: number;
  bookletName?: string;
  unitId?: number;
  unitName?: string;
  unitAlias?: string | null;
  responseId?: number;
  variableId?: string;
  responseValue?: string;
  responseStatus?: string;
};

export type QuickSearchResult = {
  query: string;
  limit: number;
  persons: QuickSearchResultItem[];
  booklets: QuickSearchResultItem[];
  units: QuickSearchResultItem[];
  responses: QuickSearchResultItem[];
  totals: Record<QuickSearchResultKind, number>;
};

export type FlatFrequenciesResult = Record<
  string,
  {
    total: number;
    values: Array<{ value: string; count: number; p: number }>;
  }
>;

export type LogAnomalySeverity = 'critical' | 'warning' | 'info';

export type LogAnomalyCode =
  | 'controller_error'
  | 'missing_termination'
  | 'connection_lost'
  | 'timestamp_zero'
  | 'player_stuck_loading'
  | 'repeated_start'
  | 'long_loading'
  | 'timer_left_on_exit'
  | 'timer_never_finished'
  | 'focus_lost_long'
  | 'unit_progress_incomplete'
  | 'progress_incomplete'
  | 'debug_command'
  | 'session_span_long'
  | 'orphan_logs';

export interface LogAnomalySummary {
  code: LogAnomalyCode;
  severity: LogAnomalySeverity;
  label: string;
  evidence: string;
  count: number;
}

export interface LogAnomalyThresholds {
  longLoadingThresholdMs: number;
  focusLostThresholdMs: number;
  sessionSpanThresholdMs: number;
  repeatedStartThreshold: number;
}

export interface LogAnomalySqlFragment {
  sql: string;
  params: Record<string, string | string[]>;
}

export interface TextSearchFilter {
  value: string;
  exact: boolean;
}

export interface LogAnomalyDashboardSummary {
  totalBooklets: number;
  affectedBooklets: number;
  criticalBooklets: number;
  warningBooklets: number;
  infoBooklets: number;
  totalAnomalyRules: number;
  totalAnomalyEvents: number;
  byCode: Record<string, number>;
}

export interface LogAnomalyDetailRow {
  bookletId: number;
  booklet: string;
  personId: number;
  code: string;
  group: string;
  login: string;
  maxSeverity: LogAnomalySeverity;
  anomalies: LogAnomalySummary[];
}

export interface LogAnomalyDetailsResponse {
  total: number;
  data: LogAnomalyDetailRow[];
}

export interface TestResultsExportFilters {
  groupNames?: string[];
  bookletNames?: string[];
  unitNames?: string[];
  personIds?: number[];
  includeLogAnomalies?: boolean;
}

export type TestResultsDeleteTargetKind = 'persons' | 'booklets' | 'units';

export interface TestResultsDeleteTargets {
  kind: TestResultsDeleteTargetKind;
  ids: number[];
  preview: TestResultsDeletePreviewDto;
}

export interface ResponseCleanupTargetRow {
  responseId: number;
  unitId: number;
  personId: number;
  personCode: string;
  personLogin: string;
  personGroup: string;
  bookletId: number;
  bookletName: string;
  unitName: string;
  variableId: string;
  subform: string | null;
  value: string | null;
  answeredAt: number | null;
  timestampSource: TestResultsTimestampSource;
}

export interface ResponseCleanupTargets {
  responseIds: number[];
  unitIds: number[];
  preview: TestResultsDeletePreviewDto;
}

export interface NormalizedResponseCleanupRequest {
  unitNames: string[];
  answeredBefore: number | null;
  answeredFrom: number | null;
  variableIds: string[];
  subforms: string[];
}

export interface DeleteDependencySnapshot {
  bookletIds: number[];
  unitIds: number[];
  responseIds: number[];
  bookletInfoIds: number[];
}

export interface LogDeleteSnapshot {
  bookletIds: number[];
  unitIds: number[];
}

export interface LogDeleteCounts {
  bookletLogs: number;
  unitLogs: number;
  sessions: number;
}

export type LogAnomalySessionRow = {
  id: number;
  bookletid: number;
  browser: string | null;
  os: string | null;
  screen: string | null;
  ts: number | null;
  loadcompletems: number | null;
};
