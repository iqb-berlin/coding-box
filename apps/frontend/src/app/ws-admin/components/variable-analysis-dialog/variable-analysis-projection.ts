import { VariableAnalysisTableRowDto } from '../../../shared/services/response/variable-analysis.service';
import { getResponseStatusLabel } from '../../../shared/utils/response-status-metadata.util';
import { UiTranslator } from '../../../shared/utils/ui-translator';

export interface VariableFrequency {
  unitId?: number;
  unitName?: string;
  variableid: string;
  value: string;
  label?: string;
  score?: number;
  code?: number | string;
  schemaOrder?: number;
  isFromSchema?: boolean;
  isSchemaOnly?: boolean;
  isSchemaSupplemental?: boolean;
  count: number;
  validOccurrenceCount?: number;
  percentage: number;
  percentageTotal?: number;
  percentageValid?: number | null;
  pointBiserial?: number | null;
  codePbc?: number | null;
  categoryPbc?: number | null;
}

export interface VariableStatusCount {
  status: number | string;
  count: number;
  percentage: number;
}

export interface VariableCombo {
  unitId: number;
  unitName: string;
  variableId: string;
  sourceVariableId?: string;
  variableAlias?: string;
  selectionSource?: string;
  sourceType?: string;
  isDerived?: boolean;
  hasCodingScheme?: boolean;
  totalCount?: number;
  validCount?: number;
  invalidCount?: number;
  emptyCount?: number;
  emptyPercentage?: number;
  distinctValueCount?: number;
  statusCounts?: VariableStatusCount[];
}

export interface VariableComboSummary {
  totalCount: number;
  validCount: number;
  invalidCount: number;
  emptyCount: number;
  emptyPercentage: number;
  statusSummary: string;
}

export function variableComboKey(combo: { unitId: number; variableId: string }): string {
  return `${combo.unitId}:${combo.variableId}`;
}

export function variableStatusSummary(statusCounts: VariableStatusCount[], translate: UiTranslator): string {
  if (!statusCounts.length) {
    return translate('variable-analysis.no-status-data');
  }

  const visibleItems = statusCounts.slice(0, 3).map(item => {
    const status = getResponseStatusLabel(item.status);
    return `${status}: ${item.count} (${`${item.percentage.toFixed(1)}%`})`;
  });
  const remainingCount = statusCounts.length - visibleItems.length;

  return remainingCount > 0 ?
    `${visibleItems.join(', ')} +${remainingCount}` :
    visibleItems.join(', ');
}

export function variableComboSummary(combo: VariableCombo, frequenciesByCombo: Record<string, VariableFrequency[]>, translate: UiTranslator): VariableComboSummary {
  const frequencies = frequenciesByCombo[variableComboKey(combo)] || [];
  const totalCount =
    combo.totalCount ??
      frequencies.reduce((sum, item) => sum + item.count, 0);
  const emptyCount =
    combo.emptyCount ??
      frequencies
        .filter(item => item.value === '')
        .reduce((sum, item) => sum + item.count, 0);
  const emptyPercentage =
    combo.emptyPercentage ??
      (totalCount > 0 ? (emptyCount / totalCount) * 100 : 0);
  const validCount = combo.validCount ??
      Math.max(0, totalCount - emptyCount);

  return {
    totalCount,
    validCount,
    invalidCount: combo.invalidCount ?? Math.max(0, totalCount - validCount),
    emptyCount,
    emptyPercentage,
    statusSummary: variableStatusSummary(combo.statusCounts || [], translate)
  };
}

export function withVariableComboSummary(combo: VariableCombo, frequenciesByCombo: Record<string, VariableFrequency[]>): VariableCombo {
  const frequencies = frequenciesByCombo[variableComboKey(combo)] || [];
  const totalCount =
    combo.totalCount ??
      frequencies.reduce((sum, item) => sum + item.count, 0);
  const emptyCount =
    combo.emptyCount ??
      frequencies
        .filter(item => item.value === '')
        .reduce((sum, item) => sum + item.count, 0);
  const validCount = combo.validCount ??
      Math.max(0, totalCount - emptyCount);

  return {
    ...combo,
    totalCount,
    validCount,
    invalidCount: combo.invalidCount ?? Math.max(0, totalCount - validCount),
    emptyCount,
    emptyPercentage:
        combo.emptyPercentage ??
        (totalCount > 0 ? (emptyCount / totalCount) * 100 : 0),
    distinctValueCount: combo.distinctValueCount ?? frequencies.length,
    statusCounts: combo.statusCounts || []
  };
}

export function createVariableAnalysisRows(
  combos: VariableCombo[],
  frequenciesByCombo: Record<string, VariableFrequency[]>,
  translate: UiTranslator
): VariableAnalysisTableRowDto[] {
  return combos.flatMap(combo => {
    const comboKey = variableComboKey(combo);
    const frequencies = frequenciesByCombo[comboKey] || [];
    const summary = variableComboSummary(combo, frequenciesByCombo, translate);
    const distinctValueCount = combo.distinctValueCount ?? frequencies.length;
    const displayedObservedValueCount = frequencies.filter(
      item => !item.isSchemaOnly
    ).length;
    const hiddenValueCount = Math.max(
      0,
      distinctValueCount - displayedObservedValueCount
    );

    const visibleFrequencies: VariableFrequency[] = frequencies.length > 0 ?
      frequencies :
      [{
        unitId: combo.unitId,
        unitName: combo.unitName,
        variableid: combo.variableId,
        value: '',
        count: 0,
        validOccurrenceCount: 0,
        percentage: 0,
        percentageTotal: 0,
        percentageValid: summary.validCount > 0 ? 0 : null,
        pointBiserial: undefined,
        codePbc: undefined,
        categoryPbc: undefined,
        isSchemaOnly: true
      }];

    return visibleFrequencies.map(frequency => {
      const validOccurrenceCount = frequency.validOccurrenceCount ??
          (frequency.value === '' ? 0 : frequency.count);
      const percentageTotal = frequency.percentageTotal ??
          frequency.percentage;
      const percentageValid = frequency.percentageValid ??
          (summary.validCount > 0 ?
            (validOccurrenceCount / summary.validCount) * 100 :
            null);

      return {
        unitId: combo.unitId,
        unitName: combo.unitName,
        variableId: combo.variableId,
        sourceVariableId: combo.sourceVariableId,
        variableAlias: combo.variableAlias,
        selectionSource: combo.selectionSource,
        sourceType: combo.sourceType,
        isDerived: combo.isDerived,
        hasCodingScheme: combo.hasCodingScheme,
        value: frequency.value,
        label: frequency.label,
        score: frequency.score,
        code: frequency.code,
        schemaOrder: frequency.schemaOrder,
        isFromSchema: frequency.isFromSchema,
        isSchemaOnly: frequency.isSchemaOnly,
        isSchemaSupplemental: frequency.isSchemaSupplemental,
        count: frequency.count,
        validOccurrenceCount,
        percentage: percentageTotal,
        percentageTotal,
        percentageValid,
        pointBiserial: frequency.pointBiserial,
        codePbc: frequency.codePbc,
        categoryPbc: frequency.categoryPbc,
        totalCount: summary.totalCount,
        validCount: summary.validCount,
        invalidCount: summary.invalidCount,
        emptyCount: summary.emptyCount,
        emptyPercentage: summary.emptyPercentage,
        distinctValueCount,
        hiddenValueCount,
        statusCounts: combo.statusCounts,
        statusSummary: summary.statusSummary
      };
    });
  });
}
