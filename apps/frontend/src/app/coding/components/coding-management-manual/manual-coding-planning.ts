import { UiTranslator } from '../../../shared/utils/ui-translator';
import type { ManualCodingPlanningSnapshot } from '../../services/manual-coding-planning-snapshot.model';

export type PlanningStatusState =
  'not-checked' |
  'loading' |
  'planning-data-required' |
  'preparation-required' |
  'warning' |
  'planning-incomplete' |
  'planning-ready' |
  'training-ready' |
  'execution-ready' |
  'double-coding-review-ready' |
  'stale-source-review' |
  'completion-ready' |
  'progress-unavailable' |
  'complete';

export type ManualCodingTab = 'preparation' | 'planning' | 'training' | 'execution' | 'completion';

export interface ManualFreshnessTarget {
  tab: ManualCodingTab;
  sectionId: string;
  action: 'navigate' | 'double-coding-review';
}

export interface ManualCodingPlanningState {
  hasVariableCoverageConflicts: boolean;
  hasManualCodeAvailabilityWarnings: boolean;
  activeManualTab: ManualCodingTab;
  hasLoadedPlanningDataBundle: boolean;
  isPlanningStatusLoading: boolean;
  shouldRequirePlanningDataRefresh: boolean;
  hasPreparationRefreshTarget: boolean;
  variableCoverageOverview: ManualCodingPlanningSnapshot['variableCoverageOverview'];
  caseCoverageOverview: ManualCodingPlanningSnapshot['caseCoverageOverview'];
  isPlanningReady: boolean;
  hasActiveTrainingCodingJobs: boolean;
  codingProgressOverview: ManualCodingPlanningSnapshot['codingProgressOverview'];
  hasExecutionOpenWorkForFreshness: boolean;
  hasOpenDoubleCodingReviewConflicts: boolean;
  hasStaleSourceManualJobs: boolean;
  isCompletionComplete: boolean;
  appliedResultsOverview: ManualCodingPlanningSnapshot['appliedResultsOverview'];
  hasCompletionReadyWorkForFreshness: boolean;
  canShowManualCompletionTab: boolean;
  isResponseAnalysisOutdated: boolean;
  manualCodeAvailabilityWarningCount: number;
  manualFreshnessJobSummary: ManualCodingPlanningSnapshot['manualFreshnessJobSummary'];
  openDoubleCodingConflictCount: number;
  getAvailableCasesForNewJobs: number;
  getUnavailableCasesForNewJobs: number;
}

/** Pure planning decisions and their presentation, independent of requests and Angular. */
export class ManualCodingPlanning {
  constructor(private readonly state: ManualCodingPlanningState, private readonly translate: UiTranslator) {}

  getPlanningStatusClass(): string {
    switch (this.getPlanningStatusState()) {
      case 'warning':
        if (this.state.hasVariableCoverageConflicts) {
          return 'status-warning';
        }
        if (this.state.hasManualCodeAvailabilityWarnings) {
          return 'status-attention';
        }
        return 'status-warning';
      case 'planning-incomplete':
      case 'preparation-required':
      case 'double-coding-review-ready':
      case 'stale-source-review':
      case 'completion-ready':
      case 'progress-unavailable':
        return 'status-attention';
      case 'complete':
        return 'status-complete';
      case 'not-checked':
      case 'loading':
      case 'planning-data-required':
      case 'planning-ready':
      case 'training-ready':
      case 'execution-ready':
      default:
        return 'status-ready';
    }
  }

