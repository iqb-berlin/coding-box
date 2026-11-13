import type { VariableFrequencyDto } from '../../admin/variable-analysis/dto/variable-frequency.dto';
import type { VariableAnalysisCategoryDefinition } from './variable-analysis-metadata.util';

// A numeric key identifies the one-based Boolean position without a declared value.
export type MultipleResponseCategoryKey = string | number;

export interface FrequencyCounts {
  count: number;
  validCount: number;
  nullCount: number;
}

export interface MultipleResponseObservedCounts {
  counts: ReadonlyMap<MultipleResponseCategoryKey, number>;
  validCounts: ReadonlyMap<MultipleResponseCategoryKey, number>;
}

export function getSchemaFrequencyCounts(
  key: MultipleResponseCategoryKey,
  multipleCounts: MultipleResponseObservedCounts | undefined,
  observedCounts: FrequencyCounts | undefined
): FrequencyCounts {
  if (multipleCounts) {
    return {
      count: multipleCounts.counts.get(key) ?? 0,
      validCount: multipleCounts.validCounts.get(key) ?? 0,
      nullCount: 0
    };
  }
  return observedCounts ?? { count: 0, validCount: 0, nullCount: 0 };
}

export function getTopMultipleResponseCounts(
  counts: ReadonlyMap<MultipleResponseCategoryKey, number>,
  emptyCount: number,
  limit: number
): [MultipleResponseCategoryKey, number][] {
  const topCategories = Array.from(counts.entries())
    // Prefer Boolean positions when frequency and sort text match.
    .sort(([keyA, countA], [keyB, countB]) => countB - countA ||
      String(keyA).localeCompare(String(keyB)) ||
      Number(typeof keyB === 'number') - Number(typeof keyA === 'number'))
    .slice(0, limit);

  // Empty answers stay visible independently of the category limit.
  return emptyCount > 0 ? [...topCategories, ['', emptyCount]] : topCategories;
}

export function shouldSkipSchemaFrequency(
  schemaValue: VariableAnalysisCategoryDefinition,
  count: number,
  multiple: boolean,
  rowsByKey: ReadonlyMap<MultipleResponseCategoryKey, VariableFrequencyDto>
): boolean {
  return count === 0 && (schemaValue.isObservedOnly === true ||
    (multiple && schemaValue.value.trim() === '' && rowsByKey.get('')?.isEmptyValue === true));
}
