import { Variable } from '../../models/coding-job.model';
import { JobVariableCasePolicy } from './job-variable-case-policy';
import { filterJobDefinitionVariables } from './job-variable-filter';

describe('job definition variable filter', () => {
  const variables: Variable[] = [
    {
      unitName: 'Unit', variableId: 'full', uniqueCasesAfterAggregation: 4, availableCases: 4
    },
    {
      unitName: 'Unit', variableId: 'partial', uniqueCasesAfterAggregation: 4, availableCases: 2
    },
    {
      unitName: 'Unit', variableId: 'none', uniqueCasesAfterAggregation: 0, availableCases: 0
    },
    {
      unitName: 'Unit', variableId: 'derived', uniqueCasesAfterAggregation: 0, availableCases: 0, deriveErrorResponseCount: 2, availableCasesWithDeriveError: 2, uniqueCasesAfterAggregationWithDeriveError: 2
    }
  ];
  const select = (availability: 'full' | 'partial' | 'none', includeDeriveError = false) => filterJobDefinitionVariables(
    variables, { unitName: 'UNIT', variableId: '', availability }, new JobVariableCasePolicy(includeDeriveError)
  ).map(variable => variable.variableId);

  it('uses effective case counts and treats empty variables as unavailable', () => {
    expect(select('full')).toEqual(['full']);
    expect(select('partial')).toEqual(['partial']);
    expect(select('none')).toEqual(['none', 'derived']);
  });
  it('includes selectable derive-error cases only when the policy allows them', () => {
    expect(select('full', true)).toEqual(['full', 'derived']);
    expect(filterJobDefinitionVariables(variables, { unitName: 'unit', variableId: 'PART', availability: 'all' }, new JobVariableCasePolicy(false))).toEqual([variables[1]]);
  });
});
