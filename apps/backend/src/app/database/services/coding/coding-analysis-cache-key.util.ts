export const CODING_ANALYSIS_CACHE_KEY_PREFIX = 'response-analysis';

export function getCodingAnalysisCacheKey(
  workspaceId: number,
  matchingFlags: readonly string[],
  threshold: number
): string {
  return `${CODING_ANALYSIS_CACHE_KEY_PREFIX}:${workspaceId}_${[...matchingFlags].sort().join(',')}_t${threshold}`;
}

export function getCodingAnalysisRunMarkerKey(cacheKey: string): string {
  return `${cacheKey}:run`;
}
