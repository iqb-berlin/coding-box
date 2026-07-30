import type { ResponseAnalysisDto } from '../../../../../../api-dto/coding/response-analysis.dto';
import type { CodingFreshnessSummaryDto } from '../../../../../../api-dto/coding/coding-freshness.dto';
import type { ManualCodeAvailabilityWarningDto } from '../../../../../../api-dto/coding/manual-code-availability.dto';
import type { ManualCodingScopeSummary } from './coding-job-backend.service';
import type {
  AppliedResultsOverview,
  CaseCoverageOverview,
  CodingProgressOverview
} from './test-person-coding.service';

export interface ManualCodingVariableCoverageOverview {
  totalVariables: number;
  coveredVariables: number;
  coveredByDraft: number;
  coveredByPendingReview: number;
  coveredByApproved: number;
  conflictedVariables: number;
  missingVariables: number;
  partiallyAbgedeckteVariablen?: number;
  fullyAbgedeckteVariablen?: number;
  coveragePercentage: number;
  variableCaseCounts: Array<{
    unitName: string;
    variableId: string;
    caseCount: number;
  }>;
  coverageByStatus: {
    draft: string[];
    pending_review: string[];
    approved: string[];
    conflicted: Array<{
      variableKey: string;
      conflictingDefinitions: Array<{
        id: number;
        name?: string;
        status: string;
      }>;
    }>;
  };
  statusTotalVariables?: number;
  coveredSourceVariableCount?: number;
  coveredSourceResponseCount?: number;
}

export interface ManualCodingIncompleteVariable {
  unitName: string;
  variableId: string;
  responseCount: number;
  availableCases?: number;
  uniqueCasesAfterAggregation?: number;
}

export interface ManualCodingFreshnessJobSummary {
  activeTrainingJobs: number;
  openProductiveJobs: number;
  completedProductiveJobs: number;
  staleSourceJobs: number;
}

export type ManualCodingAppliedResultsOverview = AppliedResultsOverview & {
  totalIncompleteVariables: number;
  finalStatusBreakdown: {
    codingComplete: number;
    invalid: number;
    codingError: number;
    other: number;
  };
};

export interface ManualCodingPlanningSnapshot {
  responseAnalysis: ResponseAnalysisDto | null;
  codingProgressOverview: CodingProgressOverview | null;
  variableCoverageOverview: ManualCodingVariableCoverageOverview | null;
  caseCoverageOverview: CaseCoverageOverview | null;
  codingIncompleteVariables: ManualCodingIncompleteVariable[];
  manualCodingScopeSummary: ManualCodingScopeSummary | null;
  manualCodeAvailabilityWarnings: ManualCodeAvailabilityWarningDto[];
  appliedResultsOverview: ManualCodingAppliedResultsOverview | null;
  manualFreshnessJobSummary: ManualCodingFreshnessJobSummary | null;
  openDoubleCodingConflictCount: number;
  codingFreshnessSummary: CodingFreshnessSummaryDto | null;
}
