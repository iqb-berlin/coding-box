export function parseWorkspaceId(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const rawWorkspaceId = String(value);
  if (!/^[1-9]\d*$/.test(rawWorkspaceId)) {
    return null;
  }

  const workspaceId = Number(rawWorkspaceId);
  return Number.isSafeInteger(workspaceId) ? workspaceId : null;
}
