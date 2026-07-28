import {
  excludedCodingVariableFragments,
  getCodingResponseValueCandidateSql,
  getCodingVariableIdCandidateSql,
  isCodingResponseCandidateByPattern,
  isCodingVariableIdCandidate
} from './coding-response-candidate.util';

describe('coding response candidate utils', () => {
  it('uses one fragment list for in-memory and SQL helper-variable filters', () => {
    const sql = getCodingVariableIdCandidateSql('response');

    excludedCodingVariableFragments.forEach(fragment => {
      const variableId = fragment === '_0' ? 'variable_0' : `prefix_${fragment}_suffix`;

      expect(isCodingVariableIdCandidate(variableId)).toBe(false);
      expect(sql).toContain(
        `response.variableid NOT ILIKE '%${fragment.replace('_', '\\_')}%'`
      );
    });

    expect(sql).toContain("response.variableid NOT ILIKE '%\\_0%' ESCAPE '\\'");
  });

  it('keeps the stricter response-candidate helper value-aware', () => {
    expect(isCodingResponseCandidateByPattern('var1', 'answer')).toBe(true);
    expect(isCodingResponseCandidateByPattern('var1', '   ')).toBe(false);
    expect(isCodingResponseCandidateByPattern('var1', '\t\n')).toBe(false);
    expect(isCodingResponseCandidateByPattern('image_1', 'answer')).toBe(false);
  });

  it('uses a SQL value filter that rejects every whitespace-only value', () => {
    expect(getCodingResponseValueCandidateSql('response')).toBe(
      "response.value IS NOT NULL AND response.value ~ '[^[:space:]]'"
    );
  });
});
