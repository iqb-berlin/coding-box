export interface WorkspaceAccessLike {
  accessLevel?: number | null;
  canCode?: boolean | null;
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

export function hasMinimumWorkspaceAccess(user: WorkspaceAccessLike, minLevel: number): boolean {
  const accessLevel = user.accessLevel ?? 0;

  if (minLevel === 1 && accessLevel === 1) {
    return getEffectiveCanCode(user);
  }

  return accessLevel >= minLevel;
}
