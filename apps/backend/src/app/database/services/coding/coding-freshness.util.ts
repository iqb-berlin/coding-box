import { CodingFreshnessVersion } from '../../../../../../../api-dto/coding/coding-freshness.dto';

export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values
    .map(value => value?.trim())
    .filter((value): value is string => Boolean(value))));
}

export function uniqueVersions(versions: CodingFreshnessVersion[]): CodingFreshnessVersion[] {
  const allowed = new Set<CodingFreshnessVersion>(['v1', 'v2', 'v3']);
  return Array.from(new Set(versions.filter(version => allowed.has(version))));
}

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function collectChunked<T, R>(
  items: T[],
  size: number,
  callback: (chunkItems: T[]) => Promise<R[]>
): Promise<R[]> {
  const results: R[] = [];
  for (const chunkItems of chunk(items, size)) {
    results.push(...await callback(chunkItems));
  }
  return results;
}

export function uniquePositiveIds(ids: number[]): number[] {
  return Array.from(
    new Set(
      ids
        .map(id => Number(id))
        .filter(id => Number.isInteger(id) && id > 0)
    )
  );
}
