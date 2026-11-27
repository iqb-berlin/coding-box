import { In } from 'typeorm';
import type { EntityManager, Repository } from 'typeorm';
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
  if (row && item.repeatsLegacyWrapper) {
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

// The importing transaction holds row locks before reading coding results and
// their foreign-key references. A separate query sees newly committed work
// even if acquiring those locks had to wait for another writer.
async function assertReplaceableResponses(manager: EntityManager, matches: ReturnType<typeof matchImportedResponses>['matches']) {
  const changedIds = matches.filter(({ row, entry }) => row.value !== entry.value || row.status !== entry.status).map(({ row }) => row.id);
  if (!changedIds.length) return;
  const [protectedResponse] = await manager.query<{ variableid: string; unitid: number }[]>(`
    SELECT r.variableid, r.unitid FROM response r
    WHERE r.id = ANY($1::int[]) AND (
      -- Fresh imports have V1 code/score defaults of zero without a coding status.
      num_nonnulls(r.status_v1, NULLIF(r.code_v1, 0), NULLIF(r.score_v1, 0),
                   r.status_v2, r.code_v2, r.score_v2, r.status_v3, r.code_v3, r.score_v3) > 0
      OR EXISTS (SELECT 1 FROM coding_job_unit j WHERE j.response_id = r.id)
      OR EXISTS (SELECT 1 FROM coder_training_discussion_result t WHERE t.response_id = r.id)
      OR EXISTS (SELECT 1 FROM double_coding_review_decision d WHERE d.response_id = r.id)
    ) LIMIT 1`, [changedIds]);
  if (protectedResponse) {
    throw new Error(`Wert oder Status der Antwort ${protectedResponse.variableid} in Unit ${protectedResponse.unitid} kann wegen einer bestehenden Kodierung oder Fallzuordnung nicht ersetzt werden.`);
  }
}

export async function planResponseImport(
  incoming: IncomingResponse[], mode: 'skip' | 'merge' | 'replace', existingUnitId: number | undefined,
  responses: Repository<ResponseEntity>, chunks: Repository<ChunkEntity>, manager?: EntityManager
) {
  if (existingUnitId === undefined || !incoming.length) return matchImportedResponses(incoming, [], mode, []);
  const variables = [...new Set(incoming.map(({ entry }) => entry.variableid))];
  const replacing = mode === 'replace';
  const existing = await responses.find({
    where: { unitid: existingUnitId, variableid: In(variables), is_autocoder_generated: false },
    lock: manager && replacing ? { mode: 'pessimistic_write' } : undefined,
    select: {
      id: true, variableid: true, subform: true, source_chunk_key: true, value: replacing, status: replacing
    }
  });
  const needsHistory = existing.length > 0 && incoming.some(item => item.chunkKey !== undefined);
  const previous = needsHistory ? await chunks.findBy({ unitid: existingUnitId }) : [];
  const plan = matchImportedResponses(incoming, existing, mode, previous);
  if (replacing) await assertReplaceableResponses(manager || responses.manager, plan.matches);
  return plan;
}
