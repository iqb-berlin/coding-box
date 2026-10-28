import { TrainingComparison, WithinTrainingComparison, ComparisonCoderResult } from './comparison-view.models';
import type { ReviewCodeSelection } from '../../../replay/services/units-replay.service';
import { normalizeTestperson } from '../../../replay/utils/token-utils';

export interface ReplayRowReference {
  testPerson: string;
  unitId: string;
  variableId: string;
  responseId?: number;
}

const standaloneCodingIssueOptionIds = new Set([-3, -4]);

function getReviewSelectionCodes(coder: ComparisonCoderResult): number[] {
  if (
    coder.codingIssueOption !== null &&
    coder.codingIssueOption !== undefined &&
    standaloneCodingIssueOptionIds.has(coder.codingIssueOption)
  ) {
    return [coder.codingIssueOption];
  }

  const codes = new Set<number>();
  const code = parseReviewCode(coder.code);
  if (code !== null) {
    codes.add(code);
  }
  if (coder.codingIssueOption !== null && coder.codingIssueOption !== undefined) {
    codes.add(coder.codingIssueOption);
  }
  return Array.from(codes);
}

function parseReviewCode(code: string | null): number | null {
  const trimmedCode = code?.trim();
  if (!trimmedCode) {
    return null;
  }

  const parsedCode = Number(trimmedCode);
  return Number.isFinite(parsedCode) ? parsedCode : null;
}

export function reviewCodeSelections(comparison: TrainingComparison | WithinTrainingComparison, sourceLabel: (coder: ComparisonCoderResult) => string): ReviewCodeSelection[] {
  const coderNamesByCode = new Map<number, string[]>();

  comparison.coders.forEach(coder => {
    const coderName = sourceLabel(coder);
    getReviewSelectionCodes(coder).forEach(code => {
      const coderNames = coderNamesByCode.get(code) || [];
      if (!coderNames.includes(coderName)) {
        coderNames.push(coderName);
      }
      coderNamesByCode.set(code, coderNames);
    });
  });

  return Array.from(coderNamesByCode.entries())
    .sort(([codeA], [codeB]) => codeA - codeB)
    .map(([code, coderNames]) => ({ code, coderNames }));
}

export function findReplayRow(
  rows: WithinTrainingComparison[], data: ReplayRowReference
): WithinTrainingComparison | null {
  const targetVarId = (data.variableId || '').toLowerCase();
  const targetUnitId = (data.unitId || '').toLowerCase();
  const normalizedMsgTP = normalizeTestperson(data.testPerson || '').toLowerCase();

  // 1. Primary match: responseId (most reliable)
  let row = data.responseId ? rows.find(d => d.responseId === data.responseId &&
    (d.variableId || '').toLowerCase() === targetVarId
  ) : null;

  // 2. Fallback match: unitName + variableId + testperson
  if (!row) {
    row = rows.find(d => {
      const rowUnitId = (d.unitName || '').toLowerCase();
      const rowVarId = (d.variableId || '').toLowerCase();
      const rowTP = normalizeTestperson(d.testperson || '').toLowerCase();
      return rowUnitId === targetUnitId && rowVarId === targetVarId && rowTP === normalizedMsgTP;
    });
  }

  return row || null;
}
