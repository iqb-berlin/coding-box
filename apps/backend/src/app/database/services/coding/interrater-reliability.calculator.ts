export interface RawKappaResult {
  coder1Id: number;
  coder1Name: string;
  coder2Id: number;
  coder2Name: string;
  unitName?: string;
  variableId?: string;
  kappa: number | null;
  brennanPredigerKappa: number | null;
  agreement: number;
  totalItems: number;
  validPairs: number;
  interpretation: string;
}

export interface KappaVariableSummary {
  meanKappa: number | null;
  meanBrennanPredigerKappa: number | null;
  meanAgreement: number | null;
  validPairCount: number;
  coderPairCount: number;
}

export interface FleissKappaResult {
  fleissKappa: number | null;
  completeCaseCount: number;
  raterCount: number;
}

export type KappaSummaryInput = Pick<
RawKappaResult,
'kappa' | 'brennanPredigerKappa' | 'agreement' | 'validPairs'
>;

export type KappaPairInput = {
  coder1Id: number;
  coder1Name: string;
  coder2Id: number;
  coder2Name: string;
  unitName?: string;
  variableId?: string;
  codes: Array<{ code1: number | null; code2: number | null }>;
  scores?: Array<{ score1: number | null; score2: number | null }>;
};

const meanMetric = <T>(
  values: T[],
  selector: (value: T) => number | null | undefined,
  weightSelector: (value: T) => number,
  weighted: boolean
): number | null => {
  let sum = 0;
  let denominator = 0;
  values.forEach(value => {
    const metric = selector(value);
    if (metric === null || metric === undefined || !Number.isFinite(metric)) return;
    const weight = weighted ? weightSelector(value) : 1;
    if (weight <= 0) return;
    sum += metric * weight;
    denominator += weight;
  });
  return denominator > 0 ? sum / denominator : null;
};

const interpretKappa = (kappa: number): string => {
  if (kappa < 0) return 'kappa.poor';
  if (kappa < 0.2) return 'kappa.slight';
  if (kappa < 0.4) return 'kappa.fair';
  if (kappa < 0.6) return 'kappa.moderate';
  if (kappa < 0.81) return 'kappa.substantial';
  if (kappa <= 0.95) return 'kappa.good';
  return 'kappa.almost_perfect';
};

export const calculateMetricMean = meanMetric;

export class InterraterReliabilityCalculator {
  static calculatePairwise(
    coderPairs: KappaPairInput[],
    level: 'code' | 'score' = 'code'
  ): RawKappaResult[] {
    return coderPairs.map(pair => {
      const data = level === 'score' && pair.scores ?
        pair.scores.map(value => ({ code1: value.score1, code2: value.score2 })) : pair.codes;
      const valid = data.filter(value => value.code1 !== null && value.code2 !== null);
      if (valid.length === 0) {
        return {
          coder1Id: pair.coder1Id,
          coder1Name: pair.coder1Name,
          coder2Id: pair.coder2Id,
          coder2Name: pair.coder2Name,
          unitName: pair.unitName,
          variableId: pair.variableId,
          kappa: null,
          brennanPredigerKappa: null,
          agreement: 0,
          totalItems: data.length,
          validPairs: 0,
          interpretation: 'No valid coding pairs'
        };
      }

      const categories = [...new Set(valid.flatMap(value => [value.code1!, value.code2!]))]
        .sort((a, b) => a - b);
      const rowCounts = new Map<number, number>();
      const columnCounts = new Map<number, number>();
      let agreements = 0;
      valid.forEach(value => {
        rowCounts.set(value.code1!, (rowCounts.get(value.code1!) ?? 0) + 1);
        columnCounts.set(value.code2!, (columnCounts.get(value.code2!) ?? 0) + 1);
        if (value.code1 === value.code2) agreements += 1;
      });
      const agreement = agreements / valid.length;
      const expectedAgreement = categories.reduce((sum, category) => sum +
        ((rowCounts.get(category) ?? 0) * (columnCounts.get(category) ?? 0)) /
        (valid.length ** 2), 0);
      let kappa = agreement === 1 || expectedAgreement === 1 ? 1 :
        (agreement - expectedAgreement) / (1 - expectedAgreement);
      if (!Number.isFinite(kappa)) kappa = 0;
      const chanceAgreement = 1 / categories.length;
      const brennanPredigerKappa = agreement === 1 ? 1 :
        (agreement - chanceAgreement) / (1 - chanceAgreement);
      const interpretation = interpretKappa(kappa);
      return {
        coder1Id: pair.coder1Id,
        coder1Name: pair.coder1Name,
        coder2Id: pair.coder2Id,
        coder2Name: pair.coder2Name,
        unitName: pair.unitName,
        variableId: pair.variableId,
        kappa,
        brennanPredigerKappa,
        agreement,
        totalItems: data.length,
        validPairs: valid.length,
        interpretation
      };
    });
  }

  static toPublicResult(result: RawKappaResult): RawKappaResult {
    const round = (value: number): number => Math.round(value * 1000) / 1000;
    return {
      ...result,
      kappa: result.kappa === null ? null : round(result.kappa),
      brennanPredigerKappa: result.brennanPredigerKappa === null ? null :
        round(result.brennanPredigerKappa),
      agreement: round(result.agreement)
    };
  }

  static calculateFleiss(ratings: Array<Array<number | null>>): FleissKappaResult {
    const raterCount = ratings[0]?.length ?? 0;
    if (raterCount < 2 || ratings.some(row => row.length !== raterCount)) {
      return { fleissKappa: null, completeCaseCount: 0, raterCount };
    }
    const complete = ratings.filter((row): row is number[] => row.every(value => value !== null));
    if (complete.length === 0) return { fleissKappa: null, completeCaseCount: 0, raterCount };
    const totals = new Map<number, number>();
    let observedSum = 0;
    complete.forEach(row => {
      const counts = new Map<number, number>();
      row.forEach(value => { counts.set(value, (counts.get(value) ?? 0) + 1); totals.set(value, (totals.get(value) ?? 0) + 1); });
      observedSum += ([...counts.values()].reduce((sum, count) => sum + count ** 2, 0) - raterCount) /
        (raterCount * (raterCount - 1));
    });
    const expected = [...totals.values()].reduce((sum, count) => sum + (count / (complete.length * raterCount)) ** 2, 0);
    const value = expected === 1 ? null : (observedSum / complete.length - expected) / (1 - expected);
    return {
      fleissKappa: value === null || !Number.isFinite(value) ? null :
        Math.round(value * 1000) / 1000,
      completeCaseCount: complete.length,
      raterCount
    };
  }

  static summarize(results: KappaSummaryInput[], weighted = false): KappaVariableSummary {
    const valid = results.filter(result => result.validPairs > 0);
    return {
      meanKappa: meanMetric(valid, result => result.kappa, result => result.validPairs, weighted),
      meanBrennanPredigerKappa: meanMetric(valid, result => result.brennanPredigerKappa, result => result.validPairs, weighted),
      meanAgreement: meanMetric(valid, result => result.agreement, result => result.validPairs, weighted),
      validPairCount: valid.reduce((sum, result) => sum + result.validPairs, 0),
      coderPairCount: valid.length
    };
  }
}
