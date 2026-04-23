export interface ReplayHealthBrowserOptions {
  enabled: boolean;
  baseUrl: string;
  authIdentity?: string;
  authToken?: string;
  authTokenDays: number;
  concurrency: number;
  timeoutMs: number;
  headless: boolean;
  screenshotDir?: string;
}

export interface ReplayHealthCheckOptions {
  workspaceId: number;
  limit?: number;
  responseIds?: number[];
  browser?: ReplayHealthBrowserOptions;
}

export interface ReplaySeedRow {
  responseId: number;
  unitName: string;
  unitAlias: string | null;
  variableId: string;
  bookletName: string;
  personLogin: string;
  personCode: string;
  personGroup: string;
}

export interface ReplayUrlParts {
  testPerson: string;
  unitId: string;
  page: string;
  anchor: string;
}

export interface ReplayUrlCandidate extends ReplaySeedRow {
  replayUrl: string;
}

export interface ReplayBrowserCandidate {
  workspaceId: number;
  responseId: number;
  testPerson: string;
  unitId: string;
  page: string;
  anchor: string;
  replayUrl: string;
}

export interface ReplayPayloadCandidate {
  workspaceId: number;
  key: string;
  testPerson: string;
  unitId: string;
  replayUrl: string;
  pages: string[];
  anchors: string[];
  responseIds: number[];
  occurrenceCount: number;
}

export type ReplayHealthResultPhase = 'payload' | 'browser';

export type ReplayHealthResultStage =
  | 'parseReplayUrl'
  | 'findUnitDef'
  | 'findUnit'
  | 'findUnitResponse'
  | 'extractPlayerId'
  | 'findPlayer'
  | 'createAuthToken'
  | 'browserNavigate'
  | 'browserRedirect'
  | 'browserSnackbar'
  | 'browserRender';

export interface ReplayHealthCheckResult {
  ok: boolean;
  phase: ReplayHealthResultPhase;
  stage: ReplayHealthResultStage;
  workspaceId: number;
  testPerson: string;
  unitId: string;
  replayUrl: string;
  responseIds: number[];
  occurrenceCount: number;
  page?: string;
  anchors: string[];
  message?: string;
  timingsMs?: Record<string, number>;
  browserUrl?: string;
  redirectUrl?: string;
  screenshotPath?: string;
  diagnostics?: string[];
}

export interface ReplayHealthCheckReport {
  workspaceId: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  responseCandidateCount: number;
  payloadCandidateCount: number;
  payloadSuccessCount: number;
  payloadFailureCount: number;
  browserCandidateCount: number;
  browserSuccessCount: number;
  browserFailureCount: number;
  browserBaseUrl?: string;
  browserAuthIdentity?: string;
  successCount: number;
  failureCount: number;
  failuresByStage: Record<string, number>;
  failuresByMessage: Array<{ message: string; count: number }>;
  results: ReplayHealthCheckResult[];
}
