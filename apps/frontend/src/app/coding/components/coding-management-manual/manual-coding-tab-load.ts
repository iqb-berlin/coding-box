import type { ManualCodingTab } from './manual-coding-planning';

export type ManualCodingTabLoadAction =
  'response-analysis' | 'planning-bundle' | 'execution-statistics' | 'completion-statistics' |
  'reload-jobs' | 'reload-pending-jobs';

export function planManualCodingTabLoad(
  tab: ManualCodingTab,
  options: {
    hasPlanningSnapshot: boolean;
    deferStatusChecks: boolean;
    refreshPlanning: boolean;
    reloadCodingJobs: boolean;
  }
): ManualCodingTabLoadAction[] {
  const {
    hasPlanningSnapshot, deferStatusChecks, refreshPlanning, reloadCodingJobs
  } = options;
  const jobsAction = reloadCodingJobs ? 'reload-jobs' : 'reload-pending-jobs';

  switch (tab) {
    case 'preparation':
      return hasPlanningSnapshot ? [] : ['response-analysis'];
    case 'planning':
      return !hasPlanningSnapshot && !deferStatusChecks && refreshPlanning ? ['planning-bundle'] : [];
    case 'training':
      return [jobsAction];
    case 'execution':
      return deferStatusChecks ? [jobsAction] : ['execution-statistics', jobsAction];
    case 'completion':
      return ['completion-statistics'];
    default:
      return [];
  }
}
