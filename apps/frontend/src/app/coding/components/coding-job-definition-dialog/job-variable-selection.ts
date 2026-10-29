import { Variable } from '../../models/coding-job.model';

export function variableUsageKey(unitName?: string | null, variableId?: string | null): string {
  return `${(unitName || '').trim().toLowerCase()}::${(variableId || '').trim().toLowerCase()}`;
}

export function variableSelectionKey(variable: unknown): string {
  if (variable && typeof variable === 'object') {
    const record = variable as Record<string, unknown>;
    const unitName = typeof record.unitName === 'string' ? record.unitName : '';
    const variableIdCandidate = record.variableId ?? record.variableid ?? record.variableID;
    const variableId = typeof variableIdCandidate === 'string' ? variableIdCandidate : '';

    return variableUsageKey(unitName, variableId);
  }

  return variableUsageKey('', '');
}

/** Keep off-page selections and use fresh rows for visible and assigned variables. */
export function reconcileVariableSelection(
  rows: Variable[], selected: Variable[], assigned: Variable[] | undefined, includeDeriveError: boolean
): { variables: Variable[]; selected: Variable[] } {
  const selectedByKey = new Map(selected.map(variable => [
    variableSelectionKey(variable),
    variable
  ]));
  const assignedByKey = new Map((assigned ?? []).map(variable => [
    variableSelectionKey(variable),
    variable
  ]));
  const selectedKeys = new Set([...selectedByKey.keys(), ...assignedByKey.keys()]);
  const currentVariableKeys = new Set(
    rows.map(variable => variableSelectionKey(variable))
  );
  const nextSelectedVariables = selected.filter(
    variable => !currentVariableKeys.has(variableSelectionKey(variable))
  );

  const variables = rows.map(rowVar => {
    const rowKey = variableSelectionKey(rowVar);
    const selectedVariable = selectedByKey.get(rowKey);
    const assignedVariable = assignedByKey.get(rowKey);

    const nextRow = {
      ...rowVar,
      includeDeriveError: includeDeriveError &&
        (selectedVariable?.includeDeriveError === true || assignedVariable?.includeDeriveError === true)
    };

    if (selectedKeys.has(rowKey)) {
      nextSelectedVariables.push(nextRow);
    }
    return nextRow;
  });

  return { variables, selected: nextSelectedVariables };
}