  getPlanningStatusState(): PlanningStatusState {
    if (this.state.activeManualTab !== 'planning' &&
      !this.state.hasLoadedPlanningDataBundle) {
      return 'not-checked';
    }

    if (this.state.isPlanningStatusLoading) {
      return 'loading';
    }

    if (this.state.shouldRequirePlanningDataRefresh) {
      return 'planning-data-required';
    }

    if (this.state.hasPreparationRefreshTarget) {
      return 'preparation-required';
    }

    if (this.state.hasManualCodeAvailabilityWarnings) {
      return 'warning';
    }

    if (this.state.hasVariableCoverageConflicts) {
      return 'warning';
    }

    if ((this.state.variableCoverageOverview?.missingVariables || 0) > 0 ||
        (this.state.caseCoverageOverview?.effectiveUnassignedCases || 0) > 0) {
      return 'planning-incomplete';
    }

    if (this.state.isPlanningReady && this.state.hasActiveTrainingCodingJobs) {
      return 'training-ready';
    }

    if (this.state.isPlanningReady &&
        !!this.state.codingProgressOverview &&
        this.state.hasExecutionOpenWorkForFreshness) {
      return 'execution-ready';
    }

    if (this.state.isPlanningReady && this.state.hasOpenDoubleCodingReviewConflicts) {
      return 'double-coding-review-ready';
    }

    if (this.state.isPlanningReady && this.state.hasStaleSourceManualJobs) {
      return 'stale-source-review';
    }

    if (this.state.isCompletionComplete) {
      return 'complete';
    }

    if (this.state.isPlanningReady &&
        !!this.state.codingProgressOverview &&
        !!this.state.appliedResultsOverview &&
        this.state.hasCompletionReadyWorkForFreshness) {
      return 'completion-ready';
    }

    if (this.state.isPlanningReady && !this.state.codingProgressOverview) {
      return 'progress-unavailable';
    }

    return 'planning-ready';
  }

  getPlanningStatusIcon(): string {
    switch (this.getPlanningStatusState()) {
      case 'not-checked':
        return 'help_outline';
      case 'loading':
        return 'sync';
      case 'planning-data-required':
        return 'refresh';
      case 'warning':
        return 'warning';
      case 'preparation-required':
        return 'tune';
      case 'planning-incomplete':
        return 'assignment_late';
      case 'training-ready':
        return 'school';
      case 'execution-ready':
        return 'play_circle';
      case 'double-coding-review-ready':
        return 'compare';
      case 'stale-source-review':
        return 'sync_problem';
      case 'completion-ready':
        return 'published_with_changes';
      case 'progress-unavailable':
        return 'sync_problem';
      case 'complete':
        return 'check_circle';
      default:
        return 'route';
    }
  }

  getPlanningStatusTitle(): string {
    switch (this.getPlanningStatusState()) {
      case 'not-checked':
        return this.translate('ui-text.manual-coding-planning.status-not-checked');
      case 'loading':
        return this.translate('ui-text.manual-coding-planning.status-loading');
      case 'planning-data-required':
        return this.translate('coding-management-manual.buttons.refresh-planning-aria');
      case 'warning':
        return this.state.hasVariableCoverageConflicts ?
          this.translate('ui-text.manual-coding-planning.status-conflicts') :
          this.translate('ui-text.manual-coding-planning.status-manual-codes');
      case 'preparation-required':
        return this.translate('ui-text.manual-coding-planning.status-stale-preparation');
      case 'planning-incomplete':
        return this.translate('ui-text.manual-coding-planning.status-incomplete');
      case 'training-ready':
        return this.translate('ui-text.manual-coding-planning.status-training-active');
      case 'execution-ready':
        return this.translate('ui-text.manual-coding-planning.status-execution-ready');
      case 'double-coding-review-ready':
        return this.translate('ui-text.manual-coding-planning.status-review-pending');
      case 'stale-source-review':
        return this.translate('ui-text.manual-coding-planning.status-stale-jobs');
      case 'completion-ready':
        return this.state.canShowManualCompletionTab ?
          this.translate('ui-text.manual-coding-planning.status-completion-ready') :
          this.translate('ui-text.manual-coding-planning.status-cases-complete');
      case 'progress-unavailable':
        return this.translate('ui-text.manual-coding-planning.status-progress-unavailable');
      case 'complete':
        return this.translate('ui-text.manual-coding-planning.status-complete');
      default:
        return this.translate('ui-text.manual-coding-planning.status-planning-ready');
    }
  }

