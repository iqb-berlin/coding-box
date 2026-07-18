import {
  addCorrelationPair,
  calculateCorrelation,
  createCorrelationAccumulator
} from './psychometric-statistics.util';

describe('psychometric statistics', () => {
  it('calculates Pearson correlations from running sums', () => {
    const accumulator = createCorrelationAccumulator();
    addCorrelationPair(accumulator, 1, 2);
    addCorrelationPair(accumulator, 2, 4);
    addCorrelationPair(accumulator, 3, 6);

    expect(calculateCorrelation(accumulator)).toEqual({
      correlation: 1,
      status: 'OK'
    });
  });

  it('calculates point-biserial correlations as Pearson correlations of dummies', () => {
    const accumulator = createCorrelationAccumulator();
    addCorrelationPair(accumulator, 0, 1);
    addCorrelationPair(accumulator, 0, 2);
    addCorrelationPair(accumulator, 1, 4);
    addCorrelationPair(accumulator, 1, 5);

    const result = calculateCorrelation(accumulator);
    expect(result.status).toBe('OK');
    expect(result.correlation).toBeCloseTo(0.948683298, 8);
    expect(accumulator.positiveCount).toBe(2);
  });

  it('returns machine-readable statuses for unusable samples', () => {
    const insufficient = createCorrelationAccumulator();
    addCorrelationPair(insufficient, 1, 2);
    expect(calculateCorrelation(insufficient).status).toBe(
      'INSUFFICIENT_CASES'
    );

    const constantItem = createCorrelationAccumulator();
    addCorrelationPair(constantItem, 1, 2);
    addCorrelationPair(constantItem, 1, 3);
    expect(calculateCorrelation(constantItem).status).toBe('CONSTANT_ITEM');

    const constantDomain = createCorrelationAccumulator();
    addCorrelationPair(constantDomain, 0, 2);
    addCorrelationPair(constantDomain, 1, 2);
    expect(calculateCorrelation(constantDomain).status).toBe('CONSTANT_DOMAIN');
  });
});
