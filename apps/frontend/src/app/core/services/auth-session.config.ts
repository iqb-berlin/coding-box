export const AUTH_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const AUTH_SESSION_WARNING_BEFORE_TIMEOUT_MS = 5 * 60 * 1000;
export const AUTH_SESSION_WARNING_DELAY_MS =
  AUTH_SESSION_IDLE_TIMEOUT_MS - AUTH_SESSION_WARNING_BEFORE_TIMEOUT_MS;
export const API_SPECIAL_TOKEN_DURATION_DAYS = 1;

export type WorkspaceTokenScope =
  | 'replay:read'
  | 'replay-statistics:write'
  | 'coding-job:operate';

export const WORKSPACE_TOKEN_SCOPE_REPLAY_READ: WorkspaceTokenScope = 'replay:read';
export const WORKSPACE_TOKEN_SCOPE_REPLAY_STATISTICS_WRITE: WorkspaceTokenScope = 'replay-statistics:write';
export const WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE: WorkspaceTokenScope = 'coding-job:operate';

export const REPLAY_WORKSPACE_TOKEN_SCOPES: WorkspaceTokenScope[] = [
  WORKSPACE_TOKEN_SCOPE_REPLAY_READ,
  WORKSPACE_TOKEN_SCOPE_REPLAY_STATISTICS_WRITE
];

export const CODING_JOB_WORKSPACE_TOKEN_SCOPES: WorkspaceTokenScope[] = [
  WORKSPACE_TOKEN_SCOPE_REPLAY_READ,
  WORKSPACE_TOKEN_SCOPE_REPLAY_STATISTICS_WRITE,
  WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE
];
