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

export interface JobDefinitionRefreshCoderTaskDeltaDto {
  coderId: number;
  existingCodingTasks: number;
  plannedCodingTasks: number;
  retainedCodingTasks: number;
  addedCodingTasks: number;
  removedCodingTasks: number;
}

export interface JobDefinitionRefreshItemDeltaDto {
  itemKey: string;
  itemLabel: string;
  existingCases: number;
  plannedCases: number;
  retainedCases: number;
  addedCases: number;
  removedCases: number;
  existingCodingTasks: number;
  plannedCodingTasks: number;
  retainedCodingTasks: number;
  addedCodingTasks: number;
  removedCodingTasks: number;
  codingTasksByCoderId: Record<string, JobDefinitionRefreshCoderTaskDeltaDto>;
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
  itemDeltas?: JobDefinitionRefreshItemDeltaDto[];
  codingTasksByCoderId?: Record<string, JobDefinitionRefreshCoderTaskDeltaDto>;
  canApply: boolean;
  blockingReason?: string;
}

export interface JobDefinitionRefreshApplyResultDto {
  success: boolean;
  message: string;
  preview: JobDefinitionRefreshPreviewDto;
  jobsCreated: number;
}
