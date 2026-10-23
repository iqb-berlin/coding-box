export type KappaMeanInput = {
  kappa: number | null;
  validPairs: number;
};

export type KappaAgreementInput = {
  agreement: number;
  validPairs: number;
};

export type KappaCalculationLevel = 'code' | 'score';

export type KappaPairMetadata = {
  jobNames: string[];
  jobDefinitionIds: number[];
  trainingIds: number[];
  trainingLabels: string[];
};

export type KappaCoderPairStatistics = KappaMeanInput & KappaPairMetadata & {
  coder1Id: number;
  coder1Name: string;
  coder2Id: number;
  coder2Name: string;
  agreement: number;
  totalItems: number;
  interpretation: string;
};

export type KappaStatisticsResponse = {
  variables: Array<{
    unitName: string;
    variableId: string;
    meanKappa: number | null;
    meanAgreement: number | null;
    caseCount: number;
    doubleCodedCount: number;
    doubleCodedRate: number | null;
    validPairCount: number;
    coderPairCount: number;
    coderPairs: KappaCoderPairStatistics[];
  }>;
  workspaceSummary: {
    totalCodedResponses: number;
    totalDoubleCodedResponses: number;
    totalCoderPairs: number;
    averageKappa: number | null;
    meanAgreement: number | null;
    variablesIncluded: number;
    codersIncluded: number;
    weightingMethod: 'weighted' | 'unweighted';
    calculationLevel: KappaCalculationLevel;
  };
};

export type KappaStatisticsBuildResult = KappaStatisticsResponse & {
  sourceItems: KappaSourceItem[];
};

export type KappaStatisticsOptions = {
  weightedMean: boolean;
  excludeTrainings: boolean;
  unitName?: string;
  variableId?: string;
  jobDefinitionIds: number[];
  coderTrainingIds: number[];
  coderIds: number[];
  calculationLevel: KappaCalculationLevel;
};

export type KappaSourceItem = {
  responseId: number;
  unitName: string;
  variableId: string;
  variableAnchor: string;
  personLogin: string;
  personCode: string;
  personGroup: string;
  bookletName: string;
  coderResults: Array<{
    coderId: number;
    coderName: string;
    jobId: number;
    jobName: string;
    jobDefinitionId?: number | null;
    trainingId?: number | null;
    trainingLabel?: string | null;
    code: number | null;
    score: number | null;
    notes: string | null;
    codedAt: Date;
  }>;
};

export type KappaReplayContext = {
  serverUrl: string;
  authToken: string;
};
