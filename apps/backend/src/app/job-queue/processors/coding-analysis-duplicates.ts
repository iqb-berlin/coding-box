import type { StoredDuplicateValueGroup } from '../../database/services/coding/coding-analysis-cache-key.util';
import type { CodingAnalysisResultWriter } from '../../database/services/coding/coding-analysis-result-store';
import {
  type DuplicateValueOccurrenceDto, RESPONSE_ANALYSIS_OCCURRENCE_PREVIEW_SIZE
} from '../../../../../../api-dto/coding/response-analysis.dto';

export type DuplicateCandidate = [
  unitName: string, variableId: string, normalizedValue: string,
  physicalUnitId: number | null, unitAlias: string | null, occurrence: DuplicateValueOccurrenceDto
];

export const ANALYSIS_BATCH_SIZE = 500;

/** Equal group keys are contiguous in the disk-backed index, including across read pages. */
export async function writeDuplicateResults(
  writer: CodingAnalysisResultWriter, threshold: number
): Promise<{ groups: number; occurrences: number }> {
  let groupCount = 0;
  let occurrenceCount = 0;
  let current: StoredDuplicateValueGroup | undefined;
  let currentKey = '';
  let pending: DuplicateValueOccurrenceDto[] = [];

  const finishGroup = (groups: StoredDuplicateValueGroup[]) => {
    if (current && current.occurrenceCount >= threshold) {
      groups.push(current);
      groupCount += 1;
    }
  };

  let after = '';
  while (true) {
    const page = await writer.readCandidatePage(after, ANALYSIS_BATCH_SIZE);
    if (page.length === 0) break;
    after = page[page.length - 1];
    const rows = page.map(payload => JSON.parse(payload) as DuplicateCandidate);

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
    await writer.appendItems('occurrences', occurrences);
    await writer.appendItems('duplicates', groups);
  }

  const finalGroups: StoredDuplicateValueGroup[] = [];
  finishGroup(finalGroups);
  await writer.appendItems('duplicates', finalGroups);
  return { groups: groupCount, occurrences: occurrenceCount };
}
