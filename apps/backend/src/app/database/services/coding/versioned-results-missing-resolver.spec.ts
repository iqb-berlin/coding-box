import type { CodingItemVersionRow } from './coding-item-builder.service';
import type { ResolvedMissingsProfile } from './missings-profiles.service';
import { resolveV1ExportValue } from './versioned-results-missing-resolver';

const createRow = (
  statusV1: number | null,
  codeV1: number | null = null,
  scoreV1: number | null = null
): CodingItemVersionRow => ({
  id: 1,
  unitKey: 'UNIT',
  unitAlias: null,
  personLogin: null,
  personCode: null,
  personGroup: null,
  bookletName: null,
  variableId: 'VAR',
  value: null,
  statusV1,
  codeV1,
  scoreV1,
  statusV2: null,
  codeV2: null,
  scoreV2: null,
  statusV3: null,
  codeV3: null,
  scoreV3: null
});

const profile: ResolvedMissingsProfile = {
  id: 7,
  label: 'Test',
  byId: new Map([
    ['mir', {
      id: 'mir', label: 'MIR', code: -18, score: 0
    }],
    ['mci', {
      id: 'mci', label: 'MCI', code: -17, score: null
    }],
    ['mbi_mbo', {
      id: 'mbi_mbo', label: 'MBO', code: -19, score: 0
    }],
    ['mnr', {
      id: 'mnr', label: 'MNR', code: -16, score: null
    }]
  ]),
  byCode: new Map()
};

describe('resolveV1ExportValue', () => {
  it.each([
    [7, -18, 0],
    [9, -17, 'NA'],
    [0, -19, 0],
    [2, -19, 0],
    [1, -16, 'NA']
  ])('maps status %s through the selected profile', (status, code, score) => {
    expect(resolveV1ExportValue(createRow(status), profile)).toEqual({ code, score });
  });

  it('keeps usable stored code and score values', () => {
    expect(resolveV1ExportValue(createRow(7, 4, 2), profile)).toEqual({
      code: 4,
      score: 2
    });
  });

  it.each([[-3, -18, 0], [-4, -17, 'NA']])(
    'resolves internal code %s through the selected profile',
    (internalCode, code, score) => {
      expect(resolveV1ExportValue(createRow(5, internalCode, 99), profile))
        .toEqual({ code, score });
    }
  );

  it('does not map PARTLY_DISPLAYED in this export', () => {
    expect(resolveV1ExportValue(createRow(10), profile)).toEqual({
      code: '',
      score: ''
    });
  });
});
