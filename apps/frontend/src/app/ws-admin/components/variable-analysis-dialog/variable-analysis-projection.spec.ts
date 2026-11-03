import { translateGerman } from '../../../../testing/german-translations';
import {
  VariableCombo, VariableFrequency, createVariableAnalysisRows, variableComboSummary
} from './variable-analysis-projection';

describe('variable analysis projection', () => {
  const combo: VariableCombo = {
    unitId: 1, unitName: 'U', variableId: 'v', totalCount: 10, validCount: 4, distinctValueCount: 5
  };
  const frequencies: Record<string, VariableFrequency[]> = {
    '1:v': [
      {
        variableid: 'v', value: 'A', count: 3, percentage: 30
      },
      {
        variableid: 'v', value: '', count: 6, percentage: 60
      },
      {
        variableid: 'v', value: 'schema', count: 0, percentage: 0, isSchemaOnly: true
      }
    ]
  };
  it('uses valid observations as denominator and excludes schema supplements from observed counts', () => {
    const rows = createVariableAnalysisRows([combo], frequencies, translateGerman);
    expect(rows[0]).toMatchObject({
      percentageTotal: 30, percentageValid: 75, hiddenValueCount: 3, totalCount: 10, validCount: 4
    });
    expect(rows[1].percentageValid).toBe(0);
    expect(rows[2].isSchemaOnly).toBe(true);
    expect(variableComboSummary(combo, frequencies, translateGerman)).toMatchObject({ emptyCount: 6, emptyPercentage: 60 });
  });
  it('retains an empty variable as a schema-only row with no valid denominator', () => {
    const rows = createVariableAnalysisRows([{ unitId: 1, unitName: 'U', variableId: 'empty' }], {}, translateGerman);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      isSchemaOnly: true, count: 0, percentageValid: null, hiddenValueCount: 0
    });
  });
});
