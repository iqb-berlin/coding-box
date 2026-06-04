export function normalizeReplayUrlToCurrentOrigin(
  replayUrl: string,
  currentOrigin = window.location.origin
): string {
  try {
    const parsedUrl = new URL(replayUrl, currentOrigin);
    if (parsedUrl.hash.startsWith('#/replay')) {
      return `${currentOrigin}/${parsedUrl.hash}`;
    }
  } catch {
    return replayUrl;
  }

  return replayUrl;
}
