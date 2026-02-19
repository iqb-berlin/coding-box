import { Injectable } from '@nestjs/common';
import { CodingProcessService } from '../coding/coding-process.service';
import { CodingValidationService } from '../coding/coding-validation.service';
import { CodingReviewService } from '../coding/coding-review.service';
import { CodingAnalysisService } from '../coding/coding-analysis.service';
import { CodingProgressService } from '../coding/coding-progress.service';
import { CodingReplayService } from '../coding/coding-replay.service';
import { CodingVersionService } from '../coding/coding-version.service';
import { CodingJobOperationsService } from '../coding/coding-job-operations.service';
import { CodebookGenerationService } from '../coding/codebook-generation.service';
import { CodingResponseQueryService } from '../coding/coding-response-query.service';
import { CodingStatisticsService } from '../coding/coding-statistics.service';
import { CodingExportService } from '../coding/coding-export.service';
import { VariableAnalysisReplayService } from '../test-results/variable-analysis-replay.service';
import { ExportValidationResultsService } from '../validation/export-validation-results.service';
import { ExternalCodingImportService, ExternalCodingImportBody } from '../coding/external-coding-import.service';
import { BullJobManagementService } from '../jobs/bull-job-management.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingStatistics, CodingStatisticsWithJob } from '../shared';
import { CodeBookContentSetting } from '../../../admin/code-book/codebook.interfaces';
import { VariableAnalysisItemDto } from '../../../../../../../api-dto/coding/variable-analysis-item.dto';
import { ExpectedCombinationDto } from '../../../../../../../api-dto/coding/expected-combination.dto';
import { ValidateCodingCompletenessResponseDto } from '../../../../../../../api-dto/coding/validate-coding-completeness-response.dto';
import { ResponseAnalysisDto } from '../../../../../../../api-dto/coding/response-analysis.dto';

@Injectable()
export class WorkspaceCodingService {
  constructor(
    private codingStatisticsService: CodingStatisticsService,
    private variableAnalysisReplayService: VariableAnalysisReplayService,
    private exportValidationResultsService: ExportValidationResultsService,
    private externalCodingImportService: ExternalCodingImportService,
    private bullJobManagementService: BullJobManagementService,
    private codingExportService: CodingExportService,
    private codingProcessService: CodingProcessService,
    private codingValidationService: CodingValidationService,
    private codingReviewService: CodingReviewService,
    private codingAnalysisService: CodingAnalysisService,
    private codingProgressService: CodingProgressService,
    private codingReplayService: CodingReplayService,
    private codingVersionService: CodingVersionService,
    private codingJobOperationsService: CodingJobOperationsService,
    private codebookGenerationService: CodebookGenerationService,
    private codingResponseQueryService: CodingResponseQueryService
  ) { }

  async processTestPersonsBatch(
    workspace_id: number,
    personIds: string[],
    autoCoderRun: number = 1,
    progressCallback?: (progress: number) => void,
    jobId?: string
  ): Promise<CodingStatistics> {
    const statistics = await this.codingProcessService.processTestPersonsBatch(
      workspace_id,
      personIds,
      autoCoderRun,
      progressCallback,
      jobId
    );

    await this.invalidateIncompleteVariablesCache(workspace_id);
    this.codingAnalysisService.invalidateCache(workspace_id);
    await this.codingStatisticsService.refreshStatistics(workspace_id);

    return statistics;
  }

  async codeTestPersons(
    workspace_id: number,
    testPersonIdsOrGroups: string,
    autoCoderRun: number = 1
  ): Promise<CodingStatisticsWithJob> {
    return this.codingProcessService.codeTestPersons(
      workspace_id,
      testPersonIdsOrGroups,
      autoCoderRun
    );
  }

  async getManualTestPersons(
    workspace_id: number,
    personIds?: string
  ): Promise<Array<ResponseEntity & { unitname: string }>> {
    return this.codingResponseQueryService.getManualTestPersons(
      workspace_id,
      personIds
    );
  }

  async getCodingStatistics(
    workspace_id: number,
    version: 'v1' | 'v2' | 'v3' = 'v1'
  ): Promise<CodingStatistics> {
    return this.codingStatisticsService.getCodingStatistics(
      workspace_id,
      version
    );
  }

  async generateCodebook(
    workspaceId: number,
    missingsProfile: number,
    contentOptions: CodeBookContentSetting,
    unitIds: number[]
  ): Promise<Buffer | null> {
    return this.codebookGenerationService.generateCodebook(
      workspaceId,
      missingsProfile,
      contentOptions,
      unitIds
    );
  }

