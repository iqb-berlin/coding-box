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
  ['PARTLY_DISPLAYED', 'mbi_mbo'],
  ['NOT_REACHED', 'mnr']
]);

const toExportValue = (
  missing: ResolvedMissingValue
): CodingItemVersionExportValue => ({
  code: missing.code,
  score: missing.score === null ? 'NA' : missing.score
});

const resolveExportValue = (
  status: number | null,
  code: number | null,
  score: number | null,
  profile: ResolvedMissingsProfile,
  resolveStatusMissing: boolean
): CodingItemVersionExportValue => {
  if (code === -3) {
    return toExportValue(profile.byId.get('mir')!);
  }
  if (code === -4) {
    return toExportValue(profile.byId.get('mci')!);
  }

  const mappedCode = mapCodeForExport(code);
  if (mappedCode !== null || score !== null) {
    return {
      code: mappedCode ?? '',
      score: score ?? (mappedCode !== null && mappedCode < 0 ? 'NA' : '')
    };
  }

  if (!resolveStatusMissing) {
    return { code: '', score: '' };
  }

  const statusName = status === null ? null : statusNumberToString(status);
  const missingId = statusName ? missingIdByStatus.get(statusName) : undefined;
  if (!missingId) {
    return { code: '', score: '' };
  }

  return toExportValue(profile.byId.get(missingId)!);
};

export interface VersionedExportValues {
  v1: CodingItemVersionExportValue;
  v2?: CodingItemVersionExportValue;
  v3?: CodingItemVersionExportValue;
}

export const resolveVersionedExportValues = (
  row: CodingItemVersionRow,
  targetVersion: 'v1' | 'v2' | 'v3',
  profile: ResolvedMissingsProfile
): VersionedExportValues => ({
  v1: resolveExportValue(
    row.statusV1,
    row.codeV1,
    row.scoreV1,
    profile,
    true
  ),
  ...(targetVersion !== 'v1' ? {
    v2: resolveExportValue(
      row.statusV2,
      row.codeV2,
      row.scoreV2,
      profile,
      false
    )
  } : {}),
  ...(targetVersion === 'v3' ? {
    v3: resolveExportValue(
      row.statusV3,
      row.codeV3,
      row.scoreV3,
      profile,
      true
    )
  } : {})
});

export const resolveV1ExportValue = (
  row: CodingItemVersionRow,
  profile: ResolvedMissingsProfile
): CodingItemVersionExportValue => resolveVersionedExportValues(
  row,
  'v1',
  profile
).v1;
