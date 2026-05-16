export type CodingJobFreshnessStatus =
  | 'current'
  | 'stale_source'
  | 'review_required';

export interface CodingJobFreshnessImpactDto {
  codingJobId: number;
  freshnessStatus: CodingJobFreshnessStatus;
  freshnessReason: string | null;
  freshnessUpdatedAt: string | null;
  affectedUnits: number;
  affectedResponses: number;
  totalResponses: number;
  codedResponses: number;
  openResponses: number;
}

export interface JobDefinitionRefreshPreviewDto {
  jobDefinitionId: number;
  existingJobsCount: number;
  staleJobsCount: number;
  existingCases: number;
  plannedCases: number;
  retainedCases: number;
  addedCases: number;
  removedCases: number;
  addedCodingTasks: number;
  removedCodingTasks: number;
  canApply: boolean;
  blockingReason?: string;
}

export interface JobDefinitionRefreshApplyResultDto {
  success: boolean;
  message: string;
  preview: JobDefinitionRefreshPreviewDto;
  jobsCreated: number;
}
