import { CodingWorkload, CodingWorkloadInput } from './coding-workload';

describe('CodingWorkload', () => {
  function input(overrides: Partial<CodingWorkloadInput> = {}): CodingWorkloadInput {
    return {
      mode: 'definition',
      variables: [{
        unitName: 'A', variableId: 'x', effectiveCases: 20, availableCases: 10
      }],
      bundles: [],
      caseOrderingMode: 'continuous',
      distributionSeed: 'stable',
      maxCodingCases: null,
      doubleCodingMode: 'absolute',
      doubleCodingAbsolute: 2,
      doubleCodingPercentage: 0,
      durationSeconds: 30,
      coderCapacityPercent: [100, 200],
      preview: null,
      ...overrides
    };
  }
  it('separates unavailable cases, limit reduction, duplicated tasks and coder capacity', () => {
    const workload = new CodingWorkload(input({ maxCodingCases: 6 }));
    expect(workload.summarize(() => workload.estimateVariableCaseCounts())).toEqual(expect.objectContaining({
      selectedCases: 20, distributableCases: 10, unavailableCases: 10, limitReduction: 4, totalCases: 6, doubleCodedCases: 2, totalCodingTasks: 8, totalTimeSeconds: 240, timePerCoderSeconds: 160, formattedTimePerCoder: '2:40'
    }));
  });
  it('applies the global limit round-robin across bundles and individual variables without mutating input', () => {
    const value = input({
      maxCodingCases: 7,
      bundles: [{
        id: 1,
        caseOrderingMode: 'alternating',
        variables: [{
          unitName: 'B', variableId: 'x', effectiveCases: 10, availableCases: 10
        }, {
          unitName: 'C', variableId: 'x', effectiveCases: 10, availableCases: 10
        }]
      }]
    });
    const before = JSON.stringify(value);
    const workload = new CodingWorkload(value);
    const counts = workload.estimateVariableCaseCounts();
    expect(counts.slice().sort()).toEqual([2, 2, 3]);
    expect(workload.estimateVariableCaseCounts()).toEqual(counts);
    expect(JSON.stringify(value)).toBe(before);
  });
  it('uses normalized variable identities when bundle and individual counts meet', () => {
    const value = input({
      variables: [{
        unitName: ' A ', variableId: 'X', effectiveCases: 2, availableCases: 2
      }, {
        unitName: 'a', variableId: 'x', effectiveCases: 3, availableCases: 3
      }]
    });
    expect(new CodingWorkload(value).estimateVariableCaseCounts()).toEqual([5]);
  });
  it('uses per-variable percentage rounding and ignores the definition limit in job mode', () => {
    const workload = new CodingWorkload(input({
      mode: 'job', maxCodingCases: 1, doubleCodingMode: 'percentage', doubleCodingPercentage: 25
    }));
    expect(workload.summarize(() => workload.estimateVariableCaseCounts())).toEqual(expect.objectContaining({ totalCases: 10, doubleCodedCases: 3, limitReduction: 0 }));
  });
  it('prefers the authoritative preview and its slowest coder over estimates', () => {
    const workload = new CodingWorkload(input({
      preview: {
        totalCases: 4, doubleCodedCases: 1, totalCodingTasks: 5, tasksPerCoder: { 1: 1, 2: 4 }
      }
    }));
    expect(workload.summarize(() => workload.estimateVariableCaseCounts())).toEqual(expect.objectContaining({
      totalCases: 4, doubleCodedCases: 1, totalCodingTasks: 5, timePerCoderSeconds: 120
    }));
  });
});
