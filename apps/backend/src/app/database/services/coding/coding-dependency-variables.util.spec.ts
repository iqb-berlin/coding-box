import { getBaseCodingSourceKeys, getCodingDependencyVariables, mergeCodingVariableMaps } from './coding-dependency-variables.util';

describe('coding dependency variables', () => {
  it('keeps derived intermediate sources out of base-source placeholder filtering', () => {
    expect(getBaseCodingSourceKeys(new Map([
      ['UNIT1\u001fpanel', new Set(['derived'])],
      ['UNIT1\u001fderived', new Set(['total'])],
      ['UNIT2\u001fderived', new Set(['other'])]
    ]))).toEqual(['UNIT1\u001fPANEL', 'UNIT2\u001fDERIVED']);
  });
  it('includes sources and derived targets without changing the manual selection', () => {
    const manual = new Map([['Unit1', new Set(['03a'])]]);
    const dependencies = getCodingDependencyVariables(new Map([
      ['UNIT1\u001f_03_reached', new Set(['_03'])],
      ['UNIT1\u001f03a', new Set(['_03'])]
    ]));
    expect(mergeCodingVariableMaps(manual, dependencies).get('UNIT1'))
      .toEqual(new Set(['03a', '_03_reached', '_03']));
    expect(manual.get('Unit1')).toEqual(new Set(['03a']));
    expect(dependencies.has('UNIT2')).toBe(false);
  });
});
