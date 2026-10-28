import { JobVariableAvailability } from './job-variable-availability';
import { JobVariableCasePolicy } from './job-variable-case-policy';
import { Variable } from '../../models/coding-job.model';

describe('job variable availability', () => {
  const row: Variable = {
    unitName: 'UNIT',
    variableId: 'V',
    availableCases: 8,
    availableCasesWithDeriveError: 12,
    uniqueCasesAfterAggregation: 10,
    uniqueCasesAfterAggregationWithDeriveError: 15,
    deriveErrorResponseCount: 5
  };

  it('subtracts status-aware reservations once, excluding edited and already-created definitions', () => {
    const availability = new JobVariableAvailability();
    availability.snapshotBaseAvailability([row]);
    const definitions = [
      { id: 1, plannedVariableUsageByStatus: { ' UNIT :: V ': { regular: 3, total: 5, deriveError: 2 } } },
      { id: 2, plannedVariableUsage: { 'UNIT::V': 100 } },
      { id: 3, createdJobsCount: 1, plannedVariableUsage: { 'UNIT::V': 100 } },
      { id: 4, plannedVariableUsage: { 'UNIT::V': 1 } }
    ];
    const result = availability.reserve([row], definitions, 2);
    expect(result[0]).toMatchObject({ availableCases: 4, availableCasesWithDeriveError: 6 });
    expect(availability.reserve(result, definitions, 2)).toEqual(result);
    expect(row.availableCases).toBe(8);
  });

  it('ignores invalid reservations and clamps over-reservation at zero', () => {
    const availability = new JobVariableAvailability();
    expect(availability.reserve([row], [{ plannedVariableUsage: { 'UNIT::V': NaN } }])).toEqual([row]);
    expect(availability.reserve([row], [{ plannedVariableUsage: { 'UNIT::V': 99 } }])[0].availableCases).toBe(0);
  });

  it('distinguishes selectable derive-error cases from explicitly opted-in workload', () => {
    const enabled = new JobVariableCasePolicy(true);
    expect(enabled.getVariableSelectableAvailableCases(row)).toBe(12);
    expect(enabled.getVariableAvailableCases(row)).toBe(8);
    expect(enabled.getVariableAvailableCases({ ...row, includeDeriveError: true })).toBe(12);
    expect(enabled.getVariableEffectiveCases({ ...row, includeDeriveError: true })).toBe(15);
    expect(enabled.requiresExplicitDeriveErrorSelection({ ...row, availableCases: 0 })).toBe(true);
    expect(new JobVariableCasePolicy(false).getVariableSelectableAvailableCases(row)).toBe(8);
  });
});
