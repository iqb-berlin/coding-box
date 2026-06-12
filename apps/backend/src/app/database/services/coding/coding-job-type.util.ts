import { SelectQueryBuilder } from 'typeorm';

export const CODING_JOB_TYPE_CODING_ISSUE_REVIEW = 'coding_issue_review';

export function isCodingIssueReviewJobType(
  jobType?: string | null
): boolean {
  return jobType === CODING_JOB_TYPE_CODING_ISSUE_REVIEW;
}

export function applyNonCodingIssueReviewJobFilter<T>(
  queryBuilder: SelectQueryBuilder<T>,
  jobAlias: string,
  parameterName: string
): void {
  queryBuilder.andWhere(
    `(${jobAlias}.job_type IS NULL OR ${jobAlias}.job_type != :${parameterName})`,
    { [parameterName]: CODING_JOB_TYPE_CODING_ISSUE_REVIEW }
  );
}

export function getNonCodingIssueReviewJobSqlCondition(jobAlias: string): string {
  return `(${jobAlias}.job_type IS NULL OR ${jobAlias}.job_type != '${CODING_JOB_TYPE_CODING_ISSUE_REVIEW}')`;
}
