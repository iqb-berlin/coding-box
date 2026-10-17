import { CodingSchemeFactory } from '@iqb/responses';
import { VariableCodingData } from '@iqbspecs/coding-scheme';
import { VariableInfo } from '@iqbspecs/variable-info/variable-info.interface';

describe('Installed Responses engine compatibility', () => {
  const variable = (type: string): VariableInfo => JSON.parse(JSON.stringify({
    id: 'V', type, format: '', multiple: false, nullable: false, values: [], valuePositionLabels: []
  }));
  const noValueCoding: VariableCodingData = { id: 'V', sourceType: 'BASE_NO_VALUE', codes: [] };

  it.each(['NO_VALUE', 'no-value'])('accepts %s without a false blocking validation error', type => {
    expect(CodingSchemeFactory.validate([variable(type)], [noValueCoding])).toEqual([]);
  });

  it('retains validation of truly incompatible sources', () => {
    expect(CodingSchemeFactory.validate([variable('STRING')], [noValueCoding])).toContainEqual(
      expect.objectContaining({ type: 'INVALID_SOURCE', breaking: true, variableId: 'V' })
    );
  });

  it('keeps Code 0 and Score 0 in real automatic coding', () => {
    const actual = CodingSchemeFactory.code([{ id: 'V', value: 'A', status: 'VALUE_CHANGED' }], [{
      id: 'V',
      sourceType: 'BASE',
      codes: [{
        id: 0,
        type: 'FULL_CREDIT',
        score: 0,
        ruleSets: [{ rules: [{ method: 'MATCH', parameters: ['A'] }] }]
      }]
    }]);
    expect(actual).toContainEqual(expect.objectContaining({
      id: 'V',
      code: 0,
      score: 0,
      status: 'CODING_COMPLETE'
    }));
  });
});
