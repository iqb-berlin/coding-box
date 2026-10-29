import { WithinTrainingComparison } from './comparison-view.models';

export function discussionScoreFromKnownCodes(comparison: WithinTrainingComparison, codeAsNumber: number): number | null {
  const matchedCoder = comparison.coders.find(c => c.code !== null && parseInt(c.code, 10) === codeAsNumber && c.score !== null);
  if (matchedCoder) {
    return matchedCoder.score;
  }

  if (comparison.replayCode !== null && comparison.replayCode !== undefined && comparison.replayCode === codeAsNumber) {
    return comparison.replayScore ?? null;
  }

  if (codeAsNumber < 0) {
    return 0;
  }

  return null;
}

export function parseDiscussionCode(value: string): number | null | undefined {
  const normalized = (value || '').trim();
  if (!normalized) {
    return null;
  }

  if (!/^-?\d+$/.test(normalized)) {
    return undefined;
  }

  return parseInt(normalized, 10);
}

export function isUnchangedDiscussionValue(
  comparison: WithinTrainingComparison,
  parsedCode: number | null,
  score: number | null,
  notes: string | null,
  scoreOverride?: number | null
): boolean {
  if (scoreOverride !== undefined) {
    return false;
  }

  return parsedCode === (comparison.discussionCode ?? null) &&
    score === (comparison.discussionScore ?? null) &&
    notes === ((comparison.discussionNotes || '').trim() || null);
}

export function mapDiscussionCodeForDisplay(code: string | number | null | undefined): string {
  if (code === null || code === undefined || code === '') {
    return '';
  }
  const codeNum = typeof code === 'string' ? parseInt(code, 10) : code;
  if (Number.isNaN(codeNum)) {
    return String(code);
  }
  if (codeNum === -1 || codeNum === -2) {
    return '';
  }
  return String(codeNum);
}
