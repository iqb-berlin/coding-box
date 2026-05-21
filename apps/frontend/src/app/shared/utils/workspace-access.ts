export interface WorkspaceAccessLike {
  accessLevel?: number | null;
  canCode?: boolean | null;
}

export interface WorkspaceUserAccessLike extends WorkspaceAccessLike {
  id?: number | null;
  userId?: number | null;
}

export function getEffectiveCanCode(user: WorkspaceAccessLike): boolean {
  return user.canCode ?? ((user.accessLevel ?? 0) === 1);
}

export function hasActiveCodingAccess(user: WorkspaceAccessLike): boolean {
  return (user.accessLevel ?? 0) > 0 && getEffectiveCanCode(user);
}

export function hasManagementWorkspaceAccess(user: WorkspaceAccessLike): boolean {
  return (user.accessLevel ?? 0) >= 2;
}

export function hasOnlyPersonalCodingAccess(users: WorkspaceAccessLike[]): boolean {
  return users.some(hasActiveCodingAccess) && !users.some(hasManagementWorkspaceAccess);
}

export function getCurrentUserWorkspaceAccesses(
  workspaceAccesses: WorkspaceUserAccessLike[][],
  userId: number
): WorkspaceUserAccessLike[] {
  return workspaceAccesses.flatMap(users => users.filter(user => (user.id ?? user.userId) === userId));
}

export function hasMinimumWorkspaceAccess(user: WorkspaceAccessLike, minLevel: number): boolean {
  return (user.accessLevel ?? 0) >= minLevel;
}
