export type DoubleCodedReviewDecisionState = 'draft' | 'applied' | 'superseded';

export interface DoubleCodedReviewCodeDto {
  code: number;
  label: string;
  score: number | null;
  source: 'schema' | 'general';
  commentRequired: boolean;
}

export interface DoubleCodedManagerDecisionDto {
  id: number | null;
  responseId: number;
  managerUserId: number | null;
  managerKey?: string | null;
  managerName: string;
  state: DoubleCodedReviewDecisionState;
  code: number | null;
  selectedCode: number | null;
  score: number | null;
  comment: string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
  finalizedAt: Date | string | null;
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
