import type { VariableFrequencyDto } from '../../admin/variable-analysis/dto/variable-frequency.dto';
import type { SchemaValueDefinition } from './variable-analysis-schema.util';

export function getTopMultipleResponseCounts(
  counts: ReadonlyMap<string, number>,
  emptyCount: number,
  limit: number
): [string, number][] {
  const topCategories = Array.from(counts.entries())
    .sort(([valueA, countA], [valueB, countB]) => countB - countA || valueA.localeCompare(valueB))
    .slice(0, limit);

  // Empty answers stay visible independently of the category limit.
  return emptyCount > 0 ? [...topCategories, ['', emptyCount]] : topCategories;
}

export function shouldSkipSchemaFrequency(
  schemaValue: SchemaValueDefinition,
  count: number,
  multiple: boolean,
  rowsByValue: ReadonlyMap<string, VariableFrequencyDto>
): boolean {
  return count === 0 && (schemaValue.isObservedOnly === true ||
    (multiple && schemaValue.value.trim() === '' && rowsByValue.get('')?.isEmptyValue === true));
}
