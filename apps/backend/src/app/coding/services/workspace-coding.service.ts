import {
  Injectable
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository
} from 'typeorm';
import { CodingStatistics } from '../../common';
import { CodingJob } from '../entities/coding-job.entity';
import { CodeBookContentSetting } from '../../admin/code-book/codebook.interfaces';
import { VariableAnalysisItemDto } from '../../../../../../api-dto/coding/variable-analysis-item.dto';
import { ExpectedCombinationDto } from '../../../../../../api-dto/coding/expected-combination.dto';
import { ValidateCodingCompletenessResponseDto } from '../../../../../../api-dto/coding/validate-coding-completeness-response.dto';
import {
  ResponseAnalysisDto
} from '../../../../../../api-dto/coding/response-analysis.dto';
import { CodingStatisticsService } from './coding-statistics.service';
import { VariableAnalysisReplayService } from './variable-analysis-replay.service';
import { ExportValidationResultsService } from './export-validation-results.service';
import {
  ExternalCodingImportService,
  ExternalCodingImportBody
} from './external-coding-import.service';
import { CodingResultsService } from './coding-results.service';
import { CodingJobService } from './coding-job.service';
import { CodingExportService } from './coding-export.service';
import { CodingFileCache } from './coding-file-cache.service';
import { CodingJobManager } from './coding-job-manager.service';
import { WorkspaceCodingFacade } from './workspace-coding-facade.service';

@Injectable()
export class WorkspaceCodingService {
  constructor(
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>,
    private codingStatisticsService: CodingStatisticsService,
    private variableAnalysisReplayService: VariableAnalysisReplayService,
    private exportValidationResultsService: ExportValidationResultsService,
    private externalCodingImportService: ExternalCodingImportService,
    private codingResultsService: CodingResultsService,
    private codingJobService: CodingJobService,
    private codingExportService: CodingExportService,
    private codingFileCache: CodingFileCache,
    private codingJobManager: CodingJobManager,
    private facade: WorkspaceCodingFacade
  ) {}

  /**
   * Job Management
   */
  async getJobStatus(jobId: string) {
    return this.codingJobManager.getJobStatus(jobId);
  }

  async createCodingStatisticsJob(workspaceId: number) {
    return this.codingJobManager.createCodingStatisticsJob(workspaceId);
  }

  async cancelJob(jobId: string) {
    return this.codingJobManager.cancelJob(jobId);
  }

  async deleteJob(jobId: string) {
    return this.codingJobManager.deleteJob(jobId);
  }

  async pauseJob(jobId: string) {
    return this.codingJobManager.pauseJob(jobId);
  }

  async resumeJob(jobId: string) {
    return this.codingJobManager.resumeJob(jobId);
  }

  async restartJob(jobId: string) {
    return this.codingJobManager.restartJob(jobId);
  }

  async getBullJobs(workspaceId: number) {
    return this.codingJobManager.getBullJobs(workspaceId);
  }

  /**
   * Test Person Coding
   */
  async codeTestPersons(workspaceId: number, testPersonIdsOrGroups: string, autoCoderRun: number = 1) {
    return this.facade.codeTestPersons(workspaceId, testPersonIdsOrGroups, autoCoderRun);
  }

  async processTestPersonsBatch(
    workspaceId: number,
    options: { personIds: number[]; autoCoderRun?: number; jobId?: string },
    progressCallback?: (progress: number) => void
  ) {
    return this.facade.processTestPersonsBatch(workspaceId, options, progressCallback);
  }

  async getManualTestPersons(workspaceId: number, personIds?: string) {
    return this.facade.getManualTestPersons(workspaceId, personIds);
  }

  /**
   * Validation & Coverage
   */
  async validateCodingCompleteness(
    workspaceId: number,
    expectedCombinations: ExpectedCombinationDto[],
    page: number = 1,
    pageSize: number = 50
  ): Promise<ValidateCodingCompletenessResponseDto> {
    return this.facade.validateCodingCompleteness(workspaceId, expectedCombinations, page, pageSize);
  }

  async getCodingIncompleteVariables(workspaceId: number, unitName?: string) {
    return this.facade.getCodingIncompleteVariables(workspaceId, unitName);
  }

  async getCodingProgressOverview(workspaceId: number) {
    return this.facade.getCodingProgressOverview(workspaceId);
  }

  async getCaseCoverageOverview(workspaceId: number) {
    return this.facade.getCaseCoverageOverview(workspaceId);
  }

  async getVariableCoverageOverview(workspaceId: number) {
    // This could also be moved to the facade if needed
    return this.facade.getVariableCoverageOverview(workspaceId);
  }

  async getResponseAnalysis(workspaceId: number): Promise<ResponseAnalysisDto> {
    return this.facade.getResponseAnalysis(workspaceId);
  }

  async invalidateIncompleteVariablesCache(workspaceId: number): Promise<void> {
    return this.facade.invalidateIncompleteVariablesCache(workspaceId);
  }

  /**
   * Double Coding & Review
   */
  async getDoubleCodedVariablesForReview(workspaceId: number, page: number = 1, limit: number = 50) {
    return this.facade.getDoubleCodedVariablesForReview(workspaceId, page, limit);
  }

