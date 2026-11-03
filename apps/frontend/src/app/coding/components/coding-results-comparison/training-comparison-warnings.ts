import { UiTranslator } from '../../../shared/utils/ui-translator';

export interface ComparisonWarning {
  icon: string;
  text: string;
  severity: 'info' | 'warn';
}

export interface ComparisonWarningState {
  totalItems: number;
  noSelectedCoders: boolean;
  selectedSourceCount: number;
  trainingsWithoutCodesLabel: string;
  incompleteComparisons: number;
  mode: 'within-training' | 'between-trainings';
  withinTrainingRowCount: number;
  totalComparisons: number;
}

export function trainingComparisonWarnings(state: ComparisonWarningState, translate: UiTranslator): ComparisonWarning[] {
  const warnings: ComparisonWarning[] = [];
  const selectedSourceCount = state.selectedSourceCount;

  if (state.totalItems === 0 && !state.noSelectedCoders) {
    return warnings;
  }

  if (selectedSourceCount === 0) {
    warnings.push({
      icon: 'person_off',
      text: translate('coding.trainings.compare.warning-no-coders'),
      severity: 'info'
    });
  } else if (selectedSourceCount === 1) {
    warnings.push({
      icon: 'person',
      text: translate('coding.trainings.compare.warning-one-coder'),
      severity: 'warn'
    });
  }

  const trainingsWithoutCodes = state.trainingsWithoutCodesLabel;
  if (trainingsWithoutCodes.length > 0) {
    warnings.push({
      icon: 'playlist_remove',
      text: translate('coding.trainings.compare.warning-no-codes', { trainings: trainingsWithoutCodes }),
      severity: 'warn'
    });
  }

  if (selectedSourceCount >= 2 && state.incompleteComparisons > 0) {
    warnings.push({
      icon: 'warning',
      text: translate(
        state.incompleteComparisons === 1 ? 'coding.trainings.compare.warning-incomplete-one' :
          'coding.trainings.compare.warning-incomplete-many',
        { count: state.incompleteComparisons }
      ),
      severity: 'warn'
    });
  }

  if (
    state.mode === 'within-training' &&
      selectedSourceCount >= 2 &&
      state.withinTrainingRowCount > 0 &&
      state.totalComparisons === 0 &&
      state.incompleteComparisons > 0
  ) {
    warnings.push({
      icon: 'pending_actions',
      text: translate('coding.trainings.compare.warning-no-complete-pairs'),
      severity: 'warn'
    });
  }

  return warnings;
}
