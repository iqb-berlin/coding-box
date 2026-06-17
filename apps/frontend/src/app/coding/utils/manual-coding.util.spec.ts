import {
  getVisibleManualInstructionText,
  hasManualInstruction
} from './manual-coding.util';

describe('manual-coding.util', () => {
  it('treats visually empty HTML instructions as missing', () => {
    expect(hasManualInstruction({
      manualInstruction: '<p style="margin-top: 0; min-height: 1em">&nbsp;</p>'
    })).toBe(false);
  });

  it('treats zero-width characters as missing', () => {
    expect(hasManualInstruction({
      manualInstruction: '<p>&#8203;\u200d\ufeff</p>'
    })).toBe(false);
  });

  it('does not throw for invalid numeric HTML entities', () => {
    expect(getVisibleManualInstructionText('&#999999999999;')).toBe('&#999999999999;');
    expect(getVisibleManualInstructionText('&#xFFFFFFFF;')).toBe('&#xFFFFFFFF;');
  });
});
