import type {
  DuplicateValueGroupDto, DuplicateValueOccurrenceDto
} from '../../../../../../../api-dto/coding/response-analysis.dto';
import type { CacheService } from '../../../cache/cache.service';
import type { StoredDuplicateValueGroup } from './coding-analysis-cache-key.util';

export async function readDuplicateOccurrencePage(
  cache: CacheService, key: string, groups: DuplicateValueGroupDto[],
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
      await cache.getListItems<DuplicateValueOccurrenceDto>(key, occurrenceStart + start, count);
    if (occurrences.length !== count) return null;
    result.push(page ? { ...publicGroup, occurrenceCount: total, occurrences } : { ...publicGroup, occurrences });
  }
  return result;
}
