import { createHash } from 'crypto';
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

export interface ManualCodingDeduplicationResponse extends AggregationSourceResponse {
  personLogin?: string | null;
  personCode?: string | null;
  personGroup?: string | null;
  bookletName?: string | null;
}

export interface EffectiveManualCodingCaseCounts {
  uniqueCases: number;
  casesInJobs: number;
}

export interface AggregationPeerKey {
  unitName: string;
  variableId: string;
  normalizedValue: string;
}

export interface AggregationPeerValueCandidate {
  unitName: string;
  variableId: string;
  value: string | null;
}

export interface AggregationPeerLookupKey {
  unitName: string;
  variableId: string;
  value: string;
}

export function buildAggregationPeerLookupKeys(
  peerKeys: readonly AggregationPeerKey[],
  candidates: readonly AggregationPeerValueCandidate[],
  matchingFlags: readonly AggregationMatchingFlag[]
): AggregationPeerLookupKey[] {
  const peerKeySet = new Set(peerKeys.map(serializeAggregationPeerKey));
  const lookupKeys = new Map<string, AggregationPeerLookupKey>();

  candidates.forEach(candidate => {
    if (!isAggregatableValue(candidate.value)) {
      return;
    }

    const peerKey = getAggregationPeerKey(
      candidate.unitName,
      candidate.variableId,
      candidate.value,
      matchingFlags
    );
    if (!peerKeySet.has(serializeAggregationPeerKey(peerKey))) {
      return;
    }

    const lookupKey = {
      unitName: candidate.unitName,
      variableId: candidate.variableId,
      value: candidate.value as string
    };
    lookupKeys.set(JSON.stringify([
      lookupKey.unitName,
      lookupKey.variableId,
      lookupKey.value
    ]), lookupKey);
  });

  return Array.from(lookupKeys.values());
}

export function serializeAggregationPeerKey(
  peerKey: AggregationPeerKey
): string {
  return JSON.stringify([
    peerKey.unitName,
    peerKey.variableId,
    peerKey.normalizedValue
  ]);
}

export function getAggregationPeerKey(
  unitName: string,
  variableId: string,
  value: string | null,
  matchingFlags: readonly AggregationMatchingFlag[]
): AggregationPeerKey {
  return {
    unitName: unitName.toUpperCase(),
    variableId,
    normalizedValue: normalizeAggregationValue(value, matchingFlags)
  };
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

export function getAggregationVariableKey(
  unitName: string,
  variableId: string
): string {
  return `${unitName.toUpperCase()}::${variableId}`;
}

export function partitionResponsesByAggregationVariable<T>(
  responses: readonly T[],
  variables: readonly { unitName: string; variableId: string }[],
  getVariableReference: (response: T) => {
    unitName: string;
    variableId: string;
  }
): Map<string, T[]> {
  const variableKeys = new Set(
    variables.map(variable => getAggregationVariableKey(
      variable.unitName,
      variable.variableId
    ))
  );

  const partitionedResponses = new Map<string, T[]>();
  responses.forEach(response => {
    const reference = getVariableReference(response);
    const variableKey = getAggregationVariableKey(
      reference.unitName,
      reference.variableId
    );
    if (!variableKeys.has(variableKey)) {
      return;
    }

    const variableResponses = partitionedResponses.get(variableKey) || [];
    variableResponses.push(response);
    partitionedResponses.set(variableKey, variableResponses);
  });

  return partitionedResponses;
}

export function buildAggregationPeerKeys<T extends AggregationSourceResponse>(
  responses: T[],
  matchingFlags: readonly AggregationMatchingFlag[],
  derivedVariableMap: Map<string, Set<string>>
): AggregationPeerKey[] {
  const keys = new Map<string, AggregationPeerKey>();

  responses.forEach(response => {
    if (
      !isAggregatableValue(response.value) ||
      isDerivedAggregationVariable(
        derivedVariableMap,
        response.unitName,
        response.variableId
      )
    ) {
      return;
    }

    const peerKey = getAggregationPeerKey(
      response.unitName,
      response.variableId,
      response.value,
      matchingFlags
    );
    keys.set(serializeAggregationPeerKey(peerKey), peerKey);
  });

  return Array.from(keys.values());
}

export function getManualCodingDeduplicationKey(
  response: ManualCodingDeduplicationResponse
): string {
  const valueHash = createHash('sha1').update(response.value || '').digest('hex');
  return [
    response.personLogin || '',
    response.personCode || '',
    response.personGroup || '',
    response.bookletName || '',
    response.unitName.toUpperCase(),
    response.variableId,
    valueHash
  ].join('::');
}

export function deduplicateManualCodingResponses<T extends ManualCodingDeduplicationResponse>(
  responses: T[]
): T[] {
  const dedupedByPersonValue = new Map<string, T>();

  for (const response of responses) {
    const key = getManualCodingDeduplicationKey(response);
    const existing = dedupedByPersonValue.get(key);
    if (!existing || response.responseId < existing.responseId) {
      dedupedByPersonValue.set(key, response);
    }
  }

  return Array.from(dedupedByPersonValue.values());
}

export function countEffectiveManualCodingCases<T extends ManualCodingDeduplicationResponse>(
  responses: T[],
  assignedResponseIds: ReadonlySet<number>,
  matchingFlags: readonly AggregationMatchingFlag[],
  threshold: number | null,
  derivedVariableMap: Map<string, Set<string>>,
  activeResponseIds?: ReadonlySet<number>
): EffectiveManualCodingCaseCounts {
  const assignedDeduplicationKeys = new Set(
    responses
      .filter(response => assignedResponseIds.has(response.responseId))
      .map(response => getManualCodingDeduplicationKey(response))
  );
  const dedupedResponses = deduplicateManualCodingResponses(responses);
  const assignedDedupedResponseIds = new Set(
    dedupedResponses
      .filter(response => (
        assignedResponseIds.has(response.responseId) ||
        assignedDeduplicationKeys.has(getManualCodingDeduplicationKey(response))
      ))
      .map(response => response.responseId)
  );
  const activeDeduplicationKeys = activeResponseIds ? new Set(
    responses
      .filter(response => activeResponseIds.has(response.responseId))
      .map(response => getManualCodingDeduplicationKey(response))
  ) : null;
  const activeDedupedResponseIds = activeResponseIds ? new Set(
    dedupedResponses
      .filter(response => (
        activeResponseIds.has(response.responseId) ||
        activeDeduplicationKeys?.has(getManualCodingDeduplicationKey(response))
      ))
      .map(response => response.responseId)
  ) : null;
  const aggregatedGroups = buildAggregationGroups(
    dedupedResponses,
    matchingFlags,
    threshold,
    derivedVariableMap
  );
  let uniqueCases = 0;
  let casesInJobs = 0;

  for (const group of aggregatedGroups) {
    const activeResponses = activeDedupedResponseIds ?
      group.responses.filter(response => activeDedupedResponseIds.has(response.responseId)) :
      group.responses;

    if (activeResponses.length === 0) {
      continue;
    }

    if (threshold !== null && group.responses.length >= threshold) {
      uniqueCases += 1;
      if (group.responses.some(response => assignedDedupedResponseIds.has(response.responseId))) {
        casesInJobs += 1;
      }
      continue;
    }

    uniqueCases += activeResponses.length;
    casesInJobs += activeResponses
      .filter(response => assignedDedupedResponseIds.has(response.responseId))
      .length;
  }

  return { uniqueCases, casesInJobs };
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
    const variableKey = getAggregationVariableKey(
      response.unitName,
      response.variableId
    );
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
