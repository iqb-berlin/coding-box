export type KappaCalculationLevel = 'code' | 'score';
export type KappaWeightingMethod = 'weighted' | 'unweighted';

export interface TrainingKappaCoderPairDto {
  coder1Id: number;
  coder1Name: string;
  coder2Id: number;
  coder2Name: string;
  kappa: number | null;
  brennanPredigerKappa: number | null;
  agreement: number;
  totalItems: number;
  validPairs: number;
  interpretation: string;
}

export interface TrainingKappaVariableDto {
  unitName: string;
  variableId: string;
  meanKappa: number | null;
  meanBrennanPredigerKappa: number | null;
  fleissKappa: number | null;
  fleissCaseCount: number;
  meanAgreement: number | null;
  caseCount: number;
  validPairCount: number;
  coderPairCount: number;
  coderPairs: TrainingKappaCoderPairDto[];
}

export interface TrainingKappaStatisticsDto {
  variables: TrainingKappaVariableDto[];
  workspaceSummary: {
    totalDoubleCodedResponses: number;
    totalCoderPairs: number;
    averageKappa: number | null;
    averageBrennanPredigerKappa: number | null;
    variablesIncluded: number;
    codersIncluded: number;
    weightingMethod: KappaWeightingMethod;
    calculationLevel: KappaCalculationLevel;
  };
}
