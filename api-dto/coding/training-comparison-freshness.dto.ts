export interface TrainingComparisonFreshnessDto {
  workspaceId: number;
  trainingId: number;
  version: string;
  jobCount: number;
  unitCount: number;
  responseCount: number;
  discussionResultCount: number;
  latestTrainingChange: string | null;
  latestJobChange: string | null;
  latestUnitChange: string | null;
  latestDiscussionChange: string | null;
}
