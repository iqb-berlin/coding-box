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

const WORKSPACE_TOKEN_SCOPES_METADATA_KEY = 'workspaceTokenScopes';

export const AllowWorkspaceTokenScopes = (...scopes: WorkspaceTokenScope[]) => (
  SetMetadata(WORKSPACE_TOKEN_SCOPES_METADATA_KEY, scopes)
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
  const requiredScopes = typeof reflector.getAllAndOverride === 'function' ?
    reflector.getAllAndOverride<WorkspaceTokenScope[]>(
      WORKSPACE_TOKEN_SCOPES_METADATA_KEY,
      metadataTargets
    ) :
    reflector.get<WorkspaceTokenScope[]>(
      WORKSPACE_TOKEN_SCOPES_METADATA_KEY,
      context.getHandler()
    );

  if (!Array.isArray(requiredScopes) || !requiredScopes.length) {
    throw new UnauthorizedException('Workspace API token is not allowed for this endpoint');
  }

  const tokenScopes = Array.isArray(user.scopes) ? user.scopes : [];
  const hasRequiredScope = requiredScopes.every(scope => tokenScopes.includes(scope));
  if (!hasRequiredScope) {
    throw new UnauthorizedException('Workspace API token does not have the required scope');
  }
}
