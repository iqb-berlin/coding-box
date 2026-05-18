export type CodingVersion = 'v1' | 'v2' | 'v3';

export function getNumericStatusExpression(
  responseAlias: string,
  version: CodingVersion
): string {
  return `${responseAlias}.status_${version}`;
}

export function getEffectiveCodingStatusExpression(
  version: CodingVersion = 'v1',
  responseAlias = 'response'
): string {
  if (version === 'v2') {
    return `COALESCE(${responseAlias}.status_v2, ${responseAlias}.status_v1)`;
  }

  if (version === 'v3') {
    const statusV3Expression = getNumericStatusExpression(responseAlias, 'v3');
    return `CASE
      WHEN ${responseAlias}.is_autocoder_generated = TRUE THEN ${statusV3Expression}
      ELSE COALESCE(${statusV3Expression}, ${responseAlias}.status_v2, ${responseAlias}.status_v1)
    END`;
  }

  return `${responseAlias}.status_v1`;
}
