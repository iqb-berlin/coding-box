import {
  hasInvalidPostgresRegexFilter,
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

  it('allows PostgreSQL ARE syntax that JavaScript cannot parse', () => {
    expect(hasInvalidPostgresRegexFilter('(?i)^abc$', true)).toBe(false);
  });

  it('rejects oversized PostgreSQL regex filters locally', () => {
    const pattern = 'a'.repeat(REGEX_FILTER_PATTERN_MAX_LENGTH + 1);

    expect(hasInvalidPostgresRegexFilter(pattern, true)).toBe(true);
  });
});
