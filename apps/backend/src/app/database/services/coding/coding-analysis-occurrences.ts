import type {
  DuplicateValueGroupDto, DuplicateValueOccurrenceDto, EmptyResponseDto
} from '../../../../../../../api-dto/coding/response-analysis.dto';
import type { ReadAnalysisResultItems } from './coding-analysis-result-store';
import type { StoredDuplicateValueGroup } from './coding-analysis-cache-key.util';

export async function readDuplicateOccurrencePage(
  readOccurrences: (start: number, count: number) => Promise<DuplicateValueOccurrenceDto[]>,
  groups: DuplicateValueGroupDto[],
  page?: { page: number; limit: number }
): Promise<DuplicateValueGroupDto[] | null> {
  const start = page ? (page.page - 1) * page.limit : 0;
  const result: DuplicateValueGroupDto[] = [];

  for (const group of groups) {
    if (!('occurrenceStart' in group) && !page) {
      result.push(group);
      continue;
    }

    const {
      occurrenceStart, occurrenceCount, ...publicGroup
    } = group as Partial<StoredDuplicateValueGroup> & DuplicateValueGroupDto;
    const total = occurrenceCount ?? publicGroup.occurrences.length;
    const count = Math.max(0, Math.min(page?.limit ?? total, total - start));
    const occurrences = count === 0 || occurrenceStart === undefined || start + count <= group.occurrences.length ?
      group.occurrences.slice(start, start + count) :
      await readOccurrences(occurrenceStart + start, count);
    if (occurrences.length !== count) return null;
    result.push(page ? { ...publicGroup, occurrenceCount: total, occurrences } : { ...publicGroup, occurrences });
  }
  return result;
}

export async function readStoredAnalysisPage(
  reader: ReadAnalysisResultItems,
  empty: { start: number; count: number },
  duplicates: { start: number; count: number },
  occurrences?: { page: number; limit: number }
) {
  const [emptyItems, groups] = await Promise.all([
    reader<EmptyResponseDto>('empty', empty.start, empty.count),
    reader<DuplicateValueGroupDto>('duplicates', duplicates.start, duplicates.count)
  ]);
  if (groups.length !== duplicates.count || emptyItems.length !== empty.count) return null;
  const duplicateGroups = await readDuplicateOccurrencePage(
    (start, count) => reader<DuplicateValueOccurrenceDto>('occurrences', start, count), groups, occurrences
  );
  return duplicateGroups ? { emptyItems, duplicateGroups } : null;
}
