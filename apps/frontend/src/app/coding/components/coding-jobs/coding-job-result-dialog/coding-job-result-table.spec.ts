import { CodingResult, createCodingResultFilter, createCodingResultSorter } from './coding-job-result-table';

describe('coding result table policy', () => {
  const row: CodingResult = {
    unitName: 'Unit', unitAlias: 'Alias', variableId: 'v1', variableAnchor: 'Anchor', bookletName: 'Booklet', personLogin: 'login', personCode: 'person', personGroup: 'group', testPerson: 'person', testPersonSearch: 'login person group', codingIssueOptionLabel: 'Review', code: 0, score: 0, givenScore: 5
  };
  it('combines alias, anchor, issue and person filters without case sensitivity', () => {
    const filter = createCodingResultFilter();
    expect(filter(row, JSON.stringify({
      unitName: 'ALIAS', variable: 'anchor', codingIssue: 'review', testPerson: 'group'
    }))).toBe(true);
    expect(filter(row, JSON.stringify({ unitName: 'Alias', testPerson: 'other' }))).toBe(false);
    expect(filter(row, 'invalid JSON')).toBe(true);
  });
  it('keeps zero scores and codes distinct from missing values', () => {
    const sort = createCodingResultSorter();
    expect(sort(row, 'code')).toBe(0);
    expect(sort(row, 'score')).toBe(0);
    expect(sort({ ...row, score: null }, 'score')).toBe(5);
    expect(sort({ ...row, code: null }, 'code')).toBe(Number.NEGATIVE_INFINITY);
    expect(sort({ ...row, otherCoders: ['A', 'B'] }, 'doubleCoding')).toBe(2);
  });
});
