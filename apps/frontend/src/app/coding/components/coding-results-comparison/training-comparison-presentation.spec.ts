import {
  modalValueSummary, comparisonPresentation, comparisonStatus, selectedCodeSlots
} from './training-comparison-presentation';
import type { ComparisonSelection } from './training-comparison-presentation';
import type { TrainingComparison, WithinTrainingComparison } from './comparison-view.models';

describe('training comparison presentation', () => {
  const within: WithinTrainingComparison = {
    responseId: 1,
    unitName: 'UNIT',
    variableId: 'VAR',
    coders: [
      {
        jobId: 2, coderName: 'B', code: '0', score: 0
      },
      {
        jobId: 1, coderName: 'A', code: '0', score: 0
      },
      {
        jobId: 3, coderName: 'C', code: '9', score: 9
      }
    ]
  };
  const selection: ComparisonSelection = {
    mode: 'within-training', trainingIds: [], coderKeys: [], jobIds: [1, 2]
  };

  it('compares only the selected sources and preserves zero codes and selection order', () => {
    expect(comparisonPresentation(within, selection).status).toBe('match');
    expect(comparisonPresentation(within, { ...selection, jobIds: [1, 3] }).status).toBe('differ');
    expect(selectedCodeSlots(within, selection)).toEqual([
      { code: '0', hasEntry: true }, { code: '0', hasEntry: true }
    ]);
    expect(within.coders.map(coder => coder.jobId)).toEqual([2, 1, 3]);
  });

  it('distinguishes uncomparable and incomplete rows, including missing entries', () => {
    expect(comparisonPresentation(within, { ...selection, jobIds: [1] }).status).toBe('not_comparable');
    expect(comparisonPresentation(within, { ...selection, jobIds: [1, 99] }).status).toBe('incomplete');
    expect(comparisonStatus([{ code: '1', hasEntry: true }, { code: null, hasEntry: true }])).toBe('incomplete');
  });

  it('keeps a selected training without a chosen coder incomplete', () => {
    const row: TrainingComparison = {
      responseId: 1,
      unitName: 'UNIT',
      variableId: 'VAR',
      personCode: '',
      personLogin: '',
      personGroup: '',
      testPerson: '',
      coders: [{
        trainingId: 1, trainingLabel: 'A', coderId: 10, coderName: 'A', code: '1', score: 1
      }]
    };
    const between: ComparisonSelection = {
      mode: 'between-trainings', trainingIds: [1, 2], coderKeys: ['1_10'], jobIds: []
    };
    expect(comparisonPresentation(row, between)).toEqual({
      status: 'incomplete', icon: 'warning', tooltipKey: 'coding.trainings.compare.status-incomplete'
    });
  });
});

describe('modal code calculation', () => {
  it('ignores missing codes and breaks numeric ties deterministically', () => {
    const coders = ['10', '2', null].map((code, jobId) => ({
      code, jobId, coderName: 'Coder', score: null
    }));
    expect(modalValueSummary(coders)).toEqual({
      modalValue: '2', deviationCount: 1, validCount: 2, isTie: true
    });
    expect(modalValueSummary([])).toEqual({
      modalValue: null, deviationCount: null, validCount: 0, isTie: false
    });
  });
});
