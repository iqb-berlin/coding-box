import { chunkKeysByVariable } from './response-chunks';
import type { ChunkEntity } from '../../entities/chunk.entity';
import type { ResponseEntity } from '../../entities/response.entity';
import type { TcMergeResponse, TcMergeSubForms } from '../shared';
import { statusStringToNumber } from '../../utils/response-status-converter';

export type ResponseInsertEntry = {
  unitid: number;
  variableid: string;
  status: number;
  value: string | null;
  subform: string;
  source_chunk_key?: string;
};

function serializeValue(value: TcMergeResponse['value']): string | null {
  if (value === null) return null;
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

type IncomingResponse = { entry: ResponseInsertEntry; legacySubform?: string };

export function importedResponses(unitid: number, subforms: TcMergeSubForms[]): IncomingResponse[] {
  return subforms.flatMap(group => group.responses.map(response => ({
    legacySubform: group.legacySubform,
    entry: {
      unitid,
      variableid: response.id,
      subform: group.id,
      source_chunk_key: group.sourceChunkKey,
      status: statusStringToNumber(response.status) || 0,
      value: serializeValue(response.value)
    }
  })));
}

function legacySourceMatches(row: ResponseEntity, item: IncomingResponse, sources: Map<string, Set<string>>): boolean {
  const keys = sources.get(row.variableid);
  const oldForm = row.subform ?? '';
  if (!keys?.size) return oldForm === item.legacySubform;
  // The old importer used the chunk key or the wrapper's subForm. Where only
  // the wrapper survives, a unique variable membership identifies its part.
  if (keys.has(oldForm)) return oldForm === item.entry.source_chunk_key;
  if (keys.size === 1) return keys.has(item.entry.source_chunk_key ?? '');
  return false;
}

export function matchImportedResponses(incoming: IncomingResponse[], existing: ResponseEntity[], mode: 'skip' | 'merge' | 'replace', previousChunks: ChunkEntity[]) {
  const sources = chunkKeysByVariable(previousChunks);
  const unique = new Map<string, IncomingResponse>();
  for (const item of incoming) {
    const { entry } = item;
    const key = JSON.stringify([entry.variableid, entry.subform]);
    const previous = unique.get(key);
    if (previous && previous.entry.source_chunk_key !== entry.source_chunk_key) {
      throw new Error(`Mehrere Datenteile für Antwort ${entry.variableid} in Subform ${entry.subform}.`);
    }
    if (!previous || mode === 'replace') unique.set(key, item);
  }
  const byVariable = new Map<string, ResponseEntity[]>();
  for (const row of existing) {
    if (!byVariable.has(row.variableid)) byVariable.set(row.variableid, []);
    byVariable.get(row.variableid)!.push(row);
  }
  const matched = new Set<number>();
  const matches: { entry: ResponseInsertEntry; row: ResponseEntity }[] = [];
  const inserts: ResponseInsertEntry[] = [];
  for (const item of unique.values()) {
    const { entry } = item;
    const candidates = (byVariable.get(entry.variableid) || []).filter(row => {
      if (row.source_chunk_key == null && item.legacySubform !== undefined) return legacySourceMatches(row, item, sources);
      return (row.subform ?? '') === entry.subform;
    });
    const [row] = candidates;
    if (candidates.length > 1 || (row && matched.has(row.id))) {
      throw new Error(`Antwort ${entry.variableid} in Unit ${entry.unitid} ist im Altbestand nicht eindeutig zuzuordnen.`);
    }
    if (row) {
      matches.push({ row, entry });
      matched.add(row.id);
    } else {
      inserts.push(entry);
    }
  }
  // Changed partitions cannot identify a manual case whose old subform
  // was only a transport label. Abort the unit instead of inserting a duplicate.
  for (const entry of inserts) {
    const unresolved = byVariable.get(entry.variableid)?.some(row => row.source_chunk_key == null && !matched.has(row.id));
    if (unresolved) throw new Error(`Datenteil für bestehende Antwort ${entry.variableid} in Unit ${entry.unitid} ist nicht eindeutig.`);
  }
  return { matches, inserts, skipped: incoming.length - unique.size };
}
