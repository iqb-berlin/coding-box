import {
  calculateModalValue,
  formatModalCandidates,
  getCurrentCoding,
  getCurrentManualCoding,
  getLatestCode,
  getModalTieLabel,
  isReservedTechnicalCodingCode,
  mapCodeForExport
} from './coding-utils';

describe('coding utils', () => {
  it('keeps the existing manual and version fallback order without invalidation', () => {
    const response = {
      code_v1: 1,
      score_v1: 10,
      code_v2: 2,
      score_v2: 20,
      code_v3: null,
      score_v3: null,
      autocoder_invalidated_version: null
    };

    expect(getLatestCode(response)).toEqual({
      code: 2,
      score: 20,
      version: 'v2'
    });
    expect(getCurrentCoding(response, { code: 0, score: 0 })).toEqual({
      code: 0,
      score: 0,
      version: 'manual'
    });
  });

  it('prefers a score-only v2 tuple to a complete v1 tuple', () => {
    const response = {
      code_v1: 1,
      score_v1: 10,
      code_v2: null,
      score_v2: 20,
      code_v3: null,
      score_v3: null,
      autocoder_invalidated_version: null
    };

    expect(getLatestCode(response)).toEqual({
      code: null,
      score: 20,
      version: 'v2'
    });
  });

  it('prefers a score-only v3 tuple to older complete tuples', () => {
    const response = {
      code_v1: 1,
      score_v1: 10,
      code_v2: 2,
      score_v2: 20,
      code_v3: null,
      score_v3: 30,
      autocoder_invalidated_version: null
    };

    expect(getLatestCode(response)).toEqual({
      code: null,
      score: 30,
      version: 'v3'
    });
  });

  it('does not fall back to stale manual, v2, or v1 values after invalidation', () => {
    const response = {
      code_v1: 1,
      score_v1: 10,
      code_v2: 2,
      score_v2: 20,
      code_v3: null,
      score_v3: null,
      autocoder_invalidated_version: 'v2'
    };

    expect(getLatestCode(response)).toEqual({
      code: null,
      score: null,
      version: 'v3'
    });
    expect(getCurrentCoding(response, { code: 4, score: 40 })).toEqual({
      code: null,
      score: null,
      version: 'v3'
    });
  });

  it('uses a new v3 tuple after invalidation', () => {
    const response = {
      code_v1: 1,
      score_v1: 10,
      code_v2: 2,
      score_v2: 20,
      code_v3: 3,
      score_v3: 30,
      autocoder_invalidated_version: 'v2'
    };

    expect(getCurrentCoding(response, { code: 4, score: 40 })).toEqual({
      code: 3,
      score: 30,
      version: 'v3'
    });
    expect(getCurrentManualCoding(response, { code: 4, score: 40 })).toEqual({
      code: null,
      score: null
    });
  });

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

  it.each([-1, -2, -3, -4, -111])(
    'classifies %s as a reserved technical coding code',
    code => {
      expect(isReservedTechnicalCodingCode(code)).toBe(true);
    }
  );

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
