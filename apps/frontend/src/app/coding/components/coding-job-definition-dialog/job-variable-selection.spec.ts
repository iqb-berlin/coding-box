import { reconcileVariableSelection, variableSelectionKey } from './job-variable-selection';
import { Variable } from '../../models/coding-job.model';

describe('variable selection reconciliation', () => {
  const row: Variable = { unitName: 'UNIT', variableId: 'V', availableCases: 12 };

  it('keeps off-page selections while replacing visible selections with fresh metrics', () => {
    const offPage = { unitName: 'OTHER', variableId: 'V', includeDeriveError: true };
    const result = reconcileVariableSelection([row], [offPage, { ...row, availableCases: 0, includeDeriveError: true }], [], true);
    expect(result.selected).toEqual([offPage, { ...row, includeDeriveError: true }]);
    expect(result.selected[1]).toBe(result.variables[0]);
    expect(row.includeDeriveError).toBeUndefined();
  });

  it('restores assigned selections and drops derive-error opt-ins when the workspace disables them', () => {
    const result = reconcileVariableSelection([row], [], [{ ...row, includeDeriveError: true }], false);
    expect(result.selected).toEqual([{ ...row, includeDeriveError: false }]);
  });

  it.each(['variableId', 'variableid', 'variableID'])('recognizes the persisted %s alias and normalized keys', field => {
    expect(variableSelectionKey({ unitName: ' UNIT ', [field]: ' V ' })).toBe('unit::v');
  });
});
