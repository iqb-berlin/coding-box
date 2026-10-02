import type { CodingItemVersionRow } from './coding-item-builder.service';
import type { ResolvedMissingsProfile } from './missings-profiles.service';
import {
  resolveV1ExportValue,
  resolveVersionedExportValues
} from './versioned-results-missing-resolver';

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
    }],
    ['mbd', {
      id: 'mbd', label: 'MBD', code: -15, score: null
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

  it('maps PARTLY_DISPLAYED to omission', () => {
    expect(resolveV1ExportValue(createRow(10), profile)).toEqual({
      code: -19,
      score: 0
    });
  });

  it('resolves cumulative v1 and v3 status values while preserving v2', () => {
    const row = createRow(1);
    row.statusV2 = 5;
    row.codeV2 = -42;
    row.scoreV2 = null;
    row.statusV3 = 9;

    expect(resolveVersionedExportValues(row, 'v3', profile)).toEqual({
      v1: { code: -16, score: 'NA' },
      v2: { code: -42, score: 'NA' },
      v3: { code: -17, score: 'NA' }
    });
  });

  it('keeps DERIVE_PENDING visible without inventing a missing value', () => {
    const row = createRow(11);
    row.statusV3 = 11;

    expect(resolveVersionedExportValues(row, 'v3', profile)).toMatchObject({
      v1: { code: '', score: '' },
      v3: { code: '', score: '' }
    });
  });
});
