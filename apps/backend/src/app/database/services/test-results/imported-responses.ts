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

type IncomingResponse = Pick<TcMergeSubForms, 'legacySubform' | 'unresolvedArchive' | 'repeatsLegacyWrapper'> & {
  entry: ResponseInsertEntry;
  chunkKey?: string;
};

export function importedResponses(unitid: number, subforms: TcMergeSubForms[]): IncomingResponse[] {
  return subforms.flatMap(group => group.responses.map(response => ({
    chunkKey: group.sourceChunkKey,
    legacySubform: group.legacySubform,
    unresolvedArchive: group.unresolvedArchive,
    repeatsLegacyWrapper: group.repeatsLegacyWrapper,
    entry: {
      unitid,
      variableid: response.id,
      subform: group.id,
      source_chunk_key: group.unresolvedArchive ? undefined : group.sourceChunkKey,
      status: statusStringToNumber(response.status) || 0,
      value: serializeValue(response.value)
    }
  })));
}

function indexIncomingResponses(incoming: IncomingResponse[], mode: 'skip' | 'merge' | 'replace') {
  const incomingParts = new Map<string, Set<string>>();
  const unique = new Map<string, IncomingResponse>();
  for (const item of incoming) {
    const { entry } = item;
    const key = JSON.stringify([entry.variableid, entry.subform]);
    if (!incomingParts.has(entry.variableid)) incomingParts.set(entry.variableid, new Set());
    if (item.chunkKey !== undefined) incomingParts.get(entry.variableid)!.add(item.chunkKey);
    const previous = unique.get(key);
    if (previous && (previous.chunkKey !== item.chunkKey || previous.unresolvedArchive !== item.unresolvedArchive ||
      previous.repeatsLegacyWrapper !== item.repeatsLegacyWrapper || previous.legacySubform !== item.legacySubform)) {
      throw new Error(`Mehrere Datenteile für Antwort ${entry.variableid} in Subform ${entry.subform}.`);
    }
    if (!previous || mode === 'replace') unique.set(key, item);
  }
  return { unique, incomingParts };
}

function checkOmittedResponses(existing: ResponseEntity[], matched: Set<number>, incomingParts: Map<string, Set<string>>, previousChunks: ChunkEntity[]) {
  const unscoped = chunkKeysByVariable(previousChunks.filter(chunk => chunk.subform == null));
  for (const row of existing) {
    const parts = incomingParts.get(row.variableid);
    if (matched.has(row.id) || !parts) continue;
    // Updating these memberships would discard the only timestamp evidence for
    // an omitted historical case. A complete original import can disambiguate it.
    if (row.source_chunk_key == null || (parts.has(row.source_chunk_key) && unscoped.get(row.variableid)?.has(row.source_chunk_key))) {
      throw new Error(`Datenteil für bestehende Antwort ${row.variableid} ist im Altbestand nicht eindeutig.`);
    }
  }
}

function checkArchiveMatch(item: IncomingResponse, row: ResponseEntity | undefined, rows: ResponseEntity[]) {
  if (!row && item.unresolvedArchive && rows.length) {
    throw new Error(`Historische Antwort ${item.entry.variableid} in Unit ${item.entry.unitid} ist nicht eindeutig zuzuordnen.`);
  }
  // Older CSV writers copied the wrapper into response.subform. A repeated
  // label alone cannot certify a historical case or identify an additional one.
  if (!item.repeatsLegacyWrapper) return;
  if (row ? row.source_chunk_key == null : rows.some(other => other.source_chunk_key === item.chunkKey)) {
    throw new Error(`Subform für Antwort ${item.entry.variableid} ist im Altformat nicht eindeutig. Bitte Originaldaten prüfen.`);
  }
}

export function matchImportedResponses(incoming: IncomingResponse[], existing: ResponseEntity[], mode: 'skip' | 'merge' | 'replace', previousChunks: ChunkEntity[]) {
  const sources = chunkKeysByVariable(previousChunks);
  const { unique, incomingParts } = indexIncomingResponses(incoming, mode);
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
    const rows = byVariable.get(entry.variableid) || [];
    const candidates = rows.filter(row => {
      if (row.source_chunk_key == null && item.legacySubform !== undefined) {
        // Reproduce the old importer's wrapper-first identity. A wrapper may
        // itself name a different part that contains the same variable.
        const parts = sources.get(row.variableid);
        // A normalized CSV carries no evidence of the original wrapper name.
        if (item.legacySubform === null) return parts?.size === 1 && parts.has(item.chunkKey!);
        if ((row.subform ?? '') !== item.legacySubform) return false;
        if (!parts?.size) return true;
        return parts.has(item.chunkKey!) && Array.from(parts).every(part => incomingParts.get(row.variableid)!.has(part));
      }
      if (item.unresolvedArchive) return false;
      return (row.subform ?? '') === entry.subform;
    });
    const [row] = candidates;
    if (candidates.length > 1 || (row && matched.has(row.id))) {
      throw new Error(`Antwort ${entry.variableid} in Unit ${entry.unitid} ist im Altbestand nicht eindeutig zuzuordnen.`);
    }
    checkArchiveMatch(item, row, rows);
    if (row) {
      matches.push({ row, entry });
      matched.add(row.id);
    } else {
      inserts.push(entry);
    }
  }
  checkOmittedResponses(existing, matched, incomingParts, previousChunks);
  return { matches, inserts, skipped: incoming.length - unique.size };
}
