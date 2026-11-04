import { translateGerman } from '../../../../testing/german-translations';
import {
  VariableCombo, VariableFrequency, createVariableAnalysisRows, variableComboSummary, variableStatusSummary
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
  it('retains the selected coding run when projecting code frequencies', () => {
    const rows = createVariableAnalysisRows([
      { ...combo, analysisMode: 'codes', codingVersion: 'v3' }
    ], frequencies, translateGerman);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ analysisMode: 'codes', codingVersion: 'v3', value: 'A' })
    ]));
  });
  it('shows every status in both variable summaries and projected rows', () => {
    const statusCounts = [3, 5, 6, 7].map(status => ({ status, count: 1, percentage: 25 }));
    const summary = variableStatusSummary(statusCounts, translateGerman);
    expect(summary.split(', ')).toHaveLength(4);
    expect(summary).toContain('INVALID: 1 (25.0%)');
    const rows = createVariableAnalysisRows([{ ...combo, statusCounts }], frequencies, translateGerman);
    expect(rows[0].statusSummary).toBe(summary);
    expect(variableComboSummary({ ...combo, statusCounts }, frequencies, translateGerman).statusSummary).toBe(summary);
  });
});