  async pauseJob(
    jobId: string
  ): Promise<{ success: boolean; message: string }> {
    return this.bullJobManagementService.pauseJob(jobId);
  }

  async resumeJob(
    jobId: string
  ): Promise<{ success: boolean; message: string }> {
    return this.bullJobManagementService.resumeJob(jobId);
  }

  async restartJob(
    jobId: string
  ): Promise<{ success: boolean; message: string; jobId?: string }> {
    return this.bullJobManagementService.restartJob(jobId);
  }

  async getBullJobs(workspaceId: number): Promise<
  {
    jobId: string;
    status:
    | 'pending'
    | 'processing'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'paused';
    progress: number;
    result?: CodingStatistics;
    error?: string;
    workspaceId?: number;
    createdAt?: Date;
    groupNames?: string;
    durationMs?: number;
    completedAt?: Date;
  }[]
  > {
    return this.bullJobManagementService.getBullJobs(workspaceId);
  }

  async getVariableAnalysis(
    workspace_id: number,
    authToken: string,
    serverUrl?: string,
    page: number = 1,
    limit: number = 100,
    unitIdFilter?: string,
    variableIdFilter?: string,
    derivationFilter?: string
  ): Promise<{
      data: VariableAnalysisItemDto[];
      total: number;
      page: number;
      limit: number;
    }> {
    return this.variableAnalysisReplayService.getVariableAnalysis(
      workspace_id,
      authToken,
      serverUrl,
      page,
      limit,
      unitIdFilter,
      variableIdFilter,
      derivationFilter
    );
  }

  async exportValidationResultsAsExcel(
    workspaceId: number,
    cacheKey: string
  ): Promise<Buffer> {
    return this.exportValidationResultsService.exportValidationResultsAsExcel(
      workspaceId,
      cacheKey
    );
  }

  async validateCodingCompleteness(
    workspaceId: number,
    expectedCombinations: ExpectedCombinationDto[],
    page: number = 1,
    pageSize: number = 50
  ): Promise<ValidateCodingCompletenessResponseDto> {
    return this.codingValidationService.validateCodingCompleteness(
      workspaceId,
      expectedCombinations,
      page,
      pageSize
    );
  }

  async getCodingIncompleteVariables(
    workspaceId: number,
    unitName?: string
  ): Promise<
    {
      unitName: string;
      variableId: string;
      responseCount: number;
      casesInJobs: number;
      availableCases: number;
      uniqueCasesAfterAggregation: number;
    }[]
    > {
    return this.codingValidationService.getCodingIncompleteVariables(
      workspaceId,
      unitName
    );
  }

  async invalidateIncompleteVariablesCache(workspaceId: number): Promise<void> {
    return this.codingValidationService.invalidateIncompleteVariablesCache(
      workspaceId
    );
  }

  /**
   * Get the number of unique cases (response_ids) already assigned to coding jobs for each variable
   * This counts distinct response_ids to properly handle double-coding scenarios
   */
  async getVariableCasesInJobs(
    workspaceId: number
  ): Promise<Map<string, number>> {
    return this.codingValidationService.getVariableCasesInJobs(workspaceId);
  }

  async importExternalCodingWithProgress(
    workspaceId: number,
    body: ExternalCodingImportBody,
    progressCallback: (progress: number, message: string) => void
  ): Promise<{
      message: string;
      processedRows: number;
      updatedRows: number;
      errors: string[];
      affectedRows: Array<{
        unitAlias: string;
        variableId: string;
        personCode?: string;
        personLogin?: string;
        personGroup?: string;
        bookletName?: string;
        originalCodedStatus: string;
        originalCode: number | null;
        originalScore: number | null;
        updatedCodedStatus: string | null;
        updatedCode: number | null;
        updatedScore: number | null;
      }>;
    }> {
    this.codingAnalysisService.invalidateCache(workspaceId);
    return this.externalCodingImportService.importExternalCodingWithProgress(
      workspaceId,
      body,
      progressCallback
    );
  }

  async importExternalCoding(
    workspaceId: number,
    body: ExternalCodingImportBody
  ): Promise<{
      message: string;
      processedRows: number;
      updatedRows: number;
      errors: string[];
      affectedRows: Array<{
        unitAlias: string;
        variableId: string;
        personCode?: string;
        personLogin?: string;
        personGroup?: string;
        bookletName?: string;
        originalCodedStatus: string;
        originalCode: number | null;
        originalScore: number | null;
        updatedCodedStatus: string | null;
        updatedCode: number | null;
        updatedScore: number | null;
      }>;
    }> {
    this.codingAnalysisService.invalidateCache(workspaceId);
    return this.externalCodingImportService.importExternalCoding(
      workspaceId,
      body
    );
  }