  getPlanningStatusDescription(): string {
    const planningStatusState = this.getPlanningStatusState();

    if (planningStatusState === 'not-checked') {
      return this.translate('ui-text.manual-coding-planning.description-not-checked');
    }

    if (planningStatusState === 'loading') {
      return this.translate('ui-text.manual-coding-planning.description-loading');
    }

    if (planningStatusState === 'planning-data-required') {
      return this.translate('ui-text.manual-coding-planning.description-on-demand');
    }

    if (planningStatusState === 'progress-unavailable') {
      return this.translate('ui-text.manual-coding-planning.description-progress-unavailable');
    }

    if (planningStatusState === 'preparation-required') {
      if (this.state.isResponseAnalysisOutdated) {
        return this.translate('ui-text.manual-coding-planning.description-stale-analysis');
      }
      return this.translate('ui-text.manual-coding-planning.description-preparation-open');
    }

    if (this.state.hasVariableCoverageConflicts) {
      return this.translate('ui-text.manual-coding-planning.description-conflicts', { value1: this.state.variableCoverageOverview?.conflictedVariables || 0 });
    }

    if (this.state.hasManualCodeAvailabilityWarnings) {
      return this.translate('ui-text.manual-coding-planning.description-manual-codes', { value1: this.state.manualCodeAvailabilityWarningCount });
    }

    if ((this.state.variableCoverageOverview?.missingVariables || 0) > 0) {
      return this.translate('ui-text.manual-coding-planning.description-missing-variables', { value1: this.state.variableCoverageOverview?.missingVariables || 0 });
    }

    if ((this.state.caseCoverageOverview?.effectiveUnassignedCases || 0) > 0) {
      return this.translate('ui-text.manual-coding-planning.description-undistributed-cases', { value1: this.state.caseCoverageOverview?.effectiveUnassignedCases || 0 });
    }

    if (this.state.isCompletionComplete) {
      return this.translate('ui-text.manual-coding-planning.description-complete');
    }

    if (this.state.isPlanningReady &&
        this.state.hasActiveTrainingCodingJobs) {
      return this.translate('ui-text.manual-coding-planning.description-training-active', { value1: this.state.manualFreshnessJobSummary?.activeTrainingJobs || 0 });
    }

    if (this.state.isPlanningReady &&
        !!this.state.codingProgressOverview &&
        this.state.hasExecutionOpenWorkForFreshness) {
      return this.translate('ui-text.manual-coding-planning.description-execution-ready');
    }

    if (this.state.isPlanningReady && this.state.hasOpenDoubleCodingReviewConflicts) {
      return this.translate('ui-text.manual-coding-planning.description-review-pending', { value1: this.state.openDoubleCodingConflictCount });
    }

    if (this.state.isPlanningReady && this.state.hasStaleSourceManualJobs) {
      return this.translate('ui-text.manual-coding-planning.description-stale-jobs', { value1: this.state.manualFreshnessJobSummary?.staleSourceJobs || 0 });
    }

    if (this.state.isPlanningReady &&
        !!this.state.codingProgressOverview &&
        !!this.state.appliedResultsOverview &&
        this.state.hasCompletionReadyWorkForFreshness) {
      return this.state.canShowManualCompletionTab ?
        this.translate('ui-text.manual-coding-planning.description-apply-ready') :
        this.translate('ui-text.manual-coding-planning.description-cases-complete');
    }

    return this.translate('ui-text.manual-coding-planning.description-planning-ready');
  }

