export const CODING_STATUS_SNAPSHOT_KEY_PREFIX = 'coding-status-snapshot:v1:';

export function getCodingStatusSessionStorage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function clearCodingStatusSnapshots(workspaceId?: number): void {
  const storage = getCodingStatusSessionStorage();
  if (!storage) {
    return;
  }

  try {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)
    ).filter(
      (key): key is string => !!key && key.startsWith(CODING_STATUS_SNAPSHOT_KEY_PREFIX)
    );
    keys
      .filter(
        key => workspaceId === undefined ||
          Number(
            key.slice(CODING_STATUS_SNAPSHOT_KEY_PREFIX.length).split(':')[1]
          ) === workspaceId
      )
      .forEach(key => storage.removeItem(key));
  } catch {
    // Browser storage is optional; coding must keep working without it.
  }
}
