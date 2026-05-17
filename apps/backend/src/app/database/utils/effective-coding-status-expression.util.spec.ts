import { getEffectiveCodingStatusExpression } from './effective-coding-status-expression.util';

describe('getEffectiveCodingStatusExpression', () => {
  it('uses v1 directly', () => {
    expect(getEffectiveCodingStatusExpression('v1')).toBe('response.status_v1');
  });

  it('falls back from v2 to v1', () => {
    expect(getEffectiveCodingStatusExpression('v2')).toBe(
      'COALESCE(response.status_v2, response.status_v1)'
    );
  });

  it('does not fall back to v1 or v2 for autocoder-generated v3 rows', () => {
    const expression = getEffectiveCodingStatusExpression('v3');

    expect(expression).toContain('WHEN response.is_autocoder_generated = TRUE THEN');
    expect(expression).toContain("THEN CASE WHEN response.status_v3 ~ '^-?[0-9]+$'");
    expect(expression).toContain('ELSE COALESCE(CASE WHEN response.status_v3');
    expect(expression).toContain('response.status_v2, response.status_v1');
  });
});
