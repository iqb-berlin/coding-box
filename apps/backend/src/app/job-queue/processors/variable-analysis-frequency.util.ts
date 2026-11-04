export function getTopMultipleResponseCounts(
  counts: Map<string, number>,
  limit: number
): [string, number][] {
  const topCategories = Array.from(counts.entries())
    .filter(([value]) => value !== '')
    .sort(([valueA, countA], [valueB, countB]) => countB - countA || valueA.localeCompare(valueB))
    .slice(0, limit);
  const emptyCount = counts.get('') || 0;

  // Empty answers stay visible independently of the category limit.
  return emptyCount > 0 ? [...topCategories, ['', emptyCount]] : topCategories;
}
