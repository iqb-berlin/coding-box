import { computed, inject, Injectable } from '@angular/core';
import { ManualCodingAnalysisFacade } from './manual-coding-analysis.facade';
import { ManualCodingStatisticsFacade } from './manual-coding-statistics.facade';

/** Memoized domain summaries; the view owns navigation and user interactions. */
@Injectable()
export class ManualCodingSummaryFacade {
  private readonly statistics = inject(ManualCodingStatisticsFacade);
  private readonly analysis = inject(ManualCodingAnalysisFacade);
  private readonly codingProgressOverview = this.statistics.codingProgressOverview;
  private readonly appliedResultsOverview = this.statistics.appliedResultsOverview;
  private readonly codingIncompleteVariables = this.statistics.codingIncompleteVariables;
  private readonly caseCoverageOverview = this.statistics.caseCoverageOverview;
  private readonly variableCoverageOverview = this.statistics.variableCoverageOverview;
  private readonly manualCodingScopeSummary = this.statistics.manualCodingScopeSummary;
  private readonly completedJobsReadyForApply = this.statistics.completedJobsReadyForApply;
  private readonly completedJobsBlockedForReview = this.statistics.completedJobsBlockedForReview;
  private readonly manualCodeAvailabilityWarnings = this.statistics.manualCodeAvailabilityWarnings;
  private readonly hasManualCodeAvailabilityWarnings = computed(() => this.manualCodeAvailabilityWarnings().length > 0);
  private readonly responseAnalysis = this.analysis.responseAnalysis;
  private get manualFreshnessJobSummary() { return this.statistics.manualFreshnessJobSummary; }
  private get openDoubleCodingConflictCount() { return this.statistics.openDoubleCodingConflictCount; }

  readonly getOpenCodingCases = computed<number>(() => {
    const codingProgressOverviewValue = this.codingProgressOverview();

    if (codingProgressOverviewValue) {
      return Math.max(
        0,
        codingProgressOverviewValue.totalCasesToCode -
        codingProgressOverviewValue.completedCases
      );
    }

    return this.appliedResultsOverview()?.remainingResponses || 0;
  });

  readonly getAvailableCasesForNewJobs = computed<number>(() => {
    const availableCases = this.codingIncompleteVariables().reduce(
      (sum, variable) => sum + (
        variable.availableCases ??
        variable.uniqueCasesAfterAggregation ??
        variable.responseCount ??
        0
      ),
      0
    );

    if (this.caseCoverageOverview()?.effectiveUnassignedCases === 0) {
      return 0;
    }

    return availableCases;
  });

  readonly getUnavailableCasesForNewJobs = computed<number>(() => {
    const totalEffectiveCases = this.codingIncompleteVariables().reduce(
      (sum, variable) => sum + this.getVariableEffectiveCaseCount(variable),
      0
    );

    return Math.max(0, totalEffectiveCases - this.getAvailableCasesForNewJobs());
  });

  readonly getVariableCoveragePercentage = computed<number>(() => this.variableCoverageOverview()?.coveragePercentage || 0);

  readonly getAppliedResultsPercentage = computed<number>(() => this.appliedResultsOverview()?.completionPercentage || 0);

  readonly getCurrentRawManualResponses = computed<number>(() => this.appliedResultsOverview()?.rawTotalIncompleteResponses ??
      this.codingProgressOverview()?.rawTotalCasesToCode ??
      this.caseCoverageOverview()?.totalCasesToCode ??
      0);

  readonly getResponseAnalysisReferenceRawCases = computed<number>(() => this.codingProgressOverview()?.responseAnalysisRawCases ??
      this.caseCoverageOverview()?.responseAnalysisRawCases ??
      this.appliedResultsOverview()?.responseAnalysisRawCases ??
      this.getManualStatusPoolCount());

  readonly getManualStatusPoolCount = computed<number>(() => {
    const manualCodingScopeSummaryValue = this.manualCodingScopeSummary();

    return this.codingProgressOverview()?.statusTotalCasesToCode ??
      this.caseCoverageOverview()?.statusTotalCasesToCode ??
      this.appliedResultsOverview()?.statusTotalIncompleteResponses ??
      (manualCodingScopeSummaryValue ?
        manualCodingScopeSummaryValue.manualResponseCount +
        manualCodingScopeSummaryValue.coveredSourceResponseCount :
        0);
  });