  getPlanningNextStepTitle(): string {
    switch (this.getPlanningStatusState()) {
      case 'not-checked':
        return this.translate('coding.schemer.check-coding-status');
      case 'loading':
        return this.translate('ui-text.manual-coding-planning.loading-plan');
      case 'planning-data-required':
        return this.translate('ui-text.manual-coding-planning.load-plan');
      case 'warning':
        return this.state.hasVariableCoverageConflicts ?
          this.translate('ui-text.manual-coding-planning.resolve-conflicts') :
          this.translate('ui-text.manual-coding-planning.add-manual-codes');
      case 'preparation-required':
        return this.translate('ui-text.manual-coding-planning.status-stale-preparation');
      case 'planning-incomplete':
        return this.translate('ui-text.manual-coding-planning.distribute-cases');
      case 'training-ready':
        return this.translate('ui-text.manual-coding-planning.review-training');
      case 'execution-ready':
        return this.translate('ui-text.manual-coding-planning.execute-jobs');
      case 'double-coding-review-ready':
        return this.translate('ui-text.manual-coding-planning.resolve-double-coding');
      case 'stale-source-review':
        return this.translate('ui-text.manual-coding-planning.review-stale-jobs');
      case 'completion-ready':
        return this.state.canShowManualCompletionTab ?
          this.translate('ui-text.manual-coding-planning.apply-results') :
          this.translate('ui-text.manual-coding-planning.review-jobs');
      case 'complete':
        return this.translate('ui-text.manual-coding-planning.workflow-complete');
      case 'progress-unavailable':
        return this.translate('ui-text.manual-coding-planning.check-progress');
      default:
        return this.translate('ui-text.manual-coding-planning.create-definition');
    }
  }

  getPlanningNextStepDescription(): string {
    const availableCases = this.state.getAvailableCasesForNewJobs;
    const unavailableCases = this.state.getUnavailableCasesForNewJobs;

    switch (this.getPlanningStatusState()) {
      case 'not-checked':
        return this.translate('ui-text.manual-coding-planning.hint-not-checked');
      case 'loading':
        return this.translate('ui-text.manual-coding-planning.hint-loading');
      case 'planning-data-required':
        return this.translate('ui-text.manual-coding-planning.hint-on-demand');
      case 'warning':
        if (this.state.hasVariableCoverageConflicts) {
          return this.translate('ui-text.manual-coding-planning.hint-conflicts');
        }
        return this.translate('ui-text.manual-coding-planning.hint-manual-codes');
      case 'preparation-required':
        return this.state.isResponseAnalysisOutdated ?
          this.translate('ui-text.manual-coding-planning.hint-stale-analysis') :
          this.translate('ui-text.manual-coding-planning.hint-preparation-open');
      case 'planning-incomplete':
        if ((this.state.caseCoverageOverview?.effectiveUnassignedCases || 0) > 0) {
          const unavailableHint = unavailableCases > 0 ?
            this.translate('ui-text.manual-coding-planning.hint-reserved-cases', { value1: unavailableCases }) :
            '';
          return this.translate('ui-text.manual-coding-planning.hint-available-cases', { value1: this.state.caseCoverageOverview?.effectiveUnassignedCases || 0, value2: availableCases, value3: unavailableHint });
        }
        return this.translate('ui-text.manual-coding-planning.hint-missing-variables');
      case 'training-ready':
        return this.translate('ui-text.manual-coding-planning.hint-training-active');
      case 'execution-ready':
        return this.translate('ui-text.manual-coding-planning.hint-execution-ready');
      case 'double-coding-review-ready':
        return this.translate('ui-text.manual-coding-planning.hint-review-pending');
      case 'stale-source-review':
        return this.translate('ui-text.manual-coding-planning.hint-stale-jobs');
      case 'completion-ready':
        return this.state.canShowManualCompletionTab ?
          this.translate('ui-text.manual-coding-planning.hint-apply-ready') :
          this.translate('ui-text.manual-coding-planning.hint-cases-complete');
      case 'complete':
        return this.translate('ui-text.manual-coding-planning.hint-complete');
      case 'progress-unavailable':
        return this.translate('ui-text.manual-coding-planning.hint-progress-unavailable');
      default:
        return this.translate('ui-text.manual-coding-planning.hint-create-definition');
    }
  }

