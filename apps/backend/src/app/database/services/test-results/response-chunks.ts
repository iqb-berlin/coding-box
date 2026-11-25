import { statusStringToNumber } from '../../utils/response-status-converter';
import type { TestResultsUploadIssueDto } from '../../../../../../../api-dto/files/test-results-upload-result.dto';
import type {
  Chunk, TcMergeChunk, TcMergeResponse, TcMergeSubForms
} from '../shared';
import type { ChunkEntity } from '../../entities/chunk.entity';

export function extractResponseGroups(chunks: Chunk[], onError: (chunk: Chunk, error: unknown) => void): TcMergeSubForms[] {
  return chunks.flatMap(chunk => {
    const sourceChunkKey = String(chunk.id || chunk.subForm || '');
    const legacySubform = chunk.subForm || chunk.id || '';
    const groups = new Map<string, TcMergeResponse[]>();
    try {
      const responses: TcMergeResponse[] = JSON.parse(chunk.content);
      for (const response of responses) {
        const id = response.subform ?? '';
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id)!.push(response);
      }
    } catch (error) {
      onError(chunk, error);
      groups.clear();
    }
    if (!groups.size) groups.set('', []);
    return Array.from(groups, ([id, responses]) => ({
      id, sourceChunkKey, legacySubform, responses
    }));
  });
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
      const uniqueKey = `${unitKey}@@${r.subform ?? ''}@@${responseId}`;
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
  const rows = new Map<string, Pick<ChunkEntity, 'unitid' | 'key' | 'type' | 'ts' | 'variables'>>();
  const add = (key: string, type: string, ts: number, variables: string[]) => {
    const list = [...new Set(variables.map(v => v.trim()).filter(Boolean))].join(',');
    rows.set(JSON.stringify([key, type, ts, list]), {
      unitid, key, type, ts, variables: list
    });
  };
  for (const chunk of chunks) {
    if (!incoming.has(chunk.id)) incoming.set(chunk.id, new Set());
    const variables = chunk.variables || [];
    variables.forEach(v => incoming.get(chunk.id)!.add(v.trim()));
    add(chunk.id, String(chunk.type || '').trim(), Number(chunk.ts) || 0, variables);
  }
  for (const chunk of previous) {
    const missing = (chunk.variables || '').split(',').map(v => v.trim()).filter(v => v && !incoming.get(chunk.key)?.has(v));
    if (missing.length) add(chunk.key, chunk.type, chunk.ts, missing);
  }
  return Array.from(rows.values());
}
