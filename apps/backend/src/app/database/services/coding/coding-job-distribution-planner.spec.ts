import { CodingJobDistributionPlanner } from './coding-job-distribution-planner';

type TestCoder = {
  id: number;
  weight: number;
  tieBreaker: number;
};

describe('CodingJobDistributionPlanner', () => {
  const planner = new CodingJobDistributionPlanner();

  function makeCoders(count: number): TestCoder[] {
    return Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      weight: 1,
      tieBreaker: planner.stableHash(`coder:${index + 1}`)
    }));
  }

  function expectBalancedQuotaPlan(
    coderCount: number,
    doubleCodingCount: number
  ): void {
    const coders = makeCoders(coderCount);
    const combinations = planner.getCoderCombinations(coders, 2);
    const plan = planner.planBalancedDoubleCodingPairQuotas(
      coders,
      combinations,
      doubleCodingCount,
      'quota-invariants',
      `item:${coderCount}:${doubleCodingCount}`,
      new Map(coders.map(coder => [coder.id, 0])),
      new Map()
    );
    const quotas = [...plan.pairQuotas.values()];
    const coderDegrees = new Map(coders.map(coder => [coder.id, 0]));

    combinations.forEach(combination => {
      const quota = plan.pairQuotas.get(planner.getPairKey(combination)) || 0;
      combination.forEach(coder => {
        coderDegrees.set(coder.id, (coderDegrees.get(coder.id) || 0) + quota);
      });
    });

    expect(quotas.reduce((sum, quota) => sum + quota, 0)).toBe(
      doubleCodingCount
    );
    expect(Math.max(...quotas) - Math.min(...quotas)).toBeLessThanOrEqual(1);
    expect(
      Math.max(...coderDegrees.values()) - Math.min(...coderDegrees.values())
    ).toBeLessThanOrEqual(1);
  }

  it('balances unavoidable item remainders across global coder and pair loads', () => {
    const coders = makeCoders(3);
    const combinations = planner.getCoderCombinations(coders, 2);
    let plannedCoderAssignments = new Map(coders.map(coder => [coder.id, 0]));
    let plannedPairCounts = new Map<string, number>();

    ['item:1', 'item:2', 'item:3'].forEach(itemKey => {
      const plan = planner.planBalancedDoubleCodingPairQuotas(
        coders,
        combinations,
        1,
        'small-items',
        itemKey,
        plannedCoderAssignments,
        plannedPairCounts
      );
      plannedCoderAssignments = plan.plannedCoderAssignments;
      plannedPairCounts = plan.plannedPairCounts;
    });

    expect(Object.fromEntries(plannedCoderAssignments)).toEqual({
      1: 2,
      2: 2,
      3: 2
    });
    expect(Object.fromEntries(plannedPairCounts)).toEqual({
      '1-2': 1,
      '1-3': 1,
      '2-3': 1
    });
  });

  it('keeps pair quotas and coder degrees balanced across small plans', () => {
    for (let coderCount = 2; coderCount <= 12; coderCount += 1) {
      const pairCount = (coderCount * (coderCount - 1)) / 2;
      for (
        let doubleCodingCount = 1;
        doubleCodingCount <= pairCount;
        doubleCodingCount += 1
      ) {
        expectBalancedQuotaPlan(coderCount, doubleCodingCount);
      }
    }
  });

  it.each([1, 24, 25, 49, 612, 1224, 1225])(
    'keeps pair quotas and coder degrees balanced for 50 coders and %i cases',
    doubleCodingCount => {
      expectBalancedQuotaPlan(50, doubleCodingCount);
    }
  );
});
