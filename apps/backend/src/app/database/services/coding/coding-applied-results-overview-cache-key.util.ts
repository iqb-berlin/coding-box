export const getCodingAppliedResultsOverviewCacheKey = (
  workspaceId: number,
  testResultsRevision: number,
  codingRevision: number
): string => `coding_applied_results_overview:${workspaceId}:r${testResultsRevision}:c${codingRevision}`;

export const getCodingAppliedResultsOverviewCachePattern = (
  workspaceId: number
): string => `coding_applied_results_overview:${workspaceId}:*`;

export const getCodingAppliedResultsOverviewVersionKey = (
  workspaceId: number
): string => `coding_applied_results_overview:version:${workspaceId}`;
