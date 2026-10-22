import type { TrainingKappaStatisticsDto } from '../../../../../../../api-dto/coding/training-kappa-statistics.dto';

export type KappaStatistics = Omit<TrainingKappaStatisticsDto, 'workspaceSummary'> & {
  workspaceSummary: TrainingKappaStatisticsDto['workspaceSummary'] & {
    meanAgreement?: number | null;
  };
};

export interface VariableKappaSummary {
  key: string;
  unitName: string;
  variableId: string;
  meanKappa: number | null;
  meanBrennanPredigerKappa: number | null;
  fleissKappa: number | null;
  fleissCaseCount: number;
  fleissPossibleCaseCount: number;
  meanAgreement: number | null;
  caseCount: number;
  validPairCount: number;
}

export function withMeanAgreement(statistics: KappaStatistics, weighted: boolean): KappaStatistics {
  let totalAgreementWeighted = 0;
  let totalWeight = 0;
  let totalAgreementSum = 0;
  let pairCount = 0;

  statistics.variables.forEach(variable => {
    variable.coderPairs.forEach(pair => {
      if (pair.validPairs > 0) { // Only consider pairs with data
        totalAgreementWeighted += pair.agreement * pair.validPairs;
        totalWeight += pair.validPairs;
        totalAgreementSum += pair.agreement;
        pairCount += 1;
      }
    });
  });

  const agreementSum = weighted ? totalAgreementWeighted : totalAgreementSum;
  const weight = weighted ? totalWeight : pairCount;
  const meanAgreement = weight > 0 ? agreementSum / weight : null;
  return {
    ...statistics,
    workspaceSummary: { ...statistics.workspaceSummary, meanAgreement }
  };
}
