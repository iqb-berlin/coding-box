import {
  discussionScoreFromKnownCodes, isUnchangedDiscussionValue, mapDiscussionCodeForDisplay, parseDiscussionCode
} from './training-discussion-values';
import { WithinTrainingComparison } from './comparison-view.models';

describe('discussion value rules', () => {
  const row: WithinTrainingComparison = {
    responseId: 1,
    unitName: 'UNIT',
    variableId: 'V',
    replayCode: 2,
    replayScore: 4,
    discussionCode: 1,
    discussionScore: 3,
    discussionNotes: ' note ',
    coders: [{
      jobId: 1, coderName: 'A', code: '1', score: 3
    }]
  };

  it.each([['', null], ['  ', null], ['-4', -4], ['12', 12], ['1.5', undefined], ['1tail', undefined]])('parses %s strictly', (value, expected) => {
    expect(parseDiscussionCode(value as string)).toBe(expected);
  });

  it('prefers coder scores, then replay scores, then issue defaults', () => {
    expect(discussionScoreFromKnownCodes(row, 1)).toBe(3);
    expect(discussionScoreFromKnownCodes(row, 2)).toBe(4);
    expect(discussionScoreFromKnownCodes(row, -3)).toBe(0);
    expect(discussionScoreFromKnownCodes(row, 99)).toBeNull();
  });

  it('preserves the legacy display of uncertain codes and an explicit null score override', () => {
    expect(mapDiscussionCodeForDisplay(-1)).toBe('');
    expect(mapDiscussionCodeForDisplay(-2)).toBe('');
    expect(mapDiscussionCodeForDisplay(-3)).toBe('-3');
    expect(isUnchangedDiscussionValue(row, 1, 3, 'note')).toBe(true);
    expect(isUnchangedDiscussionValue(row, 1, 3, 'note', null)).toBe(false);
  });
});
