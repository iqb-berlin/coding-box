import { IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import * as cheerio from 'cheerio';
import FileUpload, { NO_CODING_SCHEME_REF_NORMALIZED } from '../../entities/file_upload.entity';
import { CodingUnitFreshness } from '../../entities/coding-unit-freshness.entity';
import { extractCodingSchemeRef } from './coding-scheme-resolution.util';

/** Keep intentional schema omissions out of automatic work, without changing stored results. */
export async function excludeUnitsWithoutCodingScheme(
  workspaceId: number,
  query: SelectQueryBuilder<CodingUnitFreshness>,
  fileRepository: Repository<FileUpload>
): Promise<void> {
  const candidates = await fileRepository.find({
    where: [
      { workspace_id: workspaceId, file_type: 'Unit', coding_scheme_ref_normalized: NO_CODING_SCHEME_REF_NORMALIZED },
      { workspace_id: workspaceId, file_type: 'Unit', coding_scheme_ref_normalized: IsNull() }
    ],
    select: ['file_id', 'data']
  });
  const fileIds = candidates.filter(file => {
    // Missing files, unreadable data and declared references must remain visible as blockers.
    try {
      return cheerio.load(file.data)('unit').length > 0 && extractCodingSchemeRef(file.data) === '';
    } catch {
      return false;
    }
  }).map(file => file.file_id);
  if (fileIds.length === 0) return;

  // Match the executor's preferred alias, falling back to the name only for blank aliases.
  const trimmedAlias = "REGEXP_REPLACE(unit.alias, '^[[:space:]]+|[[:space:]]+$', '', 'g')";
  const trimmedName = "REGEXP_REPLACE(unit.name, '^[[:space:]]+|[[:space:]]+$', '', 'g')";
  query.andWhere(
    `(freshness.version = :manualFreshnessVersion OR COALESCE(
      UPPER(COALESCE(NULLIF(${trimmedAlias}, ''), ${trimmedName})) <> ALL(CAST(:noCodingSchemeFileIds AS text[])),
      TRUE
    ))`,
    { manualFreshnessVersion: 'v2', noCodingSchemeFileIds: fileIds }
  );
}
