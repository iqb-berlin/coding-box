import { VariableAnalysisOptions } from '../../../../../../../api-dto/coding/variable-analysis-options';
import { isEmptyVariableAnalysisValue, isValidVariableAnalysisRawValue } from '../../../../../../../api-dto/coding/variable-analysis-rules';
import { VariableAnalysisTableRowDto } from '../../../shared/services/response/variable-analysis.service';
import { getResponseStatusLabel, getResponseStatusMetadata } from '../../../shared/utils/response-status-metadata.util';
import { UiTranslator } from '../../../shared/utils/ui-translator';

export interface VariableFrequency {
  unitId?: number;
  unitName?: string;
  variableid: string;
  value: string;
  isEmptyValue?: boolean;
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

export interface VariableCombo extends VariableAnalysisOptions {
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

  const visibleItems = statusCounts.map(item => {
    const status = getResponseStatusLabel(item.status);
    return `${status}: ${item.count} (${`${item.percentage.toFixed(1)}%`})`;
  });
  return visibleItems.join(', ');
}

export function variableComboSummary(combo: VariableCombo, frequenciesByCombo: Record<string, VariableFrequency[]>, translate: UiTranslator): VariableComboSummary {
  const summary = withVariableComboSummary(combo, frequenciesByCombo);

  return {
    totalCount: summary.totalCount,
    validCount: summary.validCount,
    invalidCount: summary.invalidCount,
    emptyCount: summary.emptyCount,
    emptyPercentage: summary.emptyPercentage,
    statusSummary: variableStatusSummary(combo.statusCounts || [], translate)
  };
}

export function withVariableComboSummary(combo: VariableCombo, frequenciesByCombo: Record<string, VariableFrequency[]>): VariableCombo & Omit<VariableComboSummary, 'statusSummary'> {
  const frequencies = frequenciesByCombo[variableComboKey(combo)] || [];
  const totalCount =
    combo.totalCount ??
      frequencies.reduce((sum, item) => sum + item.count, 0);
  const emptyCount =
    combo.emptyCount ??
      frequencies
        .filter(item => item.isEmptyValue ?? isEmptyVariableAnalysisValue(item.value))
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
          ((frequency.isEmptyValue ?? isEmptyVariableAnalysisValue(frequency.value)) ? 0 : frequency.count);
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
        analysisMode: combo.analysisMode,
        codingVersion: combo.codingVersion,
        value: frequency.value,
        isEmptyValue: frequency.isEmptyValue ?? isEmptyVariableAnalysisValue(frequency.value),
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

export function summarizeVariableAnalysisResponses(
  responses: readonly { variableid: string; value: string; status: string | number }[]
): {
  responsesByVariable: Record<string, Record<string, number>>;
  validCountsByVariable: Map<string, Map<string, number>>;
  comboSummaries: Map<string, VariableCombo>;
} {
  const responsesByVariable: Record<string, Record<string, number>> = {};
  const validCountsByVariable = new Map<string, Map<string, number>>();
  const comboSummaries = new Map<string, VariableCombo>();
  responses.forEach(response => {
    if (!responsesByVariable[response.variableid]) {
      responsesByVariable[response.variableid] = {};
    }

    const value = response.value || '';
    if (!responsesByVariable[response.variableid][value]) {
      responsesByVariable[response.variableid][value] = 0;
    }

    responsesByVariable[response.variableid][value] += 1;

    const comboKey = `0:${response.variableid}`;
    const summary = comboSummaries.get(comboKey) || {
      unitId: 0,
      unitName: 'Unknown',
      variableId: response.variableid,
      totalCount: 0,
      validCount: 0,
      emptyCount: 0,
      emptyPercentage: 0,
      distinctValueCount: 0,
      statusCounts: []
    };
    summary.totalCount = (summary.totalCount || 0) + 1;
    const isEmpty = isEmptyVariableAnalysisValue(value);
    const numericStatus = getResponseStatusMetadata(response.status)?.numeric ?? 0;
    const isValid = isValidVariableAnalysisRawValue(value, numericStatus);
    if (isEmpty) summary.emptyCount = (summary.emptyCount || 0) + 1;
    if (isValid) {
      summary.validCount = (summary.validCount || 0) + 1;
      const validCounts = validCountsByVariable.get(response.variableid) ?? new Map<string, number>();
      validCounts.set(value, (validCounts.get(value) ?? 0) + 1);
      validCountsByVariable.set(response.variableid, validCounts);
    }

    const status = response.status;
    const statusCounts = summary.statusCounts || [];
    const existingStatus = statusCounts.find(
      item => item.status === status
    );
    if (existingStatus) {
      existingStatus.count += 1;
    } else {
      statusCounts.push({ status, count: 1, percentage: 0 });
    }
    summary.statusCounts = statusCounts;
    comboSummaries.set(comboKey, summary);
  });
  return { responsesByVariable, validCountsByVariable, comboSummaries };
}
