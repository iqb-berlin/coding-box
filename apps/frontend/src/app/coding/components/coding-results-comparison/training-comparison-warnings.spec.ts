import { translateGerman } from '../../../../testing/german-translations';
import { ComparisonWarningState, trainingComparisonWarnings } from './training-comparison-warnings';

describe('training comparison warnings', () => {
  const state: ComparisonWarningState = {
    totalItems: 3, noSelectedCoders: false, selectedSourceCount: 2, trainingsWithoutCodesLabel: '', incompleteComparisons: 1, mode: 'within-training', withinTrainingRowCount: 3, totalComparisons: 0
  };
  it('explains missing pairs when selected coders have incomplete results', () => {
    expect(trainingComparisonWarnings(state, translateGerman).map(warning => warning.icon)).toEqual(['warning', 'pending_actions']);
    expect(trainingComparisonWarnings({ ...state, mode: 'between-trainings' }, translateGerman).map(warning => warning.icon)).toEqual(['warning']);
  });
  it('separates an empty dataset from deselected coders and missing training codes', () => {
    expect(trainingComparisonWarnings({ ...state, totalItems: 0 }, translateGerman)).toEqual([]);
    expect(trainingComparisonWarnings({
      ...state, totalItems: 0, noSelectedCoders: true, selectedSourceCount: 0, trainingsWithoutCodesLabel: 'Training A'
    }, translateGerman).map(warning => warning.icon)).toEqual(['person_off', 'playlist_remove']);
  });
});