  getPlanningNextStepActionLabel(): string {
    switch (this.getPlanningStatusState()) {
      case 'not-checked':
        return this.translate('ui-text.manual-coding-planning.open-planning');
      case 'warning':
        return this.state.hasVariableCoverageConflicts ?
          this.translate('ui-text.manual-coding-planning.open-definitions') :
          this.translate('ui-text.manual-coding-planning.show-affected-variables');
      case 'preparation-required':
        return this.translate('ui-text.manual-coding-planning.open-preparation');
      case 'training-ready':
        return this.translate('ui-text.manual-coding-planning.open-training');
      case 'execution-ready':
        return this.translate('ui-text.manual-coding-completion-view.open-jobs');
      case 'double-coding-review-ready':
        return this.translate('ui-text.manual-coding-planning.open-double-coding-review');
      case 'stale-source-review':
        return this.translate('ui-text.manual-coding-planning.review-stale-jobs');
      case 'completion-ready':
        return this.state.canShowManualCompletionTab ? this.translate('ui-text.manual-coding-planning.open-completion') : this.translate('ui-text.manual-coding-completion-view.open-jobs');
      case 'complete':
        return this.state.canShowManualCompletionTab ? this.translate('ui-text.manual-coding-planning.view-completion') : this.translate('ui-text.manual-coding-completion-view.open-jobs');
      case 'loading':
      case 'planning-data-required':
      case 'progress-unavailable':
        return this.translate('process-overview.refresh');
      default:
        return this.translate('ui-text.manual-coding-planning.open-definitions');
    }
  }

  getPlanningNextStepTargetSection(): string {
    return this.getPlanningNextStepTarget().sectionId;
  }

  getPlanningNextStepTargetTab(): ManualCodingTab {
    return this.getPlanningNextStepTarget().tab;
  }

  getPlanningNextStepTarget(): ManualFreshnessTarget {
    switch (this.getPlanningStatusState()) {
      case 'preparation-required':
        return {
          tab: 'preparation',
          sectionId: 'manual-preparation',
          action: 'navigate'
        };
      case 'warning':
        return {
          tab: 'planning',
          sectionId: this.state.hasVariableCoverageConflicts ?
            'manual-planning' :
            'manual-variable-coverage',
          action: 'navigate'
        };
      case 'training-ready':
        return {
          tab: 'training',
          sectionId: 'manual-support',
          action: 'navigate'
        };
      case 'execution-ready':
        return {
          tab: 'execution',
          sectionId: 'manual-execution',
          action: 'navigate'
        };
      case 'double-coding-review-ready':
        return {
          tab: 'execution',
          sectionId: 'manual-execution',
          action: 'double-coding-review'
        };
      case 'stale-source-review':
        // stale_source jobs are intentionally routed to Durchführung: users inspect
        // the outdated source jobs there before any refresh or apply action.
        return {
          tab: 'execution',
          sectionId: 'manual-execution',
          action: 'navigate'
        };
      case 'completion-ready':
      case 'complete':
        return {
          tab: this.state.canShowManualCompletionTab ? 'completion' : 'execution',
          sectionId: this.state.canShowManualCompletionTab ? 'manual-completion' : 'manual-execution',
          action: 'navigate'
        };
      default:
        return {
          tab: 'planning',
          sectionId: 'manual-planning',
          action: 'navigate'
        };
    }
  }

  getPlanningNextStepIcon(): string {
    switch (this.getPlanningStatusState()) {
      case 'not-checked':
        return 'fact_check';
      case 'planning-data-required':
        return 'refresh';
      case 'warning':
        return 'warning';
      case 'preparation-required':
        return 'tune';
      case 'training-ready':
        return 'school';
      case 'execution-ready':
        return 'play_circle';
      case 'double-coding-review-ready':
        return 'compare';
      case 'stale-source-review':
        return 'sync_problem';
      case 'completion-ready':
      case 'complete':
        return 'published_with_changes';
      case 'loading':
      case 'progress-unavailable':
        return 'sync';
      default:
        return 'route';
    }
  }
}
