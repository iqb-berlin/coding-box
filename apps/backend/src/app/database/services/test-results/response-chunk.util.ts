import type { Logger } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { ResponseEntity } from '../../entities/response.entity';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { getErrorMessage } from '../../../utils/error.util';
import type { Chunk, TcMergeResponse, TcMergeSubForms } from '../shared/types';

export function extractChunkSubforms(chunks: Chunk[], logger: Logger): TcMergeSubForms[] {
  return chunks.map(chunk => {
    let responses: TcMergeResponse[] = [];
    try {
      responses = JSON.parse(chunk.content);
    } catch (error) {
      logger.error(`Error parsing chunk content for chunk ID ${chunk.id}: ${getErrorMessage(error)}`);
    }
    return {
      id: chunk.subForm || chunk.id || '',
      sourceChunk: { key: String(chunk.id || chunk.subForm || ''), hasSubform: !!chunk.subForm },
      responses
    };
  });
}

function storedResponseValue(value: TcMergeResponse['value']): string | null {
  if (value === null) return null;
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function responseInsertEntries(unitid: number, subform: TcMergeSubForms) {
  return subform.responses.map(response => ({
    unitid,
    variableid: response.id,
    status: statusStringToNumber(response.status) || 0,
    value: storedResponseValue(response.value),
    subform: subform.id,
    source_chunk_key: subform.sourceChunk?.key,
    chunk_has_subform: subform.sourceChunk?.hasSubform
  }));
}

export type ResponseInsertEntry = ReturnType<typeof responseInsertEntries>[number];

/** A merge can restore missing provenance without changing response IDs or existing coding. */
export async function restoreLegacyChunk(
  repository: Repository<ResponseEntity>, subforms: TcMergeSubForms[], form: TcMergeSubForms,
  entries: ResponseInsertEntry[], existing: ResponseEntity[]
): Promise<void> {
  if (!form.sourceChunk || !existing.some(row => row.source_chunk_key === null)) return;

  // The import can contain several parts for the same coding subform. Only repair
  // variables with a single source and a single stored row.
  const seen = new Set<string>();
  const ambiguous = new Set<string>();
  for (const candidate of subforms) {
    if (candidate.id !== form.id) continue;
    for (const response of candidate.responses ?? []) {
      if (seen.has(response.id)) ambiguous.add(response.id);
      seen.add(response.id);
    }
  }
  const stored = new Map<string, ResponseEntity>();
  for (const row of existing) {
    if (stored.has(row.variableid)) ambiguous.add(row.variableid);
    stored.set(row.variableid, row);
  }
  const originals = entries.flatMap(({ variableid, status, value }) => {
    const row = stored.get(variableid);
    return row?.source_chunk_key === null && !ambiguous.has(variableid) ? [{ id: row.id, status, value }] : [];
  });
  if (!originals.length) return;
  await repository.query(`UPDATE response AS r SET source_chunk_key = $1, chunk_has_subform = $2
    FROM jsonb_to_recordset($3::jsonb) AS original(id integer, status smallint, value text)
    WHERE r.id = original.id AND r.status = original.status AND r.value IS NOT DISTINCT FROM original.value
      AND r.source_chunk_key IS NULL AND r.is_autocoder_generated IS NOT TRUE`,
  [form.sourceChunk.key, form.sourceChunk.hasSubform, JSON.stringify(originals)]);
}
