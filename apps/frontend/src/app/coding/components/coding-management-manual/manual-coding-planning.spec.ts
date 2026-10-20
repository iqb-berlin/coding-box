import { ManualCodingPlanning, ManualCodingPlanningState } from './manual-coding-planning';

const state = (changes: Partial<ManualCodingPlanningState> = {}): ManualCodingPlanningState => ({
  activeManualTab: 'planning',
  hasLoadedPlanningDataBundle: true,
  isPlanningStatusLoading: false,
  shouldRequirePlanningDataRefresh: false,
  hasPreparationRefreshTarget: false,
  hasManualCodeAvailabilityWarnings: false,
  hasVariableCoverageConflicts: false,
  variableCoverageOverview: null,
  caseCoverageOverview: null,
  codingProgressOverview: null,
  appliedResultsOverview: null,
  isPlanningReady: false,
  hasActiveTrainingCodingJobs: false,
  hasExecutionOpenWorkForFreshness: false,
  hasOpenDoubleCodingReviewConflicts: false,
  hasStaleSourceManualJobs: false,
  isCompletionComplete: false,
  hasCompletionReadyWorkForFreshness: false,
  canShowManualCompletionTab: true,
  isResponseAnalysisOutdated: false,
  manualCodeAvailabilityWarningCount: 0,
  manualFreshnessJobSummary: null,
  openDoubleCodingConflictCount: 0,
  getAvailableCasesForNewJobs: 0,
  getUnavailableCasesForNewJobs: 0,
  ...changes
});

describe('manual coding planning decisions', () => {
  it.each([
    [{ activeManualTab: 'preparation', hasLoadedPlanningDataBundle: false }, 'not-checked'],
    [{ isPlanningStatusLoading: true, hasPreparationRefreshTarget: true }, 'loading'],
    [{ shouldRequirePlanningDataRefresh: true, hasPreparationRefreshTarget: true }, 'planning-data-required'],
    [{ hasPreparationRefreshTarget: true, hasManualCodeAvailabilityWarnings: true }, 'preparation-required'],
    [{ hasManualCodeAvailabilityWarnings: true, isPlanningReady: true }, 'warning'],
    [{ isPlanningReady: true, hasActiveTrainingCodingJobs: true, hasOpenDoubleCodingReviewConflicts: true }, 'training-ready'],
    [{ isPlanningReady: true, hasOpenDoubleCodingReviewConflicts: true, hasStaleSourceManualJobs: true }, 'double-coding-review-ready'],
    [{ isPlanningReady: true, hasStaleSourceManualJobs: true, isCompletionComplete: true }, 'stale-source-review'],
    [{ isCompletionComplete: true }, 'complete'],
    [{ isPlanningReady: true }, 'progress-unavailable']
  ] as Array<[Partial<ManualCodingPlanningState>, string]>)('preserves planning priority for %p', (changes, expected) => {
    expect(new ManualCodingPlanning(state(changes)).getPlanningStatusState()).toBe(expected);
  });

  it('keeps coverage conflicts visually stronger than missing manual codes', () => {
    const planning = new ManualCodingPlanning(state({ hasManualCodeAvailabilityWarnings: true, hasVariableCoverageConflicts: true }));
    expect(planning.getPlanningStatusClass()).toBe('status-warning');
    expect(planning.getPlanningNextStepTargetSection()).toBe('manual-planning');
  });

  it('routes completion guidance for a user without apply rights to execution', () => {
    const input = Object.freeze(state({ isCompletionComplete: true, canShowManualCompletionTab: false }));
    const planning = new ManualCodingPlanning(input);
    expect(planning.getPlanningNextStepTargetTab()).toBe('execution');
    expect(input.canShowManualCompletionTab).toBe(false);
  });
});
