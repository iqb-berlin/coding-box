export const CODING_STATUS_SNAPSHOT_KEY_PREFIX = 'coding-status-snapshot:v1:';

export function getCodingStatusSessionStorage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function clearAllCodingStatusSnapshots(): void {
  const storage = getCodingStatusSessionStorage();
  if (!storage) {
    return;
  }

  try {
    const keys = Array.from({ length: storage.length }, (_, index) => (
      storage.key(index)
    )).filter((key): key is string => (
      !!key && key.startsWith(CODING_STATUS_SNAPSHOT_KEY_PREFIX)
    ));
    keys.forEach(key => storage.removeItem(key));
  } catch {
    // Session storage can be disabled by the browser. Status restoration is optional.
  }
}
