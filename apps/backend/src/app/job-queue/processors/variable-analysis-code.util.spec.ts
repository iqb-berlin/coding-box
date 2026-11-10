import { formatAssignedCodeKey } from './variable-analysis-code.util';
import { getVariableAnalysisMetadata } from './variable-analysis-metadata.util';

describe('Assigned-code analysis metadata', () => {
  it('separates regular zero from status-based special codes and uses their persisted zero scores', () => {
    const metadata = getVariableAnalysisMetadata({
      id: 'VAR',
      alias: 'VAR',
      type: 'string',
      hasCodingScheme: true,
      codes: [
        { id: 0, label: 'Richtig', score: 1 },
        { id: 'INTENDED_INCOMPLETE', label: 'Unvollständig', score: 99 },
        { id: 'INVALID', label: 'Ungültig', score: 99 }
      ]
    }, { analysisMode: 'codes' });

    expect(metadata.categoryDefinitions).toEqual([
      {
        value: '5:0', label: 'Richtig', score: 1, order: 0
      },
      {
        value: '12:0', label: 'Unvollständig', score: 0, order: 1
      },
      {
        value: '7:0', label: 'Ungültig', score: 0, order: 2
      }
    ]);
  });

  it.each([0, 4])('retains a numeric intended-incomplete fallback %i with its own metadata', id => {
    const metadata = getVariableAnalysisMetadata({
      id: 'VAR',
      alias: 'VAR',
      type: 'string',
      hasCodingScheme: true,
      codes: [{
        id, label: 'Restkategorie', score: 2, type: 'INTENDED_INCOMPLETE'
      }]
    }, { analysisMode: 'codes' });
    expect(metadata.categoryDefinitions).toEqual([
      {
        value: `12:${id}`, label: 'Restkategorie', score: 2, order: 0
      }
    ]);
  });

  it('leaves metadata unset when two schema definitions share the same persisted code and status', () => {
    const metadata = getVariableAnalysisMetadata({
      id: 'VAR',
      alias: 'VAR',
      type: 'string',
      hasCodingScheme: true,
      codes: [
        {
          id: 0, label: 'Restkategorie', score: 2, type: 'INTENDED_INCOMPLETE'
        },
        { id: 'INTENDED_INCOMPLETE', label: 'Sonderfall' }
      ]
    }, { analysisMode: 'codes' });
    expect(metadata.categoryDefinitions).toEqual([
      { value: '12:0', order: 0 }
    ]);
  });
});

describe('Assigned-code display boundary', () => {
  it.each([
    ['', ''], ['5:0', '0'], ['5:4', '4'],
    ['12:0', '0 (INTENDED_INCOMPLETE)'], ['12:4', '4 (INTENDED_INCOMPLETE)'],
    ['7:0', '0 (INVALID)'], ['0:3', '3 (0)'], ['null:3', '3 (UNSET)'],
    ['6:3', '3 (6)'], ['99:3', '3 (99)']
  ])('formats %s as %s without changing its identity', (key, expected) => {
    expect(formatAssignedCodeKey(key)).toBe(expected);
  });
});
