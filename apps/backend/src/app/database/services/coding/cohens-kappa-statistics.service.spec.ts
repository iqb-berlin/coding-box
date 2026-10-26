import { CodingStatisticsService } from './coding-statistics.service';
import { CohensKappaStatisticsService } from './cohens-kappa-statistics.service';
import { DoubleCodingReviewQueryService } from './double-coding-review-query.service';
import { KappaStatisticsOptions } from './cohens-kappa.types';

type SourceItem = Awaited<ReturnType<DoubleCodingReviewQueryService['getCodedVariablesForKappa']>>[number];

const makeItem = (
  responseId: number,
  codes: Array<number | null>,
  unitName = 'UNIT',
  variableId = 'VAR',
  scores = codes
): SourceItem => ({
  responseId,
  unitName,
  variableId,
  variableAnchor: '',
  personLogin: `person-${responseId}`,
  personCode: 'secret-code',
  personGroup: 'GROUP',
  bookletName: 'BOOKLET',
  coderResults: codes.map((code, index) => ({
    coderId: index + 1,
    coderName: `Coder ${index + 1}`,
    jobId: index + 10,
    jobName: `Job ${index + 1}`,
    jobDefinitionId: index + 20,
    trainingId: null,
    trainingLabel: null,
    code,
    score: scores[index],
    notes: null,
    codedAt: new Date('2026-01-01T00:00:00.000Z')
  }))
});

const options: KappaStatisticsOptions = {
  weightedMean: true,
  excludeTrainings: true,
  jobDefinitionIds: [],
  coderTrainingIds: [],
  coderIds: [],
  calculationLevel: 'code'
};

