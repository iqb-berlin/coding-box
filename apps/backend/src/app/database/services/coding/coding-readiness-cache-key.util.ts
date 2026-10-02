export const CODING_READINESS_CACHE_PREFIX = 'coding_readiness:v2';

export function getCodingReadinessCacheKey(
  workspaceId: number,
  autoCoderRun: 1 | 2,
  signatureHash: string
): string {
  return `${CODING_READINESS_CACHE_PREFIX}:${workspaceId}:${autoCoderRun}:${signatureHash}`;
}

export function getCodingReadinessCachePattern(workspaceId: number): string {
  return `${CODING_READINESS_CACHE_PREFIX}:${workspaceId}:*`;
}

export function getCodingReadinessCacheVersionKey(workspaceId: number): string {
  return `${CODING_READINESS_CACHE_PREFIX}:version:${workspaceId}`;
}
