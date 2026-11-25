import type { DuplicateValueGroupDto, ResponseAnalysisDto } from '../../../../../../../api-dto/coding/response-analysis.dto';

type CodingAnalysisSummary = Omit<ResponseAnalysisDto, 'emptyResponses' | 'duplicateValues'> & {
  emptyResponses: Omit<ResponseAnalysisDto['emptyResponses'], 'items'>;
  duplicateValues: Omit<ResponseAnalysisDto['duplicateValues'], 'groups'>;
};

export type PagedCodingAnalysis = CodingAnalysisSummary & { storage: 'paged'; listPrefix: string };
export type FileCodingAnalysis = CodingAnalysisSummary & { storage: 'file'; resultId: string };

export type StoredDuplicateValueGroup = DuplicateValueGroupDto & {
  occurrenceStart: number;
  occurrenceCount: number;
};

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

export function getCodingAnalysisListKeys(prefix: string) {
  return {
    empty: `${prefix}:empty`,
    duplicates: `${prefix}:duplicates`,
    occurrences: `${prefix}:occurrences`
  };
}
