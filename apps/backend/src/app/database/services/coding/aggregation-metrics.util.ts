import { AggregationSummaryDto } from '../../../../../../../api-dto/coding/response-analysis.dto';

export type AggregationMatchingFlag =
  | 'NO_AGGREGATION'
  | 'IGNORE_CASE'
  | 'IGNORE_WHITESPACE'
  | string;

export interface AggregationSourceResponse {
  responseId: number;
  unitName: string;
  variableId: string;
  value: string | null;
}

export interface AggregationGroup<T extends AggregationSourceResponse> {
  key: string;
  responses: T[];
}

export function normalizeAggregationValue(
  value: string | null,
  flags: readonly AggregationMatchingFlag[]
): string {
  let normalized = value ?? '';

  if (flags.includes('IGNORE_CASE')) {
    normalized = normalized.toLowerCase();
  }

  if (flags.includes('IGNORE_WHITESPACE')) {
    normalized = normalized.replace(/\s+/g, '');
  }

  return normalized;
}

export function isAggregatableValue(value: string | null): boolean {
  return !(
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '') ||
    value === '[]'
  );
}

export function isDerivedAggregationVariable(
  derivedVariableMap: Map<string, Set<string>>,
  unitName: string,
  variableId: string
): boolean {
  return derivedVariableMap.get(unitName.toUpperCase())?.has(variableId) ?? false;
}

export function buildAggregationGroups<T extends AggregationSourceResponse>(
  responses: T[],
  matchingFlags: readonly AggregationMatchingFlag[],
  threshold: number | null,
  derivedVariableMap: Map<string, Set<string>>
): AggregationGroup<T>[] {
  const aggregationActive =
    threshold !== null && !matchingFlags.includes('NO_AGGREGATION');

  const groupedResponses = new Map<string, T[]>();

  for (const response of responses) {
    const variableKey = `${response.unitName.toUpperCase()}::${response.variableId}`;
    const keepSeparate =
      !aggregationActive ||
      !isAggregatableValue(response.value) ||
      isDerivedAggregationVariable(
        derivedVariableMap,
        response.unitName,
        response.variableId
      );

    const groupKey = keepSeparate ?
      `${variableKey}::${response.responseId}` :
      `${variableKey}::${normalizeAggregationValue(response.value, matchingFlags)}`;
    const group = groupedResponses.get(groupKey) || [];
    group.push(response);
    groupedResponses.set(groupKey, group);
  }

  return Array.from(groupedResponses.entries()).map(([key, responsesInGroup]) => ({
    key,
    responses: responsesInGroup
  }));
}

export function summarizeAggregationGroups<T extends AggregationSourceResponse>(
  groups: AggregationGroup<T>[],
  rawCases: number,
  threshold: number | null,
  matchingFlags: readonly AggregationMatchingFlag[]
): AggregationSummaryDto {
  const aggregationActive =
    threshold !== null && !matchingFlags.includes('NO_AGGREGATION');

  if (!aggregationActive) {
    return {
      duplicateGroups: 0,
      duplicateResponses: 0,
      collapsedCases: 0,
      rawCases,
      effectiveCases: rawCases,
      threshold,
      aggregationActive
    };
  }

  const aggregatingGroups = groups.filter(group => (
    threshold !== null && group.responses.length >= threshold
  ));
  const duplicateResponses = aggregatingGroups.reduce(
    (sum, group) => sum + group.responses.length,
    0
  );
  const collapsedCases = aggregatingGroups.reduce(
    (sum, group) => sum + group.responses.length - 1,
    0
  );

  return {
    duplicateGroups: aggregatingGroups.length,
    duplicateResponses,
    collapsedCases,
    rawCases,
    effectiveCases: Math.max(0, rawCases - collapsedCases),
    threshold,
    aggregationActive
  };
}

export function createAggregationSummary(
  duplicateGroups: number,
  duplicateResponses: number,
  rawCases: number,
  threshold: number | null,
  matchingFlags: readonly AggregationMatchingFlag[]
): AggregationSummaryDto {
  const aggregationActive =
    threshold !== null && !matchingFlags.includes('NO_AGGREGATION');
  const collapsedCases = aggregationActive ?
    Math.max(0, duplicateResponses - duplicateGroups) :
    0;

  return {
    duplicateGroups: aggregationActive ? duplicateGroups : 0,
    duplicateResponses: aggregationActive ? duplicateResponses : 0,
    collapsedCases,
    rawCases,
    effectiveCases: Math.max(0, rawCases - collapsedCases),
    threshold,
    aggregationActive
  };
}
