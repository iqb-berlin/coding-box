import { applyTestletExclusion } from './testlet-exclusion-policy';

describe('testlet exclusion policy', () => {
  it('normalizes and deduplicates additions without mutating saved exclusions', () => {
    const current = [{ bookletId: 'A', testletId: 'T' }];
    const result = applyTestletExclusion(current, ['a', 'b', 'B'], 't', true);
    expect(result).toEqual({ nextIgnoredTestlets: [{ bookletId: 'A', testletId: 'T' }, { bookletId: 'B', testletId: 'T' }], changedCount: 1 });
    expect(current).toEqual([{ bookletId: 'A', testletId: 'T' }]);
    expect(applyTestletExclusion(result.nextIgnoredTestlets, ['a', 'b'], 't', false)).toEqual({ nextIgnoredTestlets: [], changedCount: 2 });
  });
});