  async applyDoubleCodedResolutions(workspaceId: number, decisions: Array<{ responseId: number; selectedJobId: number; resolutionComment?: string }>) {
    return this.facade.applyDoubleCodedResolutions(workspaceId, decisions);
  }

  async getAppliedResultsCount(workspaceId: number, incompleteVariables: Array<{ unitName: string; variableId: string }>) {
    return this.facade.getAppliedResultsCount(workspaceId, incompleteVariables);
  }

  async getWorkspaceCohensKappaSummary(workspaceId: number) {
    return this.facade.getWorkspaceCohensKappaSummary(workspaceId);
  }

  /**
   * Results Application
   */
  async applyCodingResults(workspaceId: number, codingJobId: number) {
    return this.facade.applyCodingResults(workspaceId, codingJobId);
  }

  async bulkApplyCodingResults(workspaceId: number) {
    return this.facade.bulkApplyCodingResults(workspaceId);
  }

  /**
   * Replay & Export
   */
  async generateReplayUrlForResponse(workspaceId: number, responseId: number, serverUrl: string, authToken: string) {
    return this.facade.generateReplayUrlForResponse(workspaceId, responseId, serverUrl, authToken);
  }

  async generateReplayUrlsForItems(workspaceId: number, items: Array<{
    responseId: number;
    unitName: string;
    unitAlias: string | null;
    variableId: string;
    variableAnchor: string;
    bookletName: string;
    personLogin: string;
    personCode: string;
    personGroup: string;
  }>, serverUrl: string) {
    return this.facade.generateReplayUrlsForItems(workspaceId, items, serverUrl);
  }

  async generateCodebook(workspaceId: number, missingsProfile: number, contentOptions: CodeBookContentSetting, unitIds: number[]) {
    return this.facade.generateCodebook(workspaceId, missingsProfile, contentOptions, unitIds);
  }

  async exportCodingResultsAggregated(workspaceId: number, outputCommentsInsteadOfCodes = false) {
    return this.codingExportService.exportCodingResultsAggregated(workspaceId, outputCommentsInsteadOfCodes);
  }

  async exportCodingResultsByVariable(
    workspaceId: number,
    includeModalValue = false,
    includeDoubleCoded = false,
    includeComments = false,
    outputCommentsInsteadOfCodes = false
  ) {
    return this.codingExportService.exportCodingResultsByVariable(
      workspaceId, includeModalValue, includeDoubleCoded, includeComments, outputCommentsInsteadOfCodes
    );
  }

  async exportValidationResultsAsExcel(workspaceId: number, cacheKey: string) {
    return this.exportValidationResultsService.exportValidationResultsAsExcel(workspaceId, cacheKey);
  }

  /**
   * Statistics & Analysis
   */
  async getCodingStatistics(workspace_id: number, version: 'v1' | 'v2' | 'v3' = 'v1'): Promise<CodingStatistics> {
    return this.codingStatisticsService.getCodingStatistics(workspace_id, version);
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
  ): Promise<{ data: VariableAnalysisItemDto[]; total: number; page: number; limit: number }> {
    return this.variableAnalysisReplayService.getVariableAnalysis(
      workspace_id, authToken, serverUrl, page, limit, unitIdFilter, variableIdFilter, derivationFilter
    );
  }

  /**
   * Import
   */
  async importExternalCodingWithProgress(
    workspaceId: number,
    body: ExternalCodingImportBody,
    progressCallback: (progress: number, message: string) => void
  ) {
    const result = await this.externalCodingImportService.importExternalCodingWithProgress(workspaceId, body, progressCallback);
    if (result.updatedRows > 0) {
      await this.invalidateIncompleteVariablesCache(workspaceId);
    }
    return result;
  }

  async importExternalCoding(workspaceId: number, body: ExternalCodingImportBody) {
    return this.externalCodingImportService.importExternalCoding(workspaceId, body);
  }

  /**
   * Core Assignments
   */
  async createDistributedCodingJobs(
    workspaceId: number,
    request: {
      selectedVariables: { unitName: string; variableId: string }[];
      selectedVariableBundles?: { id: number; name: string; variables: { unitName: string; variableId: string }[] }[];
      selectedCoders: { id: number; name: string; username: string }[];
      doubleCodingAbsolute?: number;
      doubleCodingPercentage?: number;
      caseOrderingMode?: 'continuous' | 'alternating';
      maxCodingCases?: number;
    }
  ) {
    return this.codingJobService.createDistributedCodingJobs(workspaceId, request);
  }

  /**
   * Versioning
   */
  async resetCodingVersion(workspaceId: number, version: 'v1' | 'v2' | 'v3', unitFilters?: string[], variableFilters?: string[]) {
    // This could also be moved to facade if needed
    return this.facade.resetCodingVersion(workspaceId, version, unitFilters, variableFilters);
  }

  async getResponsesByStatus(
    workspaceId: number,
    status: string,
    version: 'v1' | 'v2' | 'v3' = 'v1',
    page: number = 1,
    limit: number = 100
  ) {
    // This could also be moved to facade if needed
    return this.facade.getResponsesByStatus(workspaceId, status, version, page, limit);
  }
}
