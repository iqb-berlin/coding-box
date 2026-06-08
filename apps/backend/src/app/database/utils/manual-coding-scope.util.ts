export const MANUAL_CODING_SCOPE_KEY_SEPARATOR = '\u001F';

export interface UnitVariableReference {
  unitName: string;
  variableId: string;
}

export interface ManualCodingCountRow extends UnitVariableReference {
  responseCount?: number | string;
}

export interface ManualCodingCoveredSourceVariable extends UnitVariableReference {
  responseCount: number;
  derivedVariableIds: string[];
}

export interface ManualCodingExcludedSourceSummary {
  coveredSourceVariableCount: number;
  coveredSourceResponseCount: number;
  coveredSourceVariables: ManualCodingCoveredSourceVariable[];
}

export function getManualCodingScopeKey(
  unitName?: string | null,
  variableId?: string | null
): string {
  return `${(unitName || '').trim().toUpperCase()}${MANUAL_CODING_SCOPE_KEY_SEPARATOR}${(variableId || '').trim()}`;
}

export function splitManualCodingScopeKey(key: string): UnitVariableReference {
  const [unitName, variableId] = key.split(MANUAL_CODING_SCOPE_KEY_SEPARATOR);
  return {
    unitName: unitName || '',
    variableId: variableId || ''
  };
}

function getRowResponseCount(row: ManualCodingCountRow): number {
  const count = Number(row.responseCount ?? 1);
  return Number.isFinite(count) ? count : 0;
}

export function getCoveredSourceKeysForManualDerivedVariables(
  manualVariableRows: UnitVariableReference[],
  derivedVariablesBySourceKey: Map<string, Set<string>>
): Set<string> {
  const manualVariableKeys = new Set(
    manualVariableRows.map(row => getManualCodingScopeKey(row.unitName, row.variableId))
  );
  const coveredSourceKeys = new Set<string>();

  derivedVariablesBySourceKey.forEach((derivedVariableIds, sourceKey) => {
    const { unitName } = splitManualCodingScopeKey(sourceKey);
    const hasManualDerivedVariable = Array.from(derivedVariableIds).some(
      derivedVariableId => manualVariableKeys.has(
        getManualCodingScopeKey(unitName, derivedVariableId)
      )
    );

    if (hasManualDerivedVariable) {
      coveredSourceKeys.add(sourceKey);
    }
  });

  return coveredSourceKeys;
}

export function isCoveredSourceVariable(
  row: UnitVariableReference,
  coveredSourceKeys: Set<string>
): boolean {
  return coveredSourceKeys.has(getManualCodingScopeKey(row.unitName, row.variableId));
}

export function getDerivedVariableIdsForSource(
  row: UnitVariableReference,
  derivedVariablesBySourceKey: Map<string, Set<string>>
): string[] {
  return Array.from(
    derivedVariablesBySourceKey.get(getManualCodingScopeKey(row.unitName, row.variableId)) || []
  ).sort((a, b) => a.localeCompare(b));
}

export function summarizeCoveredSourceVariables(
  intendedIncompleteRows: ManualCodingCountRow[],
  coveredSourceKeys: Set<string>,
  derivedVariablesBySourceKey: Map<string, Set<string>>
): ManualCodingExcludedSourceSummary {
  const coveredVariables = new Map<string, ManualCodingCoveredSourceVariable>();

  intendedIncompleteRows.forEach(row => {
    const key = getManualCodingScopeKey(row.unitName, row.variableId);
    if (!coveredSourceKeys.has(key)) {
      return;
    }

    const existing = coveredVariables.get(key);
    if (existing) {
      existing.responseCount += getRowResponseCount(row);
      return;
    }

    coveredVariables.set(key, {
      unitName: row.unitName,
      variableId: row.variableId,
      responseCount: getRowResponseCount(row),
      derivedVariableIds: getDerivedVariableIdsForSource(
        row,
        derivedVariablesBySourceKey
      )
    });
  });

  const coveredSourceVariables = Array.from(coveredVariables.values())
    .sort((a, b) => (
      a.unitName.localeCompare(b.unitName) ||
      a.variableId.localeCompare(b.variableId)
    ));

  return {
    coveredSourceVariableCount: coveredSourceVariables.length,
    coveredSourceResponseCount: coveredSourceVariables.reduce(
      (sum, variable) => sum + variable.responseCount,
      0
    ),
    coveredSourceVariables
  };
}