describe('CohensKappaStatisticsService with the production calculator', () => {
  const query = { getCodedVariablesForKappa: jest.fn() };
  // Exercise the existing public calculation API without its unrelated DB/cache dependencies.
  const calculator = {
    calculateCohensKappa: CodingStatisticsService.prototype.calculateCohensKappa,
    roundKappaCalculationResult: CodingStatisticsService.prototype.roundKappaCalculationResult
  };
  let service: CohensKappaStatisticsService;

  beforeEach(() => {
    query.getCodedVariablesForKappa.mockReset();
    service = new CohensKappaStatisticsService(query as never, calculator as CodingStatisticsService);
  });

  it.each([
    {
      weightedMean: true, meanKappa: 0.7, meanAgreement: 0.833, averageKappa: 0.6, overallAgreement: 0.714
    },
    {
      weightedMean: false, meanKappa: 0.8, meanAgreement: 0.889, averageKappa: 0.6, overallAgreement: 0.667
    }
  ])('preserves counts, zero codes, constant perfect pairs and pair weighting ($weightedMean)', async expected => {
    query.getCodedVariablesForKappa.mockResolvedValue([
      makeItem(1, [0, 0, 0]),
      makeItem(2, [0, 1, null]),
      makeItem(3, [1, 1, null]),
      makeItem(4, [1, null, 1]),
      makeItem(5, [0]),
      makeItem(6, [0, 1], 'OTHER_UNIT')
    ]);

    const result = await service.buildStatistics(5, { ...options, weightedMean: expected.weightedMean });

    expect(result.variables[0]).toEqual({
      unitName: 'UNIT',
      variableId: 'VAR',
      meanKappa: expected.meanKappa,
      meanAgreement: expected.meanAgreement,
      caseCount: 5,
      doubleCodedCount: 4,
      doubleCodedRate: 0.8,
      validPairCount: 6,
      coderPairCount: 3,
      coderPairs: [
        expect.objectContaining({
          coder1Id: 1, coder2Id: 2, kappa: 0.4, agreement: 0.667, validPairs: 3
        }),
        expect.objectContaining({
          coder1Id: 1, coder2Id: 3, kappa: 1, agreement: 1, validPairs: 2
        }),
        expect.objectContaining({
          coder1Id: 2, coder2Id: 3, kappa: 1, agreement: 1, validPairs: 1
        })
      ]
    });
    expect(result.workspaceSummary).toEqual({
      totalCodedResponses: 6,
      totalDoubleCodedResponses: 5,
      totalCoderPairs: 4,
      averageKappa: expected.averageKappa,
      meanAgreement: expected.overallAgreement,
      variablesIncluded: 2,
      codersIncluded: 3,
      weightingMethod: expected.weightedMean ? 'weighted' : 'unweighted',
      calculationLevel: 'code'
    });
    expect(result.sourceItems).toHaveLength(6);
    expect(result.sourceItems[0].variableAnchor).toBe('VAR');
    expect(result.variables[0].coderPairs[0]).not.toHaveProperty('brennanPredigerKappa');
  });

  it.each([true, false])('averages unrounded pair results before rounding the workspace mean (weighted=%s)', async weightedMean => {
    const ratings = [
      { unitName: 'FIRST', values: [[0, 0], [0, 1], [1, 0], [1, 1], [1, 1], [1, 1]] },
      { unitName: 'SECOND', values: [[0, 0], [0, 0], [0, 1], [1, 1], [1, 1], [1, 1]] }
    ];
    query.getCodedVariablesForKappa.mockResolvedValue(ratings.flatMap((group, groupIndex) => (
      group.values.map((codes, index) => makeItem(groupIndex * 10 + index, codes, group.unitName))
    )));

    const result = await service.buildStatistics(5, { ...options, weightedMean });

    expect(result.variables.map(variable => variable.coderPairs[0].kappa)).toEqual([0.25, 0.667]);
    // Averaging the rounded public values would incorrectly produce 0.459.
    expect(result.workspaceSummary.averageKappa).toBe(0.458);
  });

  it('uses score availability including zero scores when codes are missing', async () => {
    query.getCodedVariablesForKappa.mockResolvedValue([
      makeItem(1, [null, null], 'UNIT', 'VAR', [0, 0]),
      makeItem(2, [null, null], 'UNIT', 'VAR', [0, 1]),
      makeItem(3, [null, null], 'UNIT', 'VAR', [1, 1]),
      makeItem(4, [1, null], 'UNIT', 'VAR', [1, null])
    ]);

    const result = await service.buildStatistics(5, { ...options, calculationLevel: 'score' });

    expect(query.getCodedVariablesForKappa).toHaveBeenCalledWith(5, true, [], [], [], 'score', { unitName: undefined, variableId: undefined });
    expect(result.variables[0]).toMatchObject({
      meanKappa: 0.4,
      meanAgreement: 0.667,
      caseCount: 4,
      doubleCodedCount: 3,
      doubleCodedRate: 0.75,
      validPairCount: 3,
      coderPairCount: 1
    });
    expect(result.workspaceSummary.calculationLevel).toBe('score');
  });

  it.each([
    { unitName: 'UNIT', variableId: 'VAR' },
    { unitName: 'UNIT', variableId: undefined },
    { unitName: undefined, variableId: 'VAR' },
    { unitName: '', variableId: '' },
    { unitName: 'unit', variableId: 'VAR' },
    { unitName: ' UNIT ', variableId: 'VAR' }
  ])('passes text filters unchanged to the query for $unitName / $variableId', async filters => {
    query.getCodedVariablesForKappa.mockResolvedValue([]);

    await service.buildStatistics(5, { ...options, ...filters });

    expect(query.getCodedVariablesForKappa).toHaveBeenCalledWith(5, true, [], [], [], 'code', filters);
  });

  it('keeps unit/variable pairs distinct when their display labels collide', async () => {
    query.getCodedVariablesForKappa.mockResolvedValue([
      makeItem(1, [0, 1], 'UNIT_VAR', 'ID'),
      makeItem(2, [0, 1], 'UNIT', 'VAR_ID')
    ]);

    const result = await service.buildStatistics(5, options);

    expect(result.variables.map(({ unitName, variableId }) => [unitName, variableId]))
      .toEqual([['UNIT_VAR', 'ID'], ['UNIT', 'VAR_ID']]);
    expect(result.workspaceSummary.variablesIncluded).toBe(2);
  });

  it('keeps single-coded cases in the denominator without inventing a coder pair', async () => {
    query.getCodedVariablesForKappa.mockResolvedValue([makeItem(1, [0])]);

    const result = await service.buildStatistics(5, options);

    expect(result.variables[0]).toEqual({
      unitName: 'UNIT',
      variableId: 'VAR',
      meanKappa: null,
      meanAgreement: null,
      caseCount: 1,
      doubleCodedCount: 0,
      doubleCodedRate: 0,
      validPairCount: 0,
      coderPairCount: 0,
      coderPairs: []
    });
    expect(result.workspaceSummary).toMatchObject({
      totalCodedResponses: 1,
      totalDoubleCodedResponses: 0,
      totalCoderPairs: 0,
      codersIncluded: 0,
      averageKappa: null,
      meanAgreement: null
    });
  });

  it('returns null means and zero counts for an empty scope', async () => {
    query.getCodedVariablesForKappa.mockResolvedValue([]);

    expect(await service.buildStatistics(5, options)).toEqual({
      variables: [],
      sourceItems: [],
      workspaceSummary: {
        totalCodedResponses: 0,
        totalDoubleCodedResponses: 0,
        totalCoderPairs: 0,
        averageKappa: null,
        meanAgreement: null,
        variablesIncluded: 0,
        codersIncluded: 0,
        weightingMethod: 'weighted',
        calculationLevel: 'code'
      }
    });
  });
});
