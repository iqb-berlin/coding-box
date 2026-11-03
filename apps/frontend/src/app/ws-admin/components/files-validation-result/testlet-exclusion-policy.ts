export function applyTestletExclusion(
  current: { bookletId: string; testletId: string }[],
  bookletIds: string[],
  testletId: string,
  shouldIgnore: boolean
): { nextIgnoredTestlets: { bookletId: string; testletId: string }[]; changedCount: number } {
  const normalizedTestletId = testletId.toUpperCase();
  const existingMap = new Map<string, { bookletId: string; testletId: string }>();
  current.forEach(entry => {
    existingMap.set(`${entry.bookletId}|${entry.testletId}`, entry);
  });

  let changedCount = 0;
  bookletIds.forEach(bookletId => {
    const normalizedBookletId = bookletId.toUpperCase();
    const key = `${normalizedBookletId}|${normalizedTestletId}`;
    const wasIgnored = existingMap.has(key);

    if (shouldIgnore) {
      existingMap.set(key, {
        bookletId: normalizedBookletId,
        testletId: normalizedTestletId
      });
    } else {
      existingMap.delete(key);
    }

    const isIgnoredNow = existingMap.has(key);
    if (wasIgnored !== isIgnoredNow) {
      changedCount += 1;
    }
  });

  return {
    nextIgnoredTestlets: Array.from(existingMap.values()),
    changedCount
  };
}
