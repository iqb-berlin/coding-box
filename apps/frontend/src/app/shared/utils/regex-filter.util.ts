export const REGEX_FILTER_PATTERN_MAX_LENGTH = 256;

export function isRegexPatternValid(pattern: string): boolean {
  const normalizedPattern = pattern.trim();
  if (!normalizedPattern) {
    return true;
  }

  if (normalizedPattern.length > REGEX_FILTER_PATTERN_MAX_LENGTH) {
    return false;
  }

  try {
    RegExp(normalizedPattern);
    return true;
  } catch {
    return false;
  }
}

export function hasInvalidRegexFilter(
  pattern: string | null | undefined,
  regexSearch: boolean
): boolean {
  return regexSearch && !isRegexPatternValid(pattern || '');
}

export function hasInvalidPostgresRegexFilter(
  pattern: string | null | undefined,
  regexSearch: boolean
): boolean {
  if (!regexSearch) {
    return false;
  }

  // PostgreSQL uses ARE syntax, which is not fully compatible with
  // JavaScript's RegExp parser. Syntax is validated by the backend preflight.
  return (pattern || '').trim().length > REGEX_FILTER_PATTERN_MAX_LENGTH;
}

export function matchesTextFilter(
  value: string | number | null | undefined,
  filter: string | null | undefined,
  regexSearch: boolean
): boolean {
  const normalizedFilter = (filter || '').trim();
  if (!normalizedFilter) {
    return true;
  }

  const text = String(value ?? '');
  if (regexSearch) {
    if (!isRegexPatternValid(normalizedFilter)) {
      return false;
    }

    try {
      return new RegExp(normalizedFilter).test(text);
    } catch {
      return false;
    }
  }

  return text.toLowerCase().includes(normalizedFilter.toLowerCase());
}
