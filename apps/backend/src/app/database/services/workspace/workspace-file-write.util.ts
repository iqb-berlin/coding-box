import type { QueryDeepPartialEntity } from 'typeorm';
import { EntityManager, QueryRunner, Repository } from 'typeorm';
import FileUpload, { NO_CODING_SCHEME_REF_NORMALIZED, StructuredFileData } from '../../entities/file_upload.entity';

export type WorkspaceFilesMutationContext = {
  manager: EntityManager;
  fileUploadRepository: Repository<FileUpload>;
};

export function toFileWriteData(file: FileUpload): QueryDeepPartialEntity<FileUpload> {
  const { structured_data: structuredData, ...columns } = file;
  return {
    ...columns,
    // PostgreSQL serializes jsonb as one value. TypeORM's deep partial type
    // instead treats its arbitrary JSON keys as nested entity properties.
    structured_data: structuredData as QueryDeepPartialEntity<StructuredFileData>
  };
}

export function isCodingSchemeFileId(fileId: unknown): boolean {
  return String(fileId || '').trim().toUpperCase().endsWith('.VOCS');
}

export function normalizeFileIdForLookup(fileId: unknown): string | null {
  const normalized = String(fileId || '')
    .trim()
    .toUpperCase()
    .replace(/\.XML$/i, '');
  return normalized || null;
}

export function normalizeCodingSchemeRefForLookup(value: unknown): string | null {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\.VOCS$/i, '')
    .replace(/\.XML$/i, '')
    .split(/[\\/]/)
    .filter(Boolean)
    .pop() || '';
  return normalized || null;
}

export function getCodingSchemeRefForLookup(
  fileType: unknown,
  structuredData: StructuredFileData | null | undefined
): string | null {
  if (String(fileType || '').toLowerCase() !== 'unit') {
    return null;
  }

  const extractedInfo = structuredData?.extractedInfo || {};
  const refs = extractedInfo.codingSchemeRefs;
  if (Array.isArray(refs) && refs.length > 0) {
    return normalizeCodingSchemeRefForLookup(refs[0]) ||
        NO_CODING_SCHEME_REF_NORMALIZED;
  }

  return normalizeCodingSchemeRefForLookup(
    extractedInfo.codingSchemeRefNormalized ||
        extractedInfo.codingSchemeRef
  ) || NO_CODING_SCHEME_REF_NORMALIZED;
}

export function withNormalizedFileLookupFields(
  entry: Record<string, unknown>
): Record<string, unknown> {
  const structuredData = entry.structured_data as StructuredFileData | null | undefined;
  return {
    ...entry,
    file_id_normalized: normalizeFileIdForLookup(entry.file_id),
    coding_scheme_ref_normalized: getCodingSchemeRefForLookup(
      entry.file_type,
      structuredData
    )
  };
}

export function toFailedUploadResult(
  filename: string,
  reason: unknown,
  details?: string[]
): {
  failed: true;
  filename: string;
  reason: string;
  details?: string[];
} {
  return {
    failed: true,
    filename,
    reason: reason instanceof Error ? reason.message : String(reason),
    details: details && details.length > 0 ? details : undefined
  };
}

export function getWorkspaceFilesMutationContext(
  queryRunner: QueryRunner
): WorkspaceFilesMutationContext {
  return {
    manager: queryRunner.manager,
    fileUploadRepository: queryRunner.manager.getRepository(FileUpload)
  };
}
