import {
  calculateModalValue,
  formatModalCandidates,
  getModalTieLabel,
  mapCodeForExport
} from './coding-utils';

describe('coding utils', () => {
  it('does not export the legacy duplicate aggregation marker as a code', () => {
    expect(mapCodeForExport(-111)).toBeNull();
  });

  it('maps manual missing issue options only with profile context', () => {
    expect(mapCodeForExport(-3)).toBeNull();
    expect(mapCodeForExport(-4)).toBeNull();
    expect(mapCodeForExport(-3, { mirCode: -123, mciCode: -124 })).toBe(-123);
    expect(mapCodeForExport(-4, { mirCode: -123, mciCode: -124 })).toBe(-124);
    expect(mapCodeForExport(-1)).toBeNull();
    expect(mapCodeForExport(7)).toBe(7);
  });

  it('selects the smallest modal code deterministically when counts tie', () => {
    expect(calculateModalValue([9, 6, 9, 6, 8])).toEqual({
      modalValue: 6,
      deviationCount: 3,
      isTie: true,
      modalCandidates: [6, 9]
    });
  });

  it('formats modal tie metadata for exports', () => {
    const tiedModal = calculateModalValue([9, 6, 9, 6, 8]);
    const uniqueModal = calculateModalValue([9, 9, 6]);

    expect(getModalTieLabel(tiedModal)).toBe('Ja');
    expect(formatModalCandidates(tiedModal)).toBe('6,9');
    expect(formatModalCandidates(tiedModal, code => `${code} (formatted)`)).toBe('6 (formatted),9 (formatted)');
    expect(getModalTieLabel(uniqueModal)).toBe('Nein');
    expect(formatModalCandidates(uniqueModal)).toBe('9');
    expect(getModalTieLabel(null)).toBe('');
    expect(formatModalCandidates(null)).toBe('');
  });
});
