import {
  DoubleCodedManagerDecisionDto,
  DoubleCodedResolutionDecisionDto,
  DoubleCodedResolutionResultDto,
  DoubleCodedReviewCodeDto
} from '../../../../../../../api-dto/coding/double-coded-review.dto';

export interface CohensKappaSummary {
  coderPairs: Array<{
    coder1Id: number;
    coder1Name: string;
    coder2Id: number;
    coder2Name: string;
    kappa: number | null;
    agreement: number;
    totalSharedResponses: number;
    validPairs: number;
    interpretation: string;
  }>;
  workspaceSummary: {
    totalDoubleCodedResponses: number;
    totalCoderPairs: number;
    averageKappa: number | null;
    variablesIncluded: number;
    codersIncluded: number;
  };
}

export interface DoubleCodedReviewItem {
  responseId: number;
  sourceUnitId: number;
  unitName: string;
  variableId: string;
  personLogin: string;
  personCode: string;
  bookletName: string;
  givenAnswer: string;
  isResolved: boolean;
  appliedCode: number | null;
  appliedScore: number | null;
  appliedComment: string | null;
  availableCodes: DoubleCodedReviewCodeDto[];
  managerDrafts: DoubleCodedManagerDecisionDto[];
  managerHistory: DoubleCodedManagerDecisionDto[];
  coderResults: Array<{
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
    codedAt: Date;
  }>;
}

export interface DoubleCodedReviewResponse {
  data: DoubleCodedReviewItem[];
  total: number;
  page: number;
  limit: number;
}

export type DoubleCodedResolutionDecision = DoubleCodedResolutionDecisionDto;

export interface DoubleCodedResolutionResponse {
  success: boolean;
  appliedCount: number;
  failedCount: number;
  skippedCount: number;
  message: string;
  results: DoubleCodedResolutionResultDto[];
}
