export type CodingVersion = 'v1' | 'v2' | 'v3';

const CODING_INCOMPLETE_STATUS = 8;

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
    return getEffectiveManualCodingStatusExpression(responseAlias);
  }

  if (version === 'v3') {
    const statusV3Expression = getNumericStatusExpression(responseAlias, 'v3');
    return `COALESCE(${statusV3Expression}, ${getEffectiveManualCodingStatusExpression(responseAlias)})`;
  }

  return `${responseAlias}.status_v1`;
}

function getEffectiveManualCodingStatusExpression(responseAlias: string): string {
  return `CASE
      WHEN ${getOpenManualCodingPlaceholderCondition(responseAlias)} THEN ${responseAlias}.status_v1
      ELSE COALESCE(${responseAlias}.status_v2, ${responseAlias}.status_v1)
    END`;
}

function getOpenManualCodingPlaceholderCondition(responseAlias: string): string {
  return `${responseAlias}.status_v2 = ${CODING_INCOMPLETE_STATUS}
        AND ${responseAlias}.code_v2 IS NULL
        AND ${responseAlias}.score_v2 IS NULL
        AND EXISTS (
          SELECT 1
          FROM coding_job_unit effective_status_cju
          INNER JOIN coding_job effective_status_cj
            ON effective_status_cj.id = effective_status_cju.coding_job_id
          WHERE effective_status_cju.response_id = ${responseAlias}.id
            AND effective_status_cj.status <> 'results_applied'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM coding_job_unit effective_status_applied_cju
          INNER JOIN coding_job effective_status_applied_cj
            ON effective_status_applied_cj.id = effective_status_applied_cju.coding_job_id
          WHERE effective_status_applied_cju.response_id = ${responseAlias}.id
            AND effective_status_applied_cj.status = 'results_applied'
        )`;
}
