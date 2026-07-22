import { mapCodeForExport } from '../../../utils/coding-utils';
import { statusNumberToString } from '../../utils/response-status-converter';
import type {
  CodingItemVersionExportValue,
  CodingItemVersionRow
} from './coding-item-builder.service';
import type {
  ResolvedMissingValue,
  ResolvedMissingsProfile
} from './missings-profiles.service';

const missingIdByStatus = new Map([
  ['INVALID', 'mir'],
  ['CODING_ERROR', 'mci'],
  ['UNSET', 'mbi_mbo'],
  ['DISPLAYED', 'mbi_mbo'],
  ['NOT_REACHED', 'mnr']
]);

const toExportValue = (
  missing: ResolvedMissingValue
): CodingItemVersionExportValue => ({
  code: missing.code,
  score: missing.score === null ? 'NA' : missing.score
});

export const resolveV1ExportValue = (
  row: CodingItemVersionRow,
  profile: ResolvedMissingsProfile
): CodingItemVersionExportValue => {
  if (row.codeV1 === -3) {
    return toExportValue(profile.byId.get('mir')!);
  }
  if (row.codeV1 === -4) {
    return toExportValue(profile.byId.get('mci')!);
  }

  const mappedCode = mapCodeForExport(row.codeV1);
  if (mappedCode !== null || row.scoreV1 !== null) {
    return {
      code: mappedCode ?? '',
      score: row.scoreV1 ?? ''
    };
  }

  const status = row.statusV1 === null ? null : statusNumberToString(row.statusV1);
  const missingId = status ? missingIdByStatus.get(status) : undefined;
  if (!missingId) {
    return { code: '', score: '' };
  }

  return toExportValue(profile.byId.get(missingId)!);
};
