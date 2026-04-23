export function buildBrowserReplayUrl(
  baseUrl: string,
  replayUrl: string,
  authToken: string,
  includeHealthCheckMarker: boolean = true
): string {
  const normalizedBaseUrl = new URL(baseUrl);
  const parsedReplayUrl = new URL(replayUrl);
  const rawHash = parsedReplayUrl.hash.startsWith('#') ?
    parsedReplayUrl.hash.substring(1) :
    parsedReplayUrl.hash;
  const [hashPath, hashQuery = ''] = rawHash.split('?');
  const hashParams = new URLSearchParams(hashQuery);

  hashParams.set('auth', authToken);

  if (includeHealthCheckMarker) {
    hashParams.set('healthCheck', '1');
  }

  normalizedBaseUrl.hash = `${hashPath}?${hashParams.toString()}`;
  return normalizedBaseUrl.toString();
}

export function sanitizeArtifactName(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'replay';
}

export function compressDiagnostics(diagnostics: string[], maxItems: number = 3): string[] {
  return diagnostics
    .map(item => item.trim())
    .filter(item => item.length > 0)
    .slice(0, maxItems);
}
