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
  unitName: string;
  variableId: string;
  personLogin: string;
  personCode: string;
  bookletName: string;
  givenAnswer: string;
  coderResults: Array<{
    coderId: number;
    coderName: string;
    jobId: number;
    code: number | null;
    score: number | null;
    notes: string | null;
    codedAt: Date;
  }>;
}

export interface DoubleCodedReviewResponse {
  data: DoubleCodedReviewItem[];
  total: number;
  page: number;
  limit: number;
}

export interface DoubleCodedResolutionResponse {
  success: boolean;
  appliedCount: number;
  failedCount: number;
  skippedCount: number;
  message: string;
}