  async getResponsesByStatus(
    workspaceId: number,
    status: string,
    version: 'v1' | 'v2' | 'v3' = 'v1',
    page: number = 1,
    limit: number = 100
  ): Promise<{
      data: ResponseEntity[];
      total: number;
      page: number;
      limit: number;
    }> {
    return this.codingResponseQueryService.getResponsesByStatus(
      workspaceId,
      status,
      version,
      page,
      limit
    );
  }

  async generateReplayUrlForResponse(
    workspaceId: number,
    responseId: number,
    serverUrl: string,
    authToken: string
  ): Promise<{ replayUrl: string }> {
    return this.codingReplayService.generateReplayUrlForResponse(
      workspaceId,
      responseId,
      serverUrl,
      authToken
    );
  }

  async generateReplayUrlsForItems(
    workspaceId: number,
    items: Array<{
      responseId: number;
      unitName: string;
      unitAlias: string | null;
      variableId: string;
      variableAnchor: string;
      bookletName: string;
      personLogin: string;
      personCode: string;
      personGroup: string;
    }>,
    serverUrl: string
  ): Promise<
    Array<{
      responseId: number;
      unitName: string;
      unitAlias: string | null;
      variableId: string;
      variableAnchor: string;
      bookletName: string;
      personLogin: string;
      personCode: string;
      personGroup: string;
      replayUrl: string;
    }>
    > {
    return this.codingReplayService.generateReplayUrlsForItems(
      workspaceId,
      items,
      serverUrl
    );
  }

  async applyCodingResults(
    workspaceId: number,
    codingJobId: number
  ): Promise<{
      success: boolean;
      updatedResponsesCount: number;
      skippedReviewCount: number;
      messageKey: string;
      messageParams?: Record<string, unknown>;
    }> {
    this.codingAnalysisService.invalidateCache(workspaceId);
    return this.codingJobOperationsService.applyCodingResults(
      workspaceId,
      codingJobId
    );
  }

  async createDistributedCodingJobs(
    workspaceId: number,
    request: {
      selectedVariables: { unitName: string; variableId: string }[];
      selectedVariableBundles?: {
        id: number;
        name: string;
        variables: { unitName: string; variableId: string }[];
      }[];
      selectedCoders: { id: number; name: string; username: string }[];
      doubleCodingAbsolute?: number;
      doubleCodingPercentage?: number;
      caseOrderingMode?: 'continuous' | 'alternating';
      maxCodingCases?: number;
    }
  ): Promise<{
      success: boolean;
      jobsCreated: number;
      message: string;
      distribution: Record<string, Record<string, number>>;
      doubleCodingInfo: Record<
      string,
      {
        totalCases: number;
        doubleCodedCases: number;
        singleCodedCasesAssigned: number;
        doubleCodedCasesPerCoder: Record<string, number>;
      }
      >;
      jobs: {
        coderId: number;
        coderName: string;
        variable: { unitName: string; variableId: string };
        jobId: number;
        jobName: string;
        caseCount: number;
      }[];
    }> {
    return this.codingJobOperationsService.createDistributedCodingJobs(
      workspaceId,
      request
    );
  }

  async exportCodingResultsAggregated(
    workspaceId: number,
    outputCommentsInsteadOfCodes = false
  ): Promise<Buffer> {
    return this.codingExportService.exportCodingResultsAggregated(
      workspaceId,
      outputCommentsInsteadOfCodes
    );
  }

  async exportCodingResultsByVariable(
    workspaceId: number,
    includeModalValue = false,
    includeDoubleCoded = false,
    includeComments = false,
    outputCommentsInsteadOfCodes = false
  ): Promise<Buffer> {
    return this.codingExportService.exportCodingResultsByVariable(
      workspaceId,
      includeModalValue,
      includeDoubleCoded,
      includeComments,
      outputCommentsInsteadOfCodes
    );
  }

  async bulkApplyCodingResults(workspaceId: number): Promise<{
    success: boolean;
    jobsProcessed: number;
    totalUpdatedResponses: number;
    totalSkippedReview: number;
    message: string;
    results: Array<{
      jobId: number;
      jobName: string;
      hasIssues: boolean;
      skipped: boolean;
      result?: {
        success: boolean;
        updatedResponsesCount: number;
        skippedReviewCount: number;
        message: string;
      };
    }>;
  }> {
    this.codingAnalysisService.invalidateCache(workspaceId);
    return this.codingJobOperationsService.bulkApplyCodingResults(workspaceId);
  }

