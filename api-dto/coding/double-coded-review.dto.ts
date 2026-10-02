export type DoubleCodedReviewDecisionState = 'draft' | 'applied' | 'superseded';

export interface DoubleCodedReviewCodeDto {
  code: number;
  label: string;
  score: number | null;
  source: 'schema' | 'general';
}

export interface DoubleCodedManagerDecisionDto {
  id: number | null;
  responseId: number;
  managerUserId: number | null;
  managerKey: string | null;
  managerName: string;
  state: DoubleCodedReviewDecisionState;
  effectiveCode: number | null;
  selectedCode: number | null;
  score: number | null;
  comment: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  finalizedAt: string | null;
  legacy: boolean;
}

export interface SaveDoubleCodedReviewDraftDto {
  sourceUnitId: number;
  code: number;
  score?: number | null;
  comment?: string | null;
}

export interface DoubleCodedResolutionDecisionDto {
  responseId: number;
  sourceUnitId: number;
  selectedJobId?: number | null;
  code?: number | null;
  score?: number | null;
  resolutionComment?: string;
}

export interface DoubleCodedResolutionResultDto {
  responseId: number;
  status: 'applied' | 'failed' | 'skipped';
  message?: string;
}

export interface DoubleCodedReviewCoderResultDto {
  coderId: number;
  coderName: string;
  jobId: number;
  jobName: string;
  jobDefinitionId: number | null;
  trainingId: number | null;
  trainingLabel: string | null;
  code: number | null;
  codingIssueOption: number | null;
  score: number | null;
  notes: string | null;
  supervisorComment: string | null;
  codedAt: string;
}

export interface DoubleCodedReviewItemDto {
  responseId: number;
  sourceUnitId: number;
  unitName: string;
  variableId: string;
  personLogin: string;
  personCode: string;
  personGroup: string;
  bookletName: string;
  givenAnswer: string;
  isResolved: boolean;
  appliedCode: number | null;
  appliedScore: number | null;
  appliedComment: string | null;
  availableCodes: DoubleCodedReviewCodeDto[];
  managerDrafts: DoubleCodedManagerDecisionDto[];
  managerHistory: DoubleCodedManagerDecisionDto[];
  coderResults: DoubleCodedReviewCoderResultDto[];
}

export interface DoubleCodedReviewResponseDto {
  data: DoubleCodedReviewItemDto[];
  total: number;
  page: number;
  limit: number;
}

export type DoubleCodedReviewSortBy = 'unitVariable' | 'personInfo';
export type DoubleCodedReviewSortDirection = 'asc' | 'desc';

export interface DoubleCodedReviewQuery {
  page?: number;
  limit?: number;
  onlyConflicts?: boolean;
  excludeTrainings?: boolean;
  search?: string;
  coderId?: number;
  statusFilter?: 'all' | 'done' | 'pending';
  resolvedFilter?: 'all' | 'resolved' | 'unresolved';
  agreementFilter?: 'all' | 'match' | 'differ';
  sortBy?: DoubleCodedReviewSortBy;
  sortDirection?: DoubleCodedReviewSortDirection;
  jobDefinitionIds?: number[];
  coderTrainingIds?: number[];
}

export interface ApplyDoubleCodedResolutionsRequestDto {
  decisions: DoubleCodedResolutionDecisionDto[];
}

export interface DoubleCodedResolutionResponseDto {
  success: boolean;
  appliedCount: number;
  failedCount: number;
  skippedCount: number;
  message: string;
  results: DoubleCodedResolutionResultDto[];
}
