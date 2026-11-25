import { statusStringToNumber } from '../../utils/response-status-converter';
import type { TestResultsUploadIssueDto } from '../../../../../../../api-dto/files/test-results-upload-result.dto';
import type {
  Chunk, TcMergeChunk, TcMergeResponse, TcMergeSubForms
} from '../shared';
import type { ChunkEntity } from '../../entities/chunk.entity';

export function extractResponseGroups(chunks: Chunk[], onError: (chunk: Chunk, error: unknown) => void, fromCsv = false): TcMergeSubForms[] {
  return chunks.flatMap(chunk => {
    const sourceChunkKey = String(chunk.id || chunk.subForm || '');
    const unresolvedArchive = typeof chunk.codingBoxLegacySubform === 'string';
    const legacySubform = chunk.codingBoxLegacySubform === undefined ? (chunk.subForm || chunk.id || '') : chunk.codingBoxLegacySubform;
    const groups = new Map<string, TcMergeResponse[]>();
    try {
      const responses: TcMergeResponse[] = JSON.parse(chunk.content);
      for (const response of responses) {
        const id = chunk.codingBoxLegacySubform ?? response.subform ?? '';
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id)!.push(response);
      }
    } catch (error) {
      onError(chunk, error);
      groups.clear();
    }
    if (!groups.size) groups.set('', []);
    return Array.from(groups, ([id, responses]) => ({
      id,
      sourceChunkKey,
      legacySubform,
      unresolvedArchive,
      repeatsLegacyWrapper: fromCsv && chunk.codingBoxLegacySubform === undefined && !!id && chunk.subForm === id,
      responses
    }));
  });
}

export function chunkMemberships(chunks: Chunk[], fallback: Set<string>, onError: (chunk: Chunk, error: unknown) => void): TcMergeChunk[] {
  return chunks.flatMap(chunk => {
    // A synthetic archive envelope with no source metadata is not a stored part.
    if (typeof chunk.codingBoxLegacySubform === 'string' && !chunk.id && !chunk.responseType && !chunk.ts) return [];
    return extractResponseGroups([chunk], onError).map(group => {
      const variables = group.responses.map(response => String(response.id || '').trim()).filter(Boolean);
      return {
        id: group.sourceChunkKey!,
        type: String(chunk.responseType || '').trim(),
        ts: Number(chunk.ts) || 0,
        subform: group.unresolvedArchive ? undefined : group.id,
        variables: [...new Set(variables.length || chunks.length !== 1 ? variables : fallback)]
      };
    });
  }).filter(chunk => chunk.id || chunk.type || chunk.ts || chunk.variables.length);
}

// Historical rows only have the variable lists and the old chunk-level subform.
export function chunkKeysByVariable(chunks: ChunkEntity[]) {
  const byVariable = new Map<string, Set<string>>();
  for (const chunk of [...chunks].sort((a, b) => Number(a.ts) - Number(b.ts))) {
    for (const variable of (chunk.variables || '').split(',').map(v => v.trim()).filter(Boolean)) {
      if (!byVariable.has(variable)) byVariable.set(variable, new Set());
      const keys = byVariable.get(variable)!;
      keys.delete(chunk.key);
      keys.add(chunk.key);
    }
  }
  return byVariable;
}

export function chunkResolver(chunks: ChunkEntity[]) {
  const byVariable = chunkKeysByVariable(chunks);
  return (response: { variableid: string; subform: string | null; source_chunk_key?: string | null }) => {
    if (response.source_chunk_key != null) return response.source_chunk_key;
    const candidates = byVariable.get(response.variableid);
    const form = response.subform || '';
    if (candidates?.has(form)) return form;
    return candidates ? Array.from(candidates).pop() ?? form : form;
  };
}

export function countChunkResponses(
  chunk: unknown, unitKey: string, responses: Set<string>, statusCounts: Record<string, number>,
  issues: TestResultsUploadIssueDto[], fileName: string, rowIndex: number
): void {
  if (!chunk || typeof chunk !== 'object') return;
  const content = (chunk as { content?: string }).content;
  if (!content || typeof content !== 'string') return;
  try {
    const chunkResponses = JSON.parse(content) as Array<{ id?: string; status?: string; subform?: string }>;
    if (!Array.isArray(chunkResponses)) return;
    chunkResponses.forEach(r => {
      const responseId = r?.id || '';
      if (!responseId) return;
      const storedForm = (chunk as Chunk).codingBoxLegacySubform ?? r.subform ?? '';
      const uniqueKey = `${unitKey}@@${storedForm}@@${responseId}`;
      responses.add(uniqueKey);

      let status = r?.status;
      if (!status) {
        status = 'INVALID';
        issues.push({
          level: 'warning',
          message: `Missing status (defaulting to INVALID) in response for ${uniqueKey}`,
          fileName,
          rowIndex,
          category: 'missing_status'
        });
      } else if (statusStringToNumber(status) === null) {
        issues.push({
          level: 'warning',
          message: `Invalid status '${status}' (defaulting to INVALID) in response for ${uniqueKey}`,
          fileName,
          rowIndex,
          category: 'invalid_status'
        });
        status = 'INVALID';
      }

      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
  } catch {
    issues.push({
      level: 'warning',
      message: 'Malformed chunk content JSON',
      fileName,
      rowIndex
    });
  }
}

// Keep memberships omitted by a partial upload, including their timestamps.
// Parts absent from the upload are never selected for replacement.
export function chunkRowsForImport(unitid: number, chunks: TcMergeChunk[], previous: ChunkEntity[]) {
  const incoming = new Map<string, Set<string>>();
  const rows = new Map<string, Omit<ChunkEntity, 'id' | 'unit'>>();
  const add = (key: string, type: string, ts: number, subform: string | null | undefined, variables: string[]) => {
    const list = [...new Set(variables.map(v => v.trim()).filter(Boolean))].join(',');
    rows.set(JSON.stringify([key, type, ts, subform, list]), {
      unitid, key, type, ts, subform, variables: list
    });
  };
  for (const chunk of chunks) {
    const variables = chunk.variables || [];
    for (const variable of variables) {
      const key = JSON.stringify([chunk.id, variable.trim()]);
      if (!incoming.has(key)) incoming.set(key, new Set());
      if (chunk.subform !== undefined) incoming.get(key)!.add(chunk.subform);
    }
    add(chunk.id, String(chunk.type || '').trim(), Number(chunk.ts) || 0, chunk.subform, variables);
  }
  for (const chunk of previous) {
    const missing = (chunk.variables || '').split(',').map(v => v.trim()).filter(variable => {
      const forms = incoming.get(JSON.stringify([chunk.key, variable]));
      return variable && (!forms || (chunk.subform != null && !forms.has(chunk.subform)));
    });
    if (missing.length) add(chunk.key, chunk.type, chunk.ts, chunk.subform, missing);
  }
  return Array.from(rows.values());
}