  readonly getEffectiveManualCaseCount = computed<number>(() => this.codingProgressOverview()?.totalCasesToCode ??
      this.caseCoverageOverview()?.effectiveTotalCasesToCode ??
      this.appliedResultsOverview()?.totalIncompleteResponses ??
      0);

  readonly getManualCaseScopeSummaryText = computed<string>(() => {
    const statusPoolCount = this.getManualStatusPoolCount();
    const effectiveCaseCount = this.getEffectiveManualCaseCount();
    const openCaseCount = this.getOpenCodingCases();

    if (
      statusPoolCount <= 0 ||
      effectiveCaseCount <= 0 ||
      statusPoolCount === effectiveCaseCount
    ) {
      return '';
    }

    const difference = statusPoolCount - effectiveCaseCount;
    const reason = difference > 0 ?
      `${difference} Rohantworten werden durch abgeleitete Variablen, Vorverarbeitung oder Aggregation nicht separat verteilt.` :
      'Die effektive Fallzahl kann durch Mehrfachkodierung oder manuelle Nacharbeit abweichen.';
    const openCaseHint = openCaseCount !== effectiveCaseCount ?
      `, davon ${openCaseCount} offen` :
      '';

    return `${statusPoolCount} Rohantworten im Statuspool -> ${effectiveCaseCount} effektive Arbeitsfälle${openCaseHint}. ${reason}`;
  });

  readonly isResponseAnalysisOutdated = computed<boolean>(() => {
    const responseAnalysisSnapshot = this.responseAnalysis();

    const analysisRawCases = responseAnalysisSnapshot?.aggregationSummary?.rawCases ?? 0;
    const referenceRawCases = this.getResponseAnalysisReferenceRawCases();
    return !!responseAnalysisSnapshot &&
      !responseAnalysisSnapshot.isCalculating &&
      referenceRawCases > 0 &&
      analysisRawCases !== referenceRawCases;
  });

  readonly hasResponseAnalysisRestScopeDifference = computed<boolean>(() => {
    const responseAnalysisSnapshot = this.responseAnalysis();

    const analysisRawCases = responseAnalysisSnapshot?.aggregationSummary?.rawCases ?? 0;
    const currentRawManualResponses = this.getCurrentRawManualResponses();
    return !!responseAnalysisSnapshot &&
      !responseAnalysisSnapshot.isCalculating &&
      !this.isResponseAnalysisOutdated() &&
      currentRawManualResponses > 0 &&
      analysisRawCases !== currentRawManualResponses;
  });

  readonly hasPreparationWarnings = computed<boolean>(() => this.hasUncodedEmptyResponses() ||
      this.hasDuplicateFindingsWithoutAggregation());

  readonly isPreparationReady = computed<boolean>(() => {
    const responseAnalysisSnapshot = this.responseAnalysis();

    return !!responseAnalysisSnapshot &&
      !responseAnalysisSnapshot.isCalculating &&
      !this.hasPreparationWarnings();
  });

  readonly hasPlanningWarnings = computed<boolean>(() => this.hasManualCodeAvailabilityWarnings() ||
      (this.variableCoverageOverview()?.conflictedVariables || 0) > 0 ||
      (this.variableCoverageOverview()?.missingVariables || 0) > 0 ||
      (this.caseCoverageOverview()?.effectiveUnassignedCases || 0) > 0);

  readonly hasVariableCoverageConflicts = computed<boolean>(() => (this.variableCoverageOverview()?.conflictedVariables || 0) > 0);

  readonly isPlanningReady = computed<boolean>(() => !!this.variableCoverageOverview() &&
      !!this.caseCoverageOverview() &&
      !this.hasPlanningWarnings());

  readonly hasExecutionOpenWork = computed<boolean>(() => this.getOpenCodingCases() > 0);

  readonly hasPreparationRefreshTarget = computed<boolean>(() => this.hasPreparationWarnings() ||
      this.isResponseAnalysisOutdated());

  readonly hasActiveTrainingCodingJobs = computed<boolean>(() => (this.manualFreshnessJobSummary?.activeTrainingJobs ?? 0) > 0);

  readonly hasOpenProductiveManualJobs = computed<boolean>(() => (this.manualFreshnessJobSummary?.openProductiveJobs ?? 0) > 0);

  readonly hasCompletedProductiveManualJobs = computed<boolean>(() => (this.manualFreshnessJobSummary?.completedProductiveJobs ?? 0) > 0);

  readonly hasStaleSourceManualJobs = computed<boolean>(() => (this.manualFreshnessJobSummary?.staleSourceJobs ?? 0) > 0);

