import type { ResponseValueType } from '@iqbspecs/response/response.interface';
import type { ChunkEntity } from '../../entities/chunk.entity';
import type { ResponseEntity } from '../../entities/response.entity';
import type { Chunk, TcMergeResponse } from '../shared';
import { statusNumberToString } from '../../utils/response-status-converter';

function archiveValue(stored: string | null): ResponseValueType {
  if (!stored?.startsWith('[')) return stored;
  try {
    const value: unknown = JSON.parse(stored);
    // Keep arrays typed when the importer can recreate the exact stored text.
    if (Array.isArray(value) && JSON.stringify(value) === stored) return value;
  } catch {
    // Free-text answers can also start with an opening bracket.
  }
  return stored;
}

function indexChunkMemberships(chunks: ChunkEntity[]) {
  const byVariable = new Map<string, ChunkEntity[]>();
  const emptyParts = new Map<string, ChunkEntity[]>();
  for (const chunk of chunks) {
    const variables = (chunk.variables || '').split(',').map(id => id.trim()).filter(Boolean);
    if (!variables.length && chunk.subform == null) {
      if (!emptyParts.has(chunk.key)) emptyParts.set(chunk.key, []);
      emptyParts.get(chunk.key)!.push(chunk);
    }
    for (const variable of variables) {
      if (!byVariable.has(variable)) byVariable.set(variable, []);
      byVariable.get(variable)!.push(chunk);
    }
  }
  return { byVariable, emptyParts };
}

function sourceRecords(row: ResponseEntity, { byVariable, emptyParts }: ReturnType<typeof indexChunkMemberships>) {
  const legacy = row.source_chunk_key == null;
  const form = row.subform ?? '';
  const key = row.source_chunk_key ?? form;
  const memberships = (byVariable.get(row.variableid) || []).filter(chunk => (legacy ? chunk.subform == null : chunk.key === key));
  const exact = memberships.filter(chunk => !legacy && chunk.subform === form);
  const candidates = exact.length ? exact : memberships.filter(chunk => legacy || chunk.subform == null);
  if (legacy && !candidates.length) candidates.push(...(emptyParts.get(key) || []));
  const metadata = new Map(candidates.map(chunk => [
    JSON.stringify([chunk.key, Number(chunk.ts), chunk.type]), chunk
  ]));
  // Historical memberships contain neither a response ID nor a real subform.
  // Multiple possible source records cannot safely be collapsed to the newest.
  if (metadata.size > 1 && !exact.length) {
    throw new Error(`Herkunft der Antwort ${row.variableid} in Unit ${row.unitid} ist im Altbestand nicht eindeutig.`);
  }
  return metadata.size ? metadata.values() : [undefined];
}

export function exportResponseChunks(responses: ResponseEntity[], chunks: ChunkEntity[]): Chunk[] {
  const memberships = indexChunkMemberships(chunks);
  const groups = new Map<string, { chunk: Omit<Chunk, 'content'>; responses: TcMergeResponse[] }>();
  for (const row of responses) {
    const legacy = row.source_chunk_key == null;
    const form = row.subform ?? '';
    const answer: TcMergeResponse = {
      id: row.variableid,
      value: archiveValue(row.value),
      status: statusNumberToString(row.status) || 'UNSET',
      subform: legacy ? undefined : form || undefined
    };
    for (const source of sourceRecords(row, memberships)) {
      const chunk = {
        id: source?.key ?? row.source_chunk_key ?? '',
        ts: Number(source?.ts) || 0,
        responseType: source?.type || (legacy && !source ? '' : 'state'),
        codingBoxLegacySubform: legacy ? form : null
      };
      const group = JSON.stringify(chunk);
      if (!groups.has(group)) groups.set(group, { chunk, responses: [] });
      groups.get(group)!.responses.push(answer);
    }
  }
  return Array.from(groups.values(), group => ({ ...group.chunk, content: JSON.stringify(group.responses) }));
}
