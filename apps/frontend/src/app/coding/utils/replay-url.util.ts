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

export function appendReplayUrlParams(
  replayUrl: string,
  params: Record<string, string | number | boolean | undefined | null>
): string {
  const applyParams = (urlPart: string): string => {
    const [path, query = ''] = urlPart.split('?', 2);
    const queryParams = new URLSearchParams(query);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        queryParams.set(key, String(value));
      }
    });
    const serialized = queryParams.toString();
    return serialized ? `${path}?${serialized}` : path;
  };

  const [baseUrl, fragment = ''] = replayUrl.split('#', 2);
  if (fragment) {
    return `${baseUrl}#${applyParams(fragment)}`;
  }

  return applyParams(baseUrl);
}
