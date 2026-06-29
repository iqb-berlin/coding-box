import {
  ExecutionContext,
  SetMetadata,
  UnauthorizedException
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const WORKSPACE_API_TOKEN_TYPE = 'workspace-api';
export const WORKSPACE_TOKEN_SCOPE_REPLAY_READ = 'replay:read';
export const WORKSPACE_TOKEN_SCOPE_REPLAY_STATISTICS_WRITE = 'replay-statistics:write';
export const WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE = 'coding-job:operate';
export const WORKSPACE_TOKEN_SCOPES = [
  WORKSPACE_TOKEN_SCOPE_REPLAY_READ,
  WORKSPACE_TOKEN_SCOPE_REPLAY_STATISTICS_WRITE,
  WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE
] as const;
export type WorkspaceTokenScope = typeof WORKSPACE_TOKEN_SCOPES[number];

export const WORKSPACE_TOKEN_REPLAY_READ_MAX_DURATION_DAYS_ENV = 'WORKSPACE_TOKEN_REPLAY_READ_MAX_DURATION_DAYS';
export const ALLOW_LEGACY_WORKSPACE_REPLAY_TOKENS_ENV = 'ALLOW_LEGACY_WORKSPACE_REPLAY_TOKENS';
export const DEFAULT_REPLAY_READ_WORKSPACE_TOKEN_MAX_DURATION_DAYS = 90;
export const PRIVILEGED_WORKSPACE_TOKEN_MAX_DURATION_DAYS = 1;

export type WorkspaceTokenPolicy = {
  scopes: Record<WorkspaceTokenScope, {
    maxDurationDays: number;
  }>;
};

export function createWorkspaceTokenPolicy(replayReadMaxDurationDays: number): WorkspaceTokenPolicy {
  return {
    scopes: {
      [WORKSPACE_TOKEN_SCOPE_REPLAY_READ]: {
        maxDurationDays: replayReadMaxDurationDays
      },
      [WORKSPACE_TOKEN_SCOPE_REPLAY_STATISTICS_WRITE]: {
        maxDurationDays: PRIVILEGED_WORKSPACE_TOKEN_MAX_DURATION_DAYS
      },
      [WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE]: {
        maxDurationDays: PRIVILEGED_WORKSPACE_TOKEN_MAX_DURATION_DAYS
      }
    }
  };
}

export function getWorkspaceTokenMaxDurationDays(
  scopes: WorkspaceTokenScope[],
  policy: WorkspaceTokenPolicy
): number {
  const scopeMaxDurations = Array.from(new Set(scopes))
    .map(scope => policy.scopes[scope]?.maxDurationDays)
    .filter((duration): duration is number => Number.isInteger(duration) && duration >= 1);

  return scopeMaxDurations.length ?
    Math.min(...scopeMaxDurations) :
    PRIVILEGED_WORKSPACE_TOKEN_MAX_DURATION_DAYS;
}

const WORKSPACE_TOKEN_SCOPES_METADATA_KEY = 'workspaceTokenScopes';
const WORKSPACE_TOKEN_SCOPE_REQUIREMENTS_METADATA_KEY = 'workspaceTokenScopeRequirements';

export const AllowWorkspaceTokenScopes = (...scopes: WorkspaceTokenScope[]) => (
  SetMetadata(WORKSPACE_TOKEN_SCOPES_METADATA_KEY, scopes)
);

export const AllowAnyWorkspaceTokenScopes = (...scopes: WorkspaceTokenScope[]) => (
  SetMetadata(
    WORKSPACE_TOKEN_SCOPE_REQUIREMENTS_METADATA_KEY,
    scopes.map(scope => [scope])
  )
);

export type WorkspaceApiTokenUser = {
  tokenType?: string;
  scopes?: unknown;
};

export function isWorkspaceApiTokenUser(user: unknown): user is WorkspaceApiTokenUser {
  return !!user &&
    typeof user === 'object' &&
    (user as WorkspaceApiTokenUser).tokenType === WORKSPACE_API_TOKEN_TYPE;
}

export function assertWorkspaceApiTokenScopes(
  context: ExecutionContext,
  reflector: Reflector,
  user: unknown
): void {
  if (!isWorkspaceApiTokenUser(user)) {
    return;
  }

  const metadataTargets = typeof context.getClass === 'function' ?
    [context.getHandler(), context.getClass()] :
    [context.getHandler()];
  const scopeRequirements = typeof reflector.getAllAndOverride === 'function' ?
    reflector.getAllAndOverride<WorkspaceTokenScope[][]>(
      WORKSPACE_TOKEN_SCOPE_REQUIREMENTS_METADATA_KEY,
      metadataTargets
    ) :
    reflector.get<WorkspaceTokenScope[][]>(
      WORKSPACE_TOKEN_SCOPE_REQUIREMENTS_METADATA_KEY,
      context.getHandler()
    );
  const legacyRequiredScopes = typeof reflector.getAllAndOverride === 'function' ?
    reflector.getAllAndOverride<WorkspaceTokenScope[]>(
      WORKSPACE_TOKEN_SCOPES_METADATA_KEY,
      metadataTargets
    ) :
    reflector.get<WorkspaceTokenScope[]>(
      WORKSPACE_TOKEN_SCOPES_METADATA_KEY,
      context.getHandler()
    );
  let requiredScopeAlternatives: WorkspaceTokenScope[][] = [];
  if (Array.isArray(scopeRequirements) && scopeRequirements.length) {
    requiredScopeAlternatives = scopeRequirements;
  } else if (Array.isArray(legacyRequiredScopes) && legacyRequiredScopes.length) {
    requiredScopeAlternatives = [legacyRequiredScopes];
  }

  if (!requiredScopeAlternatives.length) {
    throw new UnauthorizedException('Workspace API token is not allowed for this endpoint');
  }

  const tokenScopes = Array.isArray(user.scopes) ? user.scopes : [];
  const hasRequiredScope = requiredScopeAlternatives.some(requiredScopes => (
    Array.isArray(requiredScopes) &&
    requiredScopes.length > 0 &&
    requiredScopes.every(scope => tokenScopes.includes(scope))
  ));
  if (!hasRequiredScope) {
    throw new UnauthorizedException('Workspace API token does not have the required scope');
  }
}
