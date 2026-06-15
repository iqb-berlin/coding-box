import {
  isRegexPatternValid,
  matchesTextFilter,
  REGEX_FILTER_PATTERN_MAX_LENGTH
} from './regex-filter.util';

describe('regex-filter.util', () => {
  it('accepts regex patterns up to the backend length limit', () => {
    const pattern = 'a'.repeat(REGEX_FILTER_PATTERN_MAX_LENGTH);

    expect(isRegexPatternValid(pattern)).toBe(true);
  });

  it('rejects regex patterns beyond the backend length limit', () => {
    const pattern = 'a'.repeat(REGEX_FILTER_PATTERN_MAX_LENGTH + 1);

    expect(isRegexPatternValid(pattern)).toBe(false);
  });

  it('does not match oversized regex filters', () => {
    const pattern = 'a'.repeat(REGEX_FILTER_PATTERN_MAX_LENGTH + 1);

    expect(matchesTextFilter(pattern, pattern, true)).toBe(false);
  });
});
