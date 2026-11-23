import type { CacheService } from '../../cache/cache.service';
import {
  getCodingAnalysisListKeys, type StoredDuplicateValueGroup
} from '../../database/services/coding/coding-analysis-cache-key.util';
import {
  type DuplicateValueOccurrenceDto, RESPONSE_ANALYSIS_OCCURRENCE_PREVIEW_SIZE
} from '../../../../../../api-dto/coding/response-analysis.dto';

export type DuplicateCandidate = [
  unitName: string, variableId: string, normalizedValue: string,
  physicalUnitId: number | null, unitAlias: string | null, occurrence: DuplicateValueOccurrenceDto
];

export const ANALYSIS_BATCH_SIZE = 500;

/** Equal group keys are contiguous in the sorted set, including across read pages. */
export async function writeDuplicateResults(
  cache: CacheService, listPrefix: string, candidateKey: string, candidateCount: number,
  threshold: number, initialOccurrenceCount: number, ttl: number
): Promise<{ groups: number; occurrences: number }> {
  const lists = getCodingAnalysisListKeys(listPrefix);
  let groupCount = 0;
  let occurrenceCount = initialOccurrenceCount;
  let current: StoredDuplicateValueGroup | undefined;
  let currentKey = '';
  let pending: DuplicateValueOccurrenceDto[] = [];

  const finishGroup = (groups: StoredDuplicateValueGroup[]) => {
    if (current && current.occurrenceCount >= threshold) {
      groups.push(current);
      groupCount += 1;
    }
  };

  for (let start = 0; start < candidateCount; start += ANALYSIS_BATCH_SIZE) {
    const limit = Math.min(ANALYSIS_BATCH_SIZE, candidateCount - start);
    const rows = await cache.getSortedItems<DuplicateCandidate>(candidateKey, start, limit);
    if (rows.length !== limit) throw new Error('Incomplete response analysis candidates');

    const groups: StoredDuplicateValueGroup[] = [];
    const occurrences: DuplicateValueOccurrenceDto[] = [];
    for (const [unitName, variableId, normalizedValue, physicalUnitId, unitAlias, occurrence] of rows) {
      const key = JSON.stringify([unitName, variableId, normalizedValue, physicalUnitId]);
      if (!current || key !== currentKey) {
        finishGroup(groups);
        currentKey = key;
        pending = [];
        current = {
          unitName,
          unitAlias,
          variableId,
          normalizedValue,
          originalValue: occurrence.value,
          occurrences: [],
          occurrenceStart: occurrenceCount,
          occurrenceCount: 0
        };
      }

      if (current.occurrences.length < RESPONSE_ANALYSIS_OCCURRENCE_PREVIEW_SIZE) current.occurrences.push(occurrence);
      current.occurrenceCount += 1;
      if (current.occurrenceCount < threshold) {
        pending.push(occurrence);
      } else {
        occurrences.push(...pending, occurrence);
        occurrenceCount += pending.length + 1;
        pending = [];
      }
    }
    if (start + limit === candidateCount) finishGroup(groups);
    await cache.appendListItems(lists.occurrences, occurrences, ttl);
    await cache.appendListItems(lists.duplicates, groups, ttl);
  }

  return { groups: groupCount, occurrences: occurrenceCount - initialOccurrenceCount };
}
