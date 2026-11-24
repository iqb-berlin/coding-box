import type { TrainingDiscussionExportResult } from './coding-export.types';

export function buildTrainingManagerExportRows(
  manualCoding: readonly (Record<string, unknown> & { trainingId: string; responseId: string })[],
  discussionResultMap: ReadonlyMap<string, TrainingDiscussionExportResult>
): Record<string, unknown>[] {
  const managerRows: Record<string, unknown>[] = [];
  const handledCases = new Set<string>();

  for (const row of manualCoding) {
    const trainingId = parseInt(row.trainingId, 10);
    const responseId = parseInt(row.responseId, 10);
    if (Number.isNaN(trainingId) || Number.isNaN(responseId)) continue;

    const caseKey = `${trainingId}|${responseId}`;
    if (handledCases.has(caseKey)) continue;
    handledCases.add(caseKey);

    const discussionResult = discussionResultMap.get(caseKey);
    if (!discussionResult?.managerUsername) continue;

    managerRows.push({
      ...row,
      username: discussionResult.managerUsername,
      cju_code: discussionResult.code,
      cju_score: discussionResult.score,
      code_v1: null,
      code_v2: null,
      code_v3: null,
      score_v1: null,
      score_v2: null,
      score_v3: null,
      autocoder_invalidated_version: null,
      notes: discussionResult.notes
    });
  }
  return managerRows;
}