  readonly hasOpenDoubleCodingReviewConflicts = computed<boolean>(() => this.openDoubleCodingConflictCount > 0);

  readonly hasManualFreshnessJobSummary = computed<boolean>(() => this.manualFreshnessJobSummary !== null);

  readonly hasExecutionOpenWorkForFreshness = computed<boolean>(() => {
    if (this.hasManualFreshnessJobSummary()) {
      return this.hasOpenProductiveManualJobs();
    }

    return this.hasExecutionOpenWork();
  });

  readonly hasCompletionReadyWorkForFreshness = computed<boolean>(() => {
    if (this.hasManualFreshnessJobSummary()) {
      return this.hasCompletedProductiveManualJobs();
    }

    return this.hasManualCodingProgressScope() &&
      !!this.codingProgressOverview() &&
      !!this.appliedResultsOverview() &&
      !this.hasExecutionOpenWork();
  });

  readonly isCompletionComplete = computed<boolean>(() => this.hasManualCodingProgressScope() &&
      this.getAppliedResultsPercentage() >= 100 &&
      this.getOpenCodingCases() === 0);

  readonly hasManualCodingProgressScope = computed<boolean>(() => ((this.codingProgressOverview()?.totalCasesToCode ?? 0) > 0) ||
      ((this.codingProgressOverview()?.rawTotalCasesToCode ?? 0) > 0) ||
      ((this.appliedResultsOverview()?.totalIncompleteResponses ?? 0) > 0) ||
      ((this.appliedResultsOverview()?.rawTotalIncompleteResponses ?? 0) > 0) ||
      ((this.appliedResultsOverview()?.appliedResponses ?? 0) > 0) ||
      ((this.appliedResultsOverview()?.remainingResponses ?? 0) > 0));

  readonly hasCompletedJobsReadyForApply = computed<boolean>(() => this.completedJobsReadyForApply().length > 0);

  readonly hasCompletedJobsBlockedForReview = computed<boolean>(() => this.completedJobsBlockedForReview().length > 0);

  readonly effectiveCodingCases = computed<number>(() => this.appliedResultsOverview()?.totalIncompleteResponses ?? 0);

  readonly aggregationSavings = computed<number>(() => this.appliedResultsOverview()?.aggregatedDuplicateCases ?? 0);

  readonly hasDeriveErrorManualCases = computed<boolean>(() => (this.appliedResultsOverview()?.deriveErrorRawTotalResponses ?? 0) > 0 ||
      (this.appliedResultsOverview()?.deriveErrorTotalResponses ?? 0) > 0);

  readonly deriveErrorManualCases = computed<number>(() => this.appliedResultsOverview()?.deriveErrorTotalResponses ?? 0);

  readonly deriveErrorAppliedCases = computed<number>(() => this.appliedResultsOverview()?.deriveErrorAppliedResponses ?? 0);

  readonly deriveErrorRemainingCases = computed<number>(() => this.appliedResultsOverview()?.deriveErrorRemainingResponses ?? 0);

  readonly responseAnalysisAggregationSavings = computed<number>(() => this.responseAnalysis()?.aggregationSummary?.collapsedCases ?? 0);

  readonly hasDuplicateFindingsWithoutAggregation = computed<boolean>(() => {
    const responseAnalysisValue = this.responseAnalysis();

    return !!responseAnalysisValue &&
      !responseAnalysisValue.aggregationSummary.aggregationActive &&
      responseAnalysisValue.duplicateValues.total > 0;
  });

  getVariableEffectiveCaseCount(variable: {
    responseCount: number;
    uniqueCasesAfterAggregation?: number;
  }): number {
    return variable.uniqueCasesAfterAggregation ?? variable.responseCount;
  }

  readonly effectiveSingleCodedCases = computed<number>(() => {
    const caseCoverageOverviewValue = this.caseCoverageOverview();

    if (!caseCoverageOverviewValue) {
      return 0;
    }

    return Math.max(
      0,
      caseCoverageOverviewValue.effectiveCasesInJobs -
      caseCoverageOverviewValue.doubleCodedCases
    );
  });

  readonly hasUncodedEmptyResponses = computed<boolean>(() => (this.responseAnalysis()?.emptyResponses?.totalUncoded || 0) > 0);

  readonly getUncodedCount = computed<number>(() => this.responseAnalysis()?.emptyResponses?.totalUncoded || 0);
}
