export type TrainingDiscussionApplySource = 'manual' | 'auto_agreement';

export type TrainingDiscussionExistingResultStrategy = 'skip' | 'overwrite';

export type TrainingDiscussionJobConflictStrategy = 'skip' | 'removeFromJobs';

export interface ApplyTrainingDiscussionResultsRequestDto {
  source: TrainingDiscussionApplySource;
  existingResultStrategy?: TrainingDiscussionExistingResultStrategy;
  jobConflictStrategy?: TrainingDiscussionJobConflictStrategy;
}

export interface TrainingDiscussionApplyPreviewDto {
  trainingId: number;
  source: TrainingDiscussionApplySource;
  totalTrainingResponses: number;
  sourceResultsCount: number;
  applicableResultsCount: number;
  missingResultsCount: number;
  missingScoreCount: number;
  existingFinalResultsCount: number;
  productiveJobConflictCount: number;
  removableProductiveJobUnitCount: number;
  blockingProductiveJobUnitCount: number;
  approvedJobDefinitionConflictCount: number;
  staleTrainingJobCount: number;
  affectedJobIds: number[];
  affectedJobDefinitionIds: number[];
  canApply: boolean;
  blockingReason?: string;
}

export interface ApplyTrainingDiscussionResultsResultDto extends TrainingDiscussionApplyPreviewDto {
  success: boolean;
  updatedResponsesCount: number;
  skippedExistingResultsCount: number;
  overwrittenExistingResultsCount: number;
  skippedJobConflictCount: number;
  skippedMissingScoreCount: number;
  removedJobUnitCount: number;
  messageKey: string;
  messageParams?: Record<string, unknown>;
}
