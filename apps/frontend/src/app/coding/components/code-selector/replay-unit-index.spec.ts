import { BundleContext, UnitsReplayUnit } from '../../../replay/services/units-replay.service';
import { ReplayUnitIndex, sameBundleCase } from './replay-unit-index';

const unit = (id: number, overrides: Partial<UnitsReplayUnit> = {}): UnitsReplayUnit => ({
  id, name: 'Unit', alias: 'Alias', bookletId: 1, variableId: 'v', variableBundleId: 2, ...overrides
});

describe('ReplayUnitIndex', () => {
  it('preserves occurrences and distinguishes aliases from definition names', () => {
    const index = new ReplayUnitIndex();
    const units = [unit(1), unit(2, { alias: 'Other' })];
    index.update(units);
    expect(index.byVariable.get('Alias::v')).toEqual([{ unit: units[0], index: 0 }]);
    expect(index.forDefinitionVariable('unit', 'v').map(entry => entry.index)).toEqual([0, 1]);
    expect(index.byBundle.get(2)?.length).toBe(2);
    expect(index.byResponseId.get(2)?.unit).toBe(units[1]);
    const entries = index.byBundle.get(2);
    index.update(units);
    expect(index.byBundle.get(2)).toBe(entries);
    index.update([unit(3, { variableBundleId: 0 })]);
    expect(index.byResponseId.has(1)).toBe(false);
    expect(index.byBundle.has(0)).toBe(true);
    index.update(null);
    expect(index.byVariable.size).toBe(0);
  });

  it('uses a case key before person fallback and never merges unidentified cases', () => {
    const context: BundleContext = {
      bundleId: 2, bundleName: 'B', caseKey: 'case-1', caseOrderingMode: 'continuous', variables: []
    };
    const current = unit(1, { testPerson: 'person-1' });
    expect(sameBundleCase(unit(2, { bundleContext: { ...context, caseKey: 'case-2' }, testPerson: 'person-1' }), current, context)).toBe(false);
    expect(sameBundleCase(unit(2, { testPerson: 'person-1' }), current, context)).toBe(true);
    expect(sameBundleCase(unit(2), unit(1), context)).toBe(false);
    expect(sameBundleCase(current, current, context)).toBe(true);
  });
});
