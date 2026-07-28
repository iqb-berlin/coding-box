import {
  DoubleCodedResolutionDecisionDto,
  DoubleCodedResolutionResponseDto,
  DoubleCodedReviewItemDto,
  DoubleCodedReviewResponseDto
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

export type DoubleCodedReviewItem = DoubleCodedReviewItemDto;

export type DoubleCodedReviewResponse = DoubleCodedReviewResponseDto;

export type DoubleCodedResolutionDecision = DoubleCodedResolutionDecisionDto;

export type DoubleCodedResolutionResponse = DoubleCodedResolutionResponseDto;