  async getCodingProgressOverview(workspaceId: number): Promise<{
    totalCasesToCode: number;
    completedCases: number;
    completionPercentage: number;
  }> {
    return this.codingProgressService.getCodingProgressOverview(workspaceId);
  }

  async getCaseCoverageOverview(workspaceId: number): Promise<{
    totalCasesToCode: number;
    casesInJobs: number;
    doubleCodedCases: number;
    singleCodedCases: number;
    unassignedCases: number;
    coveragePercentage: number;
  }> {
    return this.codingProgressService.getCaseCoverageOverview(workspaceId);
  }

  async getVariableCoverageOverview(workspaceId: number): Promise<{
    totalVariables: number;
    coveredVariables: number;
    coveredByDraft: number;
    coveredByPendingReview: number;
    coveredByApproved: number;
    conflictedVariables: number;
    missingVariables: number;
    partiallyAbgedeckteVariablen: number;
    fullyAbgedeckteVariablen: number;
    coveragePercentage: number;
    variableCaseCounts: {
      unitName: string;
      variableId: string;
      caseCount: number;
    }[];
    coverageByStatus: {
      draft: string[];
      pending_review: string[];
      approved: string[];
      conflicted: Array<{
        variableKey: string;
        conflictingDefinitions: Array<{
          id: number;
          status: string;
        }>;
      }>;
    };
  }> {
    return this.codingProgressService.getVariableCoverageOverview(workspaceId);
  }

  async getDoubleCodedVariablesForReview(
    workspaceId: number,
    page: number = 1,
    limit: number = 50,
    onlyConflicts: boolean = false,
    excludeTrainings: boolean = false
  ): Promise<{
      data: Array<{
        responseId: number;
        unitName: string;
        variableId: string;
        personLogin: string;
        personCode: string;
        bookletName: string;
        givenAnswer: string;
        coderResults: Array<{
          coderId: number;
          coderName: string;
          jobId: number;
          jobName: string;
          code: number | null;
          score: number | null;
          notes: string | null;
          codedAt: Date;
        }>;
      }>;
      total: number;
      page: number;
      limit: number;
    }> {
    return this.codingReviewService.getDoubleCodedVariablesForReview(
      workspaceId,
      page,
      limit,
      onlyConflicts,
      excludeTrainings
    );
  }

  async applyDoubleCodedResolutions(
    workspaceId: number,
    decisions: Array<{
      responseId: number;
      selectedJobId: number;
      resolutionComment?: string;
    }>
  ): Promise<{
      success: boolean;
      appliedCount: number;
      failedCount: number;
      skippedCount: number;
      message: string;
    }> {
    return this.codingReviewService.applyDoubleCodedResolutions(
      workspaceId,
      decisions
    );
  }

  async getAppliedResultsCount(
    workspaceId: number,
    incompleteVariables: { unitName: string; variableId: string }[]
  ): Promise<number> {
    return this.codingValidationService.getAppliedResultsCount(
      workspaceId,
      incompleteVariables
    );
  }

  async getWorkspaceCohensKappaSummary(
    workspaceId: number,
    weightedMean: boolean = true
  ): Promise<{
      coderPairs: Array<{
        coder1Id: number;
        coder1Name: string;
        coder2Id: number;
        coder2Name: string;
        kappa: number | null;
        agreement: number;
        totalSharedResponses: number;
        validPairs: number;
        interpretation: string;
      }>;
      workspaceSummary: {
        totalDoubleCodedResponses: number;
        totalCoderPairs: number;
        averageKappa: number | null;
        variablesIncluded: number;
        codersIncluded: number;
        weightingMethod: 'weighted' | 'unweighted';
      };
    }> {
    return this.codingReviewService.getWorkspaceCohensKappaSummary(workspaceId, weightedMean);
  }

  async resetCodingVersion(
    workspaceId: number,
    version: 'v1' | 'v2' | 'v3',
    unitFilters?: string[],
    variableFilters?: string[]
  ): Promise<{
      affectedResponseCount: number;
      cascadeResetVersions: ('v2' | 'v3')[];
      message: string;
    }> {
    this.codingAnalysisService.invalidateCache(workspaceId);
    return this.codingVersionService.resetCodingVersion(
      workspaceId,
      version,
      unitFilters,
      variableFilters
    );
  }

  /**
   * Analyzes responses for a workspace to identify:
   * 1. Empty responses (null or empty string values)
   * 2. Duplicate values (same normalized value across different testperson/variable combinations)
   *
   * Uses the response matching settings (ignore case, ignore whitespace) for normalization.
   */
  async getResponseAnalysis(workspaceId: number): Promise<ResponseAnalysisDto> {
    return this.codingAnalysisService.getResponseAnalysis(workspaceId);
  }
}
