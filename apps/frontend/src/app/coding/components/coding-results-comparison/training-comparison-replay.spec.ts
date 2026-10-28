import { findReplayRow, reviewCodeSelections } from './training-comparison-replay';
import { WithinTrainingComparison } from './comparison-view.models';

describe('comparison replay mapping', () => {
  const row: WithinTrainingComparison = {
    responseId: 1,
    unitName: 'UNIT',
    variableId: 'V',
    testperson: 'login@code@group',
    coders: [
      {
        jobId: 1, coderName: 'A', code: '2', score: 1, codingIssueOption: -1
      },
      {
        jobId: 2, coderName: 'B', code: '2', score: 1
      },
      {
        jobId: 3, coderName: 'C', code: '2', score: 1, codingIssueOption: -3
      }
    ]
  };

  it('groups sorted code choices by coder and uses standalone issues instead of their stale code', () => {
    expect(reviewCodeSelections(row, coder => coder.coderName)).toEqual([
      { code: -3, coderNames: ['C'] }, { code: -1, coderNames: ['A'] }, { code: 2, coderNames: ['A', 'B'] }
    ]);
  });

  it('prefers response ids and falls back to normalized unit, variable and testperson', () => {
    expect(findReplayRow([row], {
      responseId: 1, unitId: 'other', variableId: 'v', testPerson: ''
    })).toBe(row);
    expect(findReplayRow([row], { unitId: 'unit', variableId: 'v', testPerson: 'login@code@group' })).toBe(row);
    expect(findReplayRow([row], {
      responseId: 1, unitId: 'unit', variableId: 'other', testPerson: ''
    })).toBeNull();
  });
});
