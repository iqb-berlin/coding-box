import { getEffectiveCodingStatusExpression } from './effective-coding-status-expression.util';

describe('getEffectiveCodingStatusExpression', () => {
  it('uses v1 directly', () => {
    expect(getEffectiveCodingStatusExpression('v1')).toBe('response.status_v1');
  });

  it('falls back from v2 to v1', () => {
    const expression = getEffectiveCodingStatusExpression('v2');

    expect(expression).toContain('CASE');
    expect(expression).toContain('response.status_v2 = 8');
    expect(expression).toContain('FROM coding_job_unit effective_status_cju');
    expect(expression).toContain("effective_status_cj.status <> 'results_applied'");
    expect(expression).toContain('THEN response.status_v1');
    expect(expression).toContain('ELSE COALESCE(response.status_v2, response.status_v1)');
  });

  it('falls back from v3 to the effective manual status', () => {
    const expression = getEffectiveCodingStatusExpression('v3');

    expect(expression).toContain('COALESCE(response.status_v3');
    expect(expression).toContain('response.status_v2 = 8');
    expect(expression).toContain('FROM coding_job_unit effective_status_cju');
    expect(expression).toContain('response.status_v2, response.status_v1');
  });
});
