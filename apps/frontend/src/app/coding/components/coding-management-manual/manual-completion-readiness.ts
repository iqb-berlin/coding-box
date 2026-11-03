import { UiTranslator } from '../../../shared/utils/ui-translator';

export interface CompletionReadiness { complete: boolean; readyJobs: number; reviewJobs: number; executionOpen: boolean; }

export function completionReadinessTitle(state: CompletionReadiness, translate: UiTranslator): string {
  if (state.complete) {
    return translate('ui-text.coding-management-manual.results-applied');
  }

  if (state.readyJobs > 0) {
    if (state.reviewJobs > 0) {
      return translate('ui-text.coding-management-manual.ready-jobs-with-issues', { value1: state.readyJobs, value2: state.reviewJobs });
    }
    return translate('ui-text.coding-management-manual.ready-jobs', { value1: state.readyJobs });
  }

  if (state.reviewJobs > 0) {
    return translate('ui-text.coding-management-manual.jobs-require-review', { value1: state.reviewJobs });
  }

  if (state.executionOpen) {
    return translate('ui-text.coding-management-manual.execution-incomplete');
  }

  return translate('ui-text.coding-management-manual.no-ready-jobs');
}
