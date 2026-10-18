import type { RequestBody } from '../request-contracts';
export type TrainingDiscussionApplySource = RequestBody<'TrainingDiscussionApplySource'>;

export type TrainingDiscussionExistingResultStrategy = NonNullable<RequestBody<'ApplyTrainingDiscussionResultsRequestDto'>['existingResultStrategy']>;

export type TrainingDiscussionJobConflictStrategy = NonNullable<RequestBody<'ApplyTrainingDiscussionResultsRequestDto'>['jobConflictStrategy']>;

export type ApplyTrainingDiscussionResultsRequestDto = RequestBody<'ApplyTrainingDiscussionResultsRequestDto'>;

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
