import { translateGerman } from '../../../../testing/german-translations';
import { CoderResult } from './double-coded-review.models';
import { fallbackReviewCodes } from './double-coding-code-options';

describe('double coding fallback options', () => {
  const result = (code: number | null, overrides: Partial<CoderResult> = {}): CoderResult => ({
    coderId: 1, coderName: 'Coder', jobId: 1, jobName: 'Job', jobDefinitionId: null, trainingId: null, trainingLabel: null, code, score: 0, notes: null, supervisorComment: null, codedAt: '', ...overrides
  });
  it('deduplicates schema codes, excludes unresolved issues and adds general decisions', () => {
    const options = fallbackReviewCodes([result(0), result(0, { score: 5 }), result(-1), result(-2), result(null), result(5, { codingIssueOption: -3 })], translateGerman);
    expect(options.map(option => option.code)).toEqual([0, -3, -4]);
    expect(options[0]).toMatchObject({ source: 'schema', score: 0 });
    expect(options[1]).toMatchObject({ source: 'general', score: 0 });
    expect(options[2]).toMatchObject({ source: 'general', score: null });
    expect(options.every(option => option.label && !option.label.startsWith('code-selector.'))).toBe(true);
  });
});
