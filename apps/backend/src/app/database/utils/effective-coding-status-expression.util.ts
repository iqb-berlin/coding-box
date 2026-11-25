import { STATISTICS_IGNORED_STATUSES } from './response-status-converter';

export type CodingVersion = 'v1' | 'v2' | 'v3';
type ManualJobLookup = 'correlated' | 'grouped';

const CODING_INCOMPLETE_STATUS = 8;
const STATISTICS_IGNORED_STATUS_LIST = STATISTICS_IGNORED_STATUSES.join(', ');

export function getNumericStatusExpression(
  responseAlias: string,
  version: CodingVersion
): string {
  return `${responseAlias}.status_${version}`;
}

export function getEffectiveCodingStatusExpression(
  version: CodingVersion = 'v1',
  responseAlias = 'response',
  manualJobs: ManualJobLookup = 'correlated'
): string {
  if (version === 'v2') {
    return getEffectiveManualCodingStatusExpression(responseAlias, manualJobs);
  }

  if (version === 'v3') {
    const statusV3Expression = getNumericStatusExpression(responseAlias, 'v3');
    const manualStatusExpression = getEffectiveManualCodingStatusExpression(responseAlias, manualJobs);
    return `CASE
      WHEN ${responseAlias}.autocoder_invalidated_version IS NOT NULL THEN ${statusV3Expression}
      WHEN ${statusV3Expression} IN (${STATISTICS_IGNORED_STATUS_LIST}) THEN ${manualStatusExpression}
      ELSE COALESCE(${statusV3Expression}, ${manualStatusExpression})
    END`;
  }

  return `${responseAlias}.status_v1`;
}

function getEffectiveManualCodingStatusExpression(responseAlias: string, manualJobs: ManualJobLookup): string {
  return `CASE
      WHEN ${responseAlias}.status_v2 IN (${STATISTICS_IGNORED_STATUS_LIST}) THEN ${responseAlias}.status_v1
      WHEN ${getOpenManualCodingPlaceholderCondition(responseAlias, manualJobs)} THEN ${responseAlias}.status_v1
      ELSE COALESCE(${responseAlias}.status_v2, ${responseAlias}.status_v1)
    END`;
}

export function getOpenManualCodingPlaceholderCondition(
  responseAlias: string,
  manualJobs: ManualJobLookup = 'correlated'
): string {
  const unscored = `${responseAlias}.status_v2 = ${CODING_INCOMPLETE_STATUS}
        AND ${responseAlias}.code_v2 IS NULL
        AND ${responseAlias}.score_v2 IS NULL`;
  if (manualJobs === 'grouped') {
    // A response remains a placeholder if it has an open job and no applied job.
    // Build that set once when filtering large response tables.
    return `${unscored} AND ${responseAlias}.id IN (
      SELECT assignment.response_id
      FROM coding_job_unit assignment
      INNER JOIN coding_job job ON job.id = assignment.coding_job_id
      WHERE assignment.response_id IS NOT NULL
      GROUP BY assignment.response_id
      HAVING BOOL_OR(job.status <> 'results_applied')
        AND NOT BOOL_OR(job.status = 'results_applied')
    )`;
  }
  return `${unscored}
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
