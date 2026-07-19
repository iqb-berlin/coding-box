import {
  getPsychometricLogicalKey,
  normalizePsychometricUnitKey,
  normalizePsychometricVariableKey
} from './psychometric-key.util';

describe('psychometric key normalization', () => {
  it.each([
    ['UNIT_A', 'UNIT_A'],
    [' unit_a.xml ', 'UNIT_A'],
    ['folder/UNIT_A.VOMD', 'UNIT_A'],
    ['folder\\unit_a.vocs', 'UNIT_A']
  ])('normalizes unit name %s', (input, expected) => {
    expect(normalizePsychometricUnitKey(input)).toBe(expected);
  });

  it('normalizes variable IDs in logical mapping keys', () => {
    expect(normalizePsychometricVariableKey(' v1 ')).toBe('V1');
    expect(getPsychometricLogicalKey('folder/UNIT_A.XML', ' v1 ')).toBe(
      'UNIT_A\u001FV1'
    );
  });
});
