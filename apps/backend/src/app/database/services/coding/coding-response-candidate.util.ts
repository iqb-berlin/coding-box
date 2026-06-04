export const excludedCodingVariableFragments = [
  'image',
  'text',
  'audio',
  'frame',
  'video',
  '_0'
] as const;

export const excludedCodingVariablePattern = new RegExp(
  excludedCodingVariableFragments.join('|'),
  'i'
);

export function hasCodingResponseValue(value: string | null | undefined): boolean {
  return value != null && value.trim() !== '';
}

export function isCodingVariableIdCandidate(variableId: string | null | undefined): boolean {
  return !excludedCodingVariablePattern.test(variableId || '');
}

export function isCodingResponseCandidateByPattern(
  variableId: string | null | undefined,
  value: string | null | undefined
): boolean {
  return hasCodingResponseValue(value) && isCodingVariableIdCandidate(variableId);
}

export function getCodingVariableIdCandidateSql(alias: string): string {
  return excludedCodingVariableFragments
    .map(fragment => {
      const pattern = fragment.replace('_', '\\_');
      const escapeClause = fragment.includes('_') ? " ESCAPE '\\'" : '';
      return `${alias}.variableid NOT ILIKE '%${pattern}%'${escapeClause}`;
    })
    .join(' AND ');
}
