import { Injectable } from '@nestjs/common';
import { TestPersonCodingService } from './test-person-coding.service';
import { CodingResultsService } from './coding-results.service';
import { CodingValidationService } from './coding-validation.service';
import { CodingSchemeService } from './coding-scheme.service';
import { CodingReplayService } from './coding-replay.service';
import { DoubleCodingService } from './double-coding.service';
import { CodingStatisticsService } from './coding-statistics.service';
import { CodingStatisticsWithJob, ResponseEntity, CodingStatistics } from '../../common';
import { ExpectedCombinationDto } from '../../../../../../api-dto/coding/expected-combination.dto';
import { ValidateCodingCompletenessResponseDto } from '../../../../../../api-dto/coding/validate-coding-completeness-response.dto';
import { ResponseAnalysisDto } from '../../../../../../api-dto/coding/response-analysis.dto';
import { CodeBookContentSetting } from '../../admin/code-book/codebook.interfaces';

@Injectable()
export class WorkspaceCodingFacade {
  constructor(
    private readonly testPersonCodingService: TestPersonCodingService,
    private readonly validationService: CodingValidationService,
    private readonly schemeService: CodingSchemeService,
    private readonly replayService: CodingReplayService,
    private readonly doubleCodingService: DoubleCodingService,
    private readonly resultsService: CodingResultsService,
    private readonly statisticsService: CodingStatisticsService
  ) {}

  async codeTestPersons(
    workspaceId: number,
    testPersonIdsOrGroups: string,
    autoCoderRun: number = 1
  ): Promise<CodingStatisticsWithJob> {
    return this.testPersonCodingService.codeTestPersons(workspaceId, testPersonIdsOrGroups, autoCoderRun);
  }

  async processTestPersonsBatch(
    workspaceId: number,
    options: { personIds: number[]; autoCoderRun?: number; jobId?: string },
    progressCallback?: (progress: number) => void
  ): Promise<CodingStatistics> {
    return this.testPersonCodingService.processTestPersonsBatch(workspaceId, options, progressCallback);
  }

  async getManualTestPersons(
    workspaceId: number,
    personIds?: string
  ): Promise<Array<ResponseEntity & { unitname: string }>> {
    return this.testPersonCodingService.getManualTestPersons(workspaceId, personIds);
  }

  // Results
  async applyCodingResults(workspaceId: number, codingJobId: number) {
    return this.resultsService.applyCodingResults(workspaceId, codingJobId);
  }

  async bulkApplyCodingResults(workspaceId: number) {
    return this.resultsService.bulkApplyCodingResults(workspaceId);
  }

  // Validation
  async validateCodingCompleteness(
    workspaceId: number,
    expectedCombinations: ExpectedCombinationDto[],
    page: number = 1,
    pageSize: number = 50
  ): Promise<ValidateCodingCompletenessResponseDto> {
    return this.validationService.validateCodingCompleteness(workspaceId, expectedCombinations, page, pageSize);
  }

  async getCodingIncompleteVariables(workspaceId: number, unitName?: string) {
    return this.validationService.getCodingIncompleteVariables(workspaceId, unitName);
  }

  async getCodingProgressOverview(workspaceId: number) {
    return this.validationService.getCodingProgressOverview(workspaceId);
  }

  async getCaseCoverageOverview(workspaceId: number) {
    return this.validationService.getCaseCoverageOverview(workspaceId);
  }

  async getVariableCoverageOverview(workspaceId: number) {
    return this.validationService.getVariableCoverageOverview(workspaceId);
  }

  async getResponseAnalysis(workspaceId: number): Promise<ResponseAnalysisDto> {
    return this.validationService.getResponseAnalysis(workspaceId);
  }

  async invalidateIncompleteVariablesCache(workspaceId: number): Promise<void> {
    return this.validationService.invalidateIncompleteVariablesCache(workspaceId);
  }

  async resetCodingVersion(workspaceId: number, version: 'v1' | 'v2' | 'v3', unitFilters?: string[], variableFilters?: string[]) {
    return this.validationService.resetCodingVersion(workspaceId, version, unitFilters, variableFilters);
  }

  async getResponsesByStatus(workspaceId: number, status: string, version: 'v1' | 'v2' | 'v3' = 'v1', page: number = 1, limit: number = 100) {
    return this.validationService.getResponsesByStatus(workspaceId, status, version, page, limit);
  }

  // Schemes
  async generateCodebook(
    workspaceId: number,
    missingsProfile: number,
    contentOptions: CodeBookContentSetting,
    unitIds: number[]
  ): Promise<Buffer | null> {
    return this.schemeService.generateCodebook(workspaceId, missingsProfile, contentOptions, unitIds);
  }

  // Replay
  async generateReplayUrlForResponse(
    workspaceId: number,
    responseId: number,
    serverUrl: string,
    authToken: string
  ): Promise<{ replayUrl: string }> {
    return this.replayService.generateReplayUrlForResponse(workspaceId, responseId, serverUrl, authToken);
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
    return this.replayService.generateReplayUrlsForItems(workspaceId, items, serverUrl);
  }

  // Double Coding
  async getDoubleCodedVariablesForReview(workspaceId: number, page: number, limit: number) {
    return this.doubleCodingService.getDoubleCodedVariablesForReview(workspaceId, page, limit);
  }

  async applyDoubleCodedResolutions(workspaceId: number, decisions: Array<{ responseId: number; selectedJobId: number; resolutionComment?: string }>) {
    return this.doubleCodingService.applyDoubleCodedResolutions(workspaceId, decisions);
  }

  async getAppliedResultsCount(workspaceId: number, incompleteVariables: Array<{ unitName: string; variableId: string }>) {
    return this.doubleCodingService.getAppliedResultsCount(workspaceId, incompleteVariables);
  }

  async getWorkspaceCohensKappaSummary(workspaceId: number) {
    return this.doubleCodingService.getWorkspaceCohensKappaSummary(workspaceId);
  }

  async invalidateStatisticsCache(workspaceId: number, version?: 'v1' | 'v2' | 'v3'): Promise<void> {
    return this.statisticsService.invalidateCache(workspaceId, version);
  }
}
