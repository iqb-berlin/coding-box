import type { CodingVersion } from '../../utils/effective-coding-status-expression.util';

export type CodingStatisticsVersion = CodingVersion;

export const CODING_STATISTICS_CACHE_KEY_PREFIX = 'coding-statistics:schema-v5';
export const LEGACY_CODING_STATISTICS_CACHE_KEY_PREFIXES = [
  'coding-statistics:schema-v4'
] as const;

export const CODING_STATISTICS_CACHE_VERSIONS: CodingStatisticsVersion[] = [
  'v1',
  'v2',
  'v3'
];

export function getCodingStatisticsCacheKey(
  workspaceId: number,
  version: CodingStatisticsVersion
): string {
  return `${CODING_STATISTICS_CACHE_KEY_PREFIX}:${workspaceId}:${version}`;
}

export function getLegacyCodingStatisticsCacheKeys(
  workspaceId: number,
  version: CodingStatisticsVersion
): string[] {
  return LEGACY_CODING_STATISTICS_CACHE_KEY_PREFIXES.map(
    prefix => `${prefix}:${workspaceId}:${version}`
  );
}
