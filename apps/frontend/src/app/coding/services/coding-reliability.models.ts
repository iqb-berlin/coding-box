export interface CohensKappaCoderPair {
  coder1Id: number;
  coder1Name: string;
  coder2Id: number;
  coder2Name: string;
  kappa: number | null;
  agreement: number;
  totalItems: number;
  validPairs: number;
  interpretation: string;
}

export interface CohensKappaVariableSummary {
  unitName: string;
  variableId: string;
  meanKappa: number | null;
  meanAgreement: number | null;
  caseCount: number;
  doubleCodedCount: number;
  doubleCodedRate: number | null;
  validPairCount: number;
  coderPairCount: number;
  coderPairs: CohensKappaCoderPair[];
}

export interface CohensKappaStatisticsResponse {
  variables: CohensKappaVariableSummary[];
  workspaceSummary: {
    totalCodedResponses: number;
    totalDoubleCodedResponses: number;
    totalCoderPairs: number;
    averageKappa: number | null;
    meanAgreement: number | null;
    variablesIncluded: number;
    codersIncluded: number;
    weightingMethod: 'weighted' | 'unweighted';
    calculationLevel?: CohensKappaCalculationLevel;
  };
}

export type CohensKappaCalculationLevel = 'code' | 'score';

export interface CohensKappaScope {
  jobDefinitionIds?: number[];
  coderTrainingIds?: number[];
  coderIds?: number[];
}

export interface WorkspaceCohensKappaSummary {
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
    weightingMethod: 'weighted' | 'unweighted';
  };
}
