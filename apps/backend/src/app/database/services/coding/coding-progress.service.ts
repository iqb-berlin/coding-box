import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Brackets, In, Repository
} from 'typeorm';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { JobDefinition } from '../../entities/job-definition.entity';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import { Setting } from '../../entities/setting.entity';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import {
  applyResolvedExclusionsToQuery,
  normalizeExclusionBookletId,
  normalizeExclusionUnitId,
  ResolvedWorkspaceExclusions,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import {
  buildAggregationGroups,
  summarizeAggregationGroups
} from './aggregation-metrics.util';
import { IQB_STANDARD_MISSING_CODES, MissingsProfilesService } from './missings-profiles.service';
import {
  getCoveredSourceKeysForManualDerivedVariables,
  isCoveredSourceVariable,
  ManualCodingExcludedSourceSummary,
  summarizeCoveredSourceVariables,
  UnitVariableReference
} from '../../utils/manual-coding-scope.util';
import {
  applyNonCodingIssueReviewJobFilter,
  getNonCodingIssueReviewJobSqlCondition
} from './coding-job-type.util';
import { CacheService } from '../../../cache/cache.service';
import {
  getCodingAppliedResultsOverviewCacheKey,
  getCodingAppliedResultsOverviewCachePattern,
  getCodingAppliedResultsOverviewVersionKey
} from './coding-applied-results-overview-cache-key.util';

type ResponseMatchingFlag =
  | 'NO_AGGREGATION'
  | 'IGNORE_CASE'
  | 'IGNORE_WHITESPACE';

interface CoverageResponse {
  responseId: number;
  unitName: string;
  variableId: string;
  value: string | null;
  codeV2: number | null;
  statusV2: number | null;
  statusV1: number | null;
}

interface CoverageResponseScope {
  statusTotalResponseCount: number;
  manualResponses: CoverageResponse[];
  excludedSourceSummary: ManualCodingExcludedSourceSummary;
}

interface EffectiveCaseCoverage {
  effectiveTotalCasesToCode: number;
  effectiveCasesInJobs: number;
  effectiveUnassignedCases: number;
  aggregationActive: boolean;
  aggregationThreshold: number | null;
  aggregatedDuplicateCases: number;
}

interface EffectiveCaseProgress {
  effectiveTotalCasesToCode: number;
  effectiveCompletedCases: number;
  aggregationActive: boolean;
  aggregationThreshold: number | null;
  aggregatedDuplicateCases: number;
}

interface DeriveErrorManualProgress {
  deriveErrorTotalResponses: number;
  deriveErrorAppliedResponses: number;
  deriveErrorRemainingResponses: number;
  deriveErrorRawTotalResponses: number;
  deriveErrorRawAppliedResponses: number;
}

interface AppliedResultsOverview {
  totalIncompleteResponses: number;
  appliedResponses: number;
  remainingResponses: number;
  completionPercentage: number;
  rawTotalIncompleteResponses: number;
  rawAppliedResponses: number;
  rawCompletionPercentage: number;
  aggregationActive: boolean;
  aggregationThreshold: number | null;
  aggregatedDuplicateCases: number;
  statusTotalIncompleteResponses: number;
  coveredSourceVariableCount: number;
  coveredSourceResponseCount: number;
  deriveErrorTotalResponses: number;
  deriveErrorAppliedResponses: number;
  deriveErrorRemainingResponses: number;
  deriveErrorRawTotalResponses: number;
  deriveErrorRawAppliedResponses: number;
}

interface ManualProgressStatusQuery {
  where: (condition: string | Brackets, parameters?: Record<string, unknown>) => unknown;
  andWhere: (condition: string | Brackets, parameters?: Record<string, unknown>) => unknown;
}

interface VariableDefinitionReference {
  id: number;
  status: string;
}

interface CrossDefinitionCaseRow {
  unitName: string;
  variableId: string;
  responseId: number | string;
  definitionId: number | string;
  definitionStatus: string;
}

interface ManualCodingVariableLookups {
  validVariableSets: Map<string, Set<string>>;
  manualInstructionSets: Map<string, Set<string>>;
  derivedVariablesBySourceMap: Map<string, Set<string>>;
}

@Injectable()
export class CodingProgressService {
  private readonly logger = new Logger(CodingProgressService.name);
  private readonly appliedResultsOverviewInFlight = new Map<
  string,
  Promise<AppliedResultsOverview>
  >();

  private readonly appliedResultsOverviewPrewarmTimers = new Map<
  number,
  NodeJS.Timeout
  >();

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    @InjectRepository(JobDefinition)
    private jobDefinitionRepository: Repository<JobDefinition>,
    @InjectRepository(VariableBundle)
    private variableBundleRepository: Repository<VariableBundle>,
    @InjectRepository(Setting)
    private settingRepository: Repository<Setting>,
    private workspaceFilesService: WorkspaceFilesService,
    private workspaceExclusionService: WorkspaceExclusionService,
    @Optional()
    private missingsProfilesService?: MissingsProfilesService,
    @Optional()
    private cacheService?: CacheService
  ) { }

  private async getDefaultMirCode(workspaceId: number): Promise<number> {
    if (!this.missingsProfilesService) {
      return IQB_STANDARD_MISSING_CODES.mir;
    }

    const missing = await this.missingsProfilesService.getMissingByIdForProfileOrDefault(
      workspaceId,
      null,
      'mir'
    );
    return missing.code;
  }

  private async createAppliedResultsOverviewCacheKey(
    workspaceId: number
  ): Promise<string> {
    const [testResultsRevision, codingRevision] = await Promise.all([
      this.resolveTestResultsRevision(workspaceId),
      this.resolveAppliedResultsOverviewRevision(workspaceId)
    ]);
    return this.getAppliedResultsOverviewCacheKey(
      workspaceId,
      testResultsRevision,
      codingRevision
    );
  }

  private getAppliedResultsOverviewCacheKey(
    workspaceId: number,
    testResultsRevision: number,
    codingRevision: number
  ): string {
    return getCodingAppliedResultsOverviewCacheKey(
      workspaceId,
      testResultsRevision,
      codingRevision
    );
  }

  async invalidateAppliedResultsOverviewCache(
    workspaceId: number,
    options: { prewarm?: boolean } = {}
  ): Promise<void> {
    if (!this.cacheService) {
      return;
    }

    this.dropAppliedResultsOverviewInFlight(workspaceId);
    await Promise.all([
      this.cacheService.incr(
        getCodingAppliedResultsOverviewVersionKey(workspaceId)
      ),
      this.cacheService.deleteByPattern(
        getCodingAppliedResultsOverviewCachePattern(workspaceId)
      )
    ]);

    if (options.prewarm) {
      this.scheduleAppliedResultsOverviewPrewarm(workspaceId);
    }
  }

  private dropAppliedResultsOverviewInFlight(workspaceId: number): void {
    const prefix = `coding_applied_results_overview:${workspaceId}:`;
    Array.from(this.appliedResultsOverviewInFlight.keys())
      .filter(cacheKey => cacheKey.startsWith(prefix))
      .forEach(cacheKey => this.appliedResultsOverviewInFlight.delete(cacheKey));
  }

  private scheduleAppliedResultsOverviewPrewarm(workspaceId: number): void {
    if (!this.cacheService || process.env.NODE_ENV === 'test') {
      return;
    }

    const existingTimer = this.appliedResultsOverviewPrewarmTimers.get(workspaceId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.appliedResultsOverviewPrewarmTimers.delete(workspaceId);
      this.getAppliedResultsOverview(workspaceId).catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Could not prewarm applied results overview for workspace ${workspaceId}: ${message}`
        );
      });
    }, 500);

    timer.unref?.();
    this.appliedResultsOverviewPrewarmTimers.set(workspaceId, timer);
  }

  private async resolveTestResultsRevision(workspaceId: number): Promise<number> {
    try {
      const rows = (await this.responseRepository.query(
        'SELECT revision FROM workspace_test_results_revision WHERE workspace_id = $1',
        [workspaceId]
      )) as Array<{ revision: number | string }>;
      return Number(rows[0]?.revision || 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not resolve test result revision for applied results overview cache: ${message}`
      );
      return 0;
    }
  }

  private async resolveAppliedResultsOverviewRevision(workspaceId: number): Promise<number> {
    if (!this.cacheService) {
      return 0;
    }
    return this.cacheService.getNumber(
      getCodingAppliedResultsOverviewVersionKey(workspaceId),
      0
    );
  }

  async getCodingProgressOverview(workspaceId: number): Promise<{
    totalCasesToCode: number;
    completedCases: number;
    completionPercentage: number;
    rawTotalCasesToCode: number;
    rawCompletedCases: number;
    rawCompletionPercentage: number;
    aggregationActive: boolean;
    aggregationThreshold: number | null;
    aggregatedDuplicateCases: number;
    statusTotalCasesToCode: number;
    coveredSourceVariableCount: number;
    coveredSourceResponseCount: number;
  }> {
    const responseScope = await this.getCoverageResponseScope(workspaceId);
    const rawTotalCasesToCode = responseScope.manualResponses.length;
    const manualResponseIds = new Set(
      responseScope.manualResponses.map(response => response.responseId)
    );

    const completedResponseIds = await this.getCompletedCoverageResponseIds(workspaceId);
    const completedCases = Array.from(completedResponseIds)
      .filter(responseId => manualResponseIds.has(responseId))
      .length;
    const rawCompletionPercentage =
      rawTotalCasesToCode > 0 ? (completedCases / rawTotalCasesToCode) * 100 : 0;
    const effectiveProgress = await this.getEffectiveCaseProgress(
      workspaceId,
      completedResponseIds,
      responseScope.manualResponses
    );
    const completionPercentage =
      effectiveProgress.effectiveTotalCasesToCode > 0 ?
        (effectiveProgress.effectiveCompletedCases / effectiveProgress.effectiveTotalCasesToCode) * 100 :
        0;

    return {
      totalCasesToCode: effectiveProgress.effectiveTotalCasesToCode,
      completedCases: effectiveProgress.effectiveCompletedCases,
      completionPercentage,
      rawTotalCasesToCode,
      rawCompletedCases: completedCases,
      rawCompletionPercentage,
      aggregationActive: effectiveProgress.aggregationActive,
      aggregationThreshold: effectiveProgress.aggregationThreshold,
      aggregatedDuplicateCases: effectiveProgress.aggregatedDuplicateCases,
      statusTotalCasesToCode: responseScope.statusTotalResponseCount,
      coveredSourceVariableCount:
        responseScope.excludedSourceSummary.coveredSourceVariableCount,
      coveredSourceResponseCount:
        responseScope.excludedSourceSummary.coveredSourceResponseCount
    };
  }

  async getAppliedResultsOverview(workspaceId: number): Promise<AppliedResultsOverview> {
    if (!this.cacheService) {
      return this.computeAppliedResultsOverview(workspaceId);
    }

    const [testResultsRevision, codingRevision] = await Promise.all([
      this.resolveTestResultsRevision(workspaceId),
      this.resolveAppliedResultsOverviewRevision(workspaceId)
    ]);
    const cacheKey = this.getAppliedResultsOverviewCacheKey(
      workspaceId,
      testResultsRevision,
      codingRevision
    );
    const cached = await this.cacheService.get<AppliedResultsOverview>(
      cacheKey
    );
    if (cached) {
      return cached;
    }

    const inFlightOverview = this.appliedResultsOverviewInFlight.get(cacheKey);
    if (inFlightOverview) {
      return inFlightOverview;
    }

    const overviewPromise = this.computeAndCacheAppliedResultsOverview(
      workspaceId,
      testResultsRevision,
      codingRevision,
      cacheKey
    );
    this.appliedResultsOverviewInFlight.set(cacheKey, overviewPromise);
    try {
      return await overviewPromise;
    } finally {
      if (this.appliedResultsOverviewInFlight.get(cacheKey) === overviewPromise) {
        this.appliedResultsOverviewInFlight.delete(cacheKey);
      }
    }
  }

  private async computeAndCacheAppliedResultsOverview(
    workspaceId: number,
    testResultsRevision: number,
    codingRevision: number,
    cacheKey: string
  ): Promise<AppliedResultsOverview> {
    const overview = await this.computeAppliedResultsOverview(workspaceId);
    const [currentTestResultsRevision, currentCodingRevision] = await Promise.all([
      this.resolveTestResultsRevision(workspaceId),
      this.resolveAppliedResultsOverviewRevision(workspaceId)
    ]);
    if (
      currentTestResultsRevision === testResultsRevision &&
      currentCodingRevision === codingRevision
    ) {
      await this.cacheService?.set(cacheKey, overview, 0);
    } else {
      this.logger.log(
        `Skipped caching stale applied results overview for workspace ${workspaceId} ` +
        `(planned test revision ${testResultsRevision}, current test revision ${currentTestResultsRevision}; ` +
        `planned coding revision ${codingRevision}, current coding revision ${currentCodingRevision})`
      );
    }
    return overview;
  }

  private async computeAppliedResultsOverview(
    workspaceId: number
  ): Promise<AppliedResultsOverview> {
    const responseScope = await this.getCoverageResponseScope(workspaceId);
    const responses = responseScope.manualResponses;
    const appliedResponseIds = new Set(
      responses
        .filter(response => this.isAppliedResultResponse(response))
        .map(response => response.responseId)
    );
    const effectiveProgress = await this.getEffectiveCaseProgress(
      workspaceId,
      appliedResponseIds,
      responses
    );
    const completionPercentage =
      effectiveProgress.effectiveTotalCasesToCode > 0 ?
        (effectiveProgress.effectiveCompletedCases / effectiveProgress.effectiveTotalCasesToCode) * 100 :
        0;
    const rawCompletionPercentage =
      responses.length > 0 ? (appliedResponseIds.size / responses.length) * 100 : 0;
    const deriveErrorProgress = await this.getDeriveErrorManualProgress(
      workspaceId,
      responses,
      appliedResponseIds
    );

    const overview = {
      totalIncompleteResponses: effectiveProgress.effectiveTotalCasesToCode,
      appliedResponses: effectiveProgress.effectiveCompletedCases,
      remainingResponses: Math.max(
        0,
        effectiveProgress.effectiveTotalCasesToCode - effectiveProgress.effectiveCompletedCases
      ),
      completionPercentage,
      rawTotalIncompleteResponses: responses.length,
      rawAppliedResponses: appliedResponseIds.size,
      rawCompletionPercentage,
      aggregationActive: effectiveProgress.aggregationActive,
      aggregationThreshold: effectiveProgress.aggregationThreshold,
      aggregatedDuplicateCases: effectiveProgress.aggregatedDuplicateCases,
      statusTotalIncompleteResponses: responseScope.statusTotalResponseCount,
      coveredSourceVariableCount:
        responseScope.excludedSourceSummary.coveredSourceVariableCount,
      coveredSourceResponseCount:
        responseScope.excludedSourceSummary.coveredSourceResponseCount,
      ...deriveErrorProgress
    };
    return overview;
  }

  async getCaseCoverageOverview(workspaceId: number): Promise<{
    totalCasesToCode: number;
    effectiveTotalCasesToCode: number;
    casesInJobs: number;
    effectiveCasesInJobs: number;
    doubleCodedCases: number;
    singleCodedCases: number;
    unassignedCases: number;
    effectiveUnassignedCases: number;
    coveragePercentage: number;
    rawCoveragePercentage: number;
    aggregationActive: boolean;
    aggregationThreshold: number | null;
    aggregatedDuplicateCases: number;
    statusTotalCasesToCode: number;
    coveredSourceVariableCount: number;
    coveredSourceResponseCount: number;
  }> {
    const responseScope = await this.getCoverageResponseScope(workspaceId);
    const totalCasesToCode = responseScope.manualResponses.length;
    const manualResponseIds = new Set(
      responseScope.manualResponses.map(response => response.responseId)
    );
    const assignedCoverageResponseRows = await this.getAssignedCoverageResponseRows(workspaceId);
    const assignedManualResponseRows = assignedCoverageResponseRows.filter(
      responseId => manualResponseIds.has(responseId)
    );
    const casesInJobs = assignedManualResponseRows.length;
    const uniqueCasesInJobs = new Set(assignedManualResponseRows).size;

    const doubleCodedCases = casesInJobs - uniqueCasesInJobs;

    const singleCodedCases = uniqueCasesInJobs;
    const unassignedCases = totalCasesToCode - uniqueCasesInJobs;
    const rawCoveragePercentage =
      totalCasesToCode > 0 ? (uniqueCasesInJobs / totalCasesToCode) * 100 : 0;
    const effectiveCoverage = await this.getEffectiveCaseCoverage(
      workspaceId,
      responseScope.manualResponses
    );
    const coveragePercentage =
      effectiveCoverage.effectiveTotalCasesToCode > 0 ?
        (effectiveCoverage.effectiveCasesInJobs / effectiveCoverage.effectiveTotalCasesToCode) * 100 :
        0;

    return {
      totalCasesToCode,
      effectiveTotalCasesToCode: effectiveCoverage.effectiveTotalCasesToCode,
      casesInJobs,
      effectiveCasesInJobs: effectiveCoverage.effectiveCasesInJobs,
      doubleCodedCases,
      singleCodedCases,
      unassignedCases,
      effectiveUnassignedCases: effectiveCoverage.effectiveUnassignedCases,
      coveragePercentage,
      rawCoveragePercentage,
      aggregationActive: effectiveCoverage.aggregationActive,
      aggregationThreshold: effectiveCoverage.aggregationThreshold,
      aggregatedDuplicateCases: effectiveCoverage.aggregatedDuplicateCases,
      statusTotalCasesToCode: responseScope.statusTotalResponseCount,
      coveredSourceVariableCount:
        responseScope.excludedSourceSummary.coveredSourceVariableCount,
      coveredSourceResponseCount:
        responseScope.excludedSourceSummary.coveredSourceResponseCount
    };
  }

  private async getEffectiveCaseCoverage(
    workspaceId: number,
    providedResponses?: CoverageResponse[]
  ): Promise<EffectiveCaseCoverage> {
    const responses = providedResponses || (await this.getCoverageResponseScope(workspaceId)).manualResponses;
    const assignedResponseIds = await this.getAssignedCoverageResponseIds(workspaceId);
    const effectiveProgress = await this.getEffectiveCaseProgress(
      workspaceId,
      assignedResponseIds,
      responses
    );

    return {
      effectiveTotalCasesToCode: effectiveProgress.effectiveTotalCasesToCode,
      effectiveCasesInJobs: effectiveProgress.effectiveCompletedCases,
      effectiveUnassignedCases:
        effectiveProgress.effectiveTotalCasesToCode - effectiveProgress.effectiveCompletedCases,
      aggregationActive: effectiveProgress.aggregationActive,
      aggregationThreshold: effectiveProgress.aggregationThreshold,
      aggregatedDuplicateCases: effectiveProgress.aggregatedDuplicateCases
    };
  }

  private async getCoverageResponseScope(workspaceId: number): Promise<CoverageResponseScope> {
    const [statusTotalResponseCount, manualPoolResponses] = await Promise.all([
      this.getCoverageResponseCount(workspaceId),
      this.getCoverageResponses(workspaceId, true)
    ]);
    const codingIncompleteStatus = statusStringToNumber('CODING_INCOMPLETE');
    const intendedIncompleteStatus = statusStringToNumber('INTENDED_INCOMPLETE');
    const {
      validVariableSets,
      manualInstructionSets,
      derivedVariablesBySourceMap
    } = await this.getManualCodingVariableLookups(workspaceId);
    const coveredSourceKeys = getCoveredSourceKeysForManualDerivedVariables(
      manualPoolResponses
        .filter(response => response.statusV1 === codingIncompleteStatus)
        .filter(response => this.isValidManualVariable(response, validVariableSets))
        .map(response => ({
          unitName: response.unitName,
          variableId: response.variableId
        })),
      derivedVariablesBySourceMap
    );
    const intendedIncompleteBeforeSourceExclusion = manualPoolResponses.filter(response => (
      response.statusV1 === intendedIncompleteStatus &&
      this.isValidManualVariable(response, validVariableSets) &&
      this.hasManualInstruction(response, manualInstructionSets)
    ));
    const manualResponses = manualPoolResponses.filter(response => {
      if (response.statusV1 === codingIncompleteStatus) {
        return this.isValidManualVariable(response, validVariableSets);
      }

      if (response.statusV1 === intendedIncompleteStatus) {
        return this.isValidManualVariable(response, validVariableSets) &&
          this.hasManualInstruction(response, manualInstructionSets) &&
          !isCoveredSourceVariable(response, coveredSourceKeys);
      }

      return !isCoveredSourceVariable(response, coveredSourceKeys);
    });
    const excludedSourceSummary = summarizeCoveredSourceVariables(
      intendedIncompleteBeforeSourceExclusion
        .map(response => ({
          unitName: response.unitName,
          variableId: response.variableId,
          responseCount: 1
        })),
      coveredSourceKeys,
      derivedVariablesBySourceMap
    );

    return {
      statusTotalResponseCount,
      manualResponses,
      excludedSourceSummary
    };
  }

  private async getDeriveErrorManualProgress(
    workspaceId: number,
    responses: CoverageResponse[],
    appliedResponseIds: Set<number>
  ): Promise<DeriveErrorManualProgress> {
    const deriveErrorStatus = statusStringToNumber('DERIVE_ERROR');
    const deriveErrorResponses = responses.filter(response => response.statusV1 === deriveErrorStatus);
    const deriveErrorAppliedResponseIds = new Set(
      deriveErrorResponses
        .filter(response => appliedResponseIds.has(response.responseId))
        .map(response => response.responseId)
    );
    const effectiveProgress = await this.getEffectiveCaseProgress(
      workspaceId,
      deriveErrorAppliedResponseIds,
      deriveErrorResponses
    );

    return {
      deriveErrorTotalResponses: effectiveProgress.effectiveTotalCasesToCode,
      deriveErrorAppliedResponses: effectiveProgress.effectiveCompletedCases,
      deriveErrorRemainingResponses: Math.max(
        0,
        effectiveProgress.effectiveTotalCasesToCode - effectiveProgress.effectiveCompletedCases
      ),
      deriveErrorRawTotalResponses: deriveErrorResponses.length,
      deriveErrorRawAppliedResponses: deriveErrorAppliedResponseIds.size
    };
  }

  private applyManualProgressStatusFilter(
    query: ManualProgressStatusQuery,
    method: 'where' | 'andWhere' = 'where'
  ): void {
    const deriveErrorStatus = statusStringToNumber('DERIVE_ERROR');
    query[method](new Brackets(qb => {
      qb.where('response.status_v1 IN (:...statuses)', {
        statuses: [
          statusStringToNumber('CODING_INCOMPLETE'),
          statusStringToNumber('INTENDED_INCOMPLETE')
        ]
      }).orWhere(
        `response.status_v1 = :deriveErrorStatus
          AND EXISTS (
            SELECT 1
            FROM coding_job_unit manual_derive_cju
            INNER JOIN coding_job manual_derive_cj
              ON manual_derive_cj.id = manual_derive_cju.coding_job_id
            WHERE manual_derive_cju.response_id = response.id
              AND manual_derive_cj.training_id IS NULL
              AND ${getNonCodingIssueReviewJobSqlCondition('manual_derive_cj')}
          )`,
        { deriveErrorStatus }
      );
    }));
  }

  private async getEffectiveCaseProgress(
    workspaceId: number,
    completedResponseIds: Set<number>,
    providedResponses?: CoverageResponse[]
  ): Promise<EffectiveCaseProgress> {
    const responses = providedResponses || await this.getCoverageResponses(workspaceId);
    const aggregationThreshold = await this.getAggregationThreshold(workspaceId);
    const matchingFlags = await this.getResponseMatchingMode(workspaceId);
    const aggregationActive =
      aggregationThreshold !== null && !matchingFlags.includes('NO_AGGREGATION');

    if (!aggregationActive) {
      const effectiveCompletedCases = responses
        .filter(response => completedResponseIds.has(response.responseId))
        .length;

      return {
        effectiveTotalCasesToCode: responses.length,
        effectiveCompletedCases,
        aggregationActive,
        aggregationThreshold,
        aggregatedDuplicateCases: 0
      };
    }

    const derivedVariableMap = await this.getDerivedVariableMap(workspaceId);
    const groupedResponses = buildAggregationGroups(
      responses,
      matchingFlags,
      aggregationThreshold,
      derivedVariableMap
    );
    const aggregationSummary = summarizeAggregationGroups(
      groupedResponses,
      responses.length,
      aggregationThreshold,
      matchingFlags
    );

    let effectiveTotalCasesToCode = 0;
    let effectiveCasesInJobs = 0;

    groupedResponses.forEach(group => {
      if (aggregationThreshold !== null && group.responses.length >= aggregationThreshold) {
        effectiveTotalCasesToCode += 1;
        if (group.responses.some(response => completedResponseIds.has(response.responseId))) {
          effectiveCasesInJobs += 1;
        }
      } else {
        effectiveTotalCasesToCode += group.responses.length;
        effectiveCasesInJobs += group.responses
          .filter(response => completedResponseIds.has(response.responseId))
          .length;
      }
    });

    return {
      effectiveTotalCasesToCode,
      effectiveCompletedCases: effectiveCasesInJobs,
      aggregationActive,
      aggregationThreshold,
      aggregatedDuplicateCases: aggregationSummary.collapsedCases
    };
  }

  private async getCoverageResponses(
    workspaceId: number,
    manualPoolOnly = false
  ): Promise<CoverageResponse[]> {
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const query = this.responseRepository
      .createQueryBuilder('response')
      .select('response.id', 'responseId')
      .addSelect('response.value', 'value')
      .addSelect('response.code_v2', 'codeV2')
      .addSelect('response.status_v2', 'statusV2')
      .addSelect('response.status_v1', 'statusV1')
      .addSelect('response.variableid', 'variableId')
      .addSelect('unit.name', 'unitName')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .leftJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });
    this.applyManualProgressStatusFilter(query, 'andWhere');

    if (manualPoolOnly) {
      query.leftJoin(
        subQuery => subQuery
          .select('DISTINCT manual_cju.response_id', 'response_id')
          .from('coding_job_unit', 'manual_cju')
          .innerJoin(
            'coding_job',
            'manual_cj',
            'manual_cj.id = manual_cju.coding_job_id'
          )
          .where('manual_cj.training_id IS NULL')
          .andWhere(getNonCodingIssueReviewJobSqlCondition('manual_cj')),
        'assigned_manual_response',
        'assigned_manual_response.response_id = response.id'
      );
      query.andWhere(new Brackets(qb => {
        qb.where('response.code_v2 IS NULL')
          .orWhere('assigned_manual_response.response_id IS NOT NULL');
      }));
    } else {
      query.andWhere(
        '(response.code_v2 IS NULL OR (response.code_v2 != :aggregatedCode AND response.code_v2 != :defaultMirCode))',
        { aggregatedCode: -111, defaultMirCode: await this.getDefaultMirCode(workspaceId) }
      );
    }

    applyResolvedExclusionsToQuery(
      query,
      exclusions,
      {
        parameterPrefix: manualPoolOnly ?
          'coverageResponsesManualPool' :
          'coverageResponses'
      }
    );
    const raw = await query.getRawMany();

    return raw.map(row => ({
      responseId: Number(row.responseId),
      value: row.value ?? null,
      codeV2: row.codeV2 === null || row.codeV2 === undefined ? null : Number(row.codeV2),
      statusV2: row.statusV2 === null || row.statusV2 === undefined ? null : Number(row.statusV2),
      statusV1: row.statusV1 === null || row.statusV1 === undefined ? null : Number(row.statusV1),
      variableId: row.variableId,
      unitName: row.unitName
    }));
  }

  private async getCoverageResponseCount(workspaceId: number): Promise<number> {
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const defaultMirCode = await this.getDefaultMirCode(workspaceId);
    const params: unknown[] = [
      workspaceId,
      true,
      statusStringToNumber('CODING_INCOMPLETE'),
      statusStringToNumber('INTENDED_INCOMPLETE'),
      statusStringToNumber('DERIVE_ERROR'),
      -111,
      defaultMirCode
    ];
    const exclusionSql = this.buildCoverageResponseCountExclusionSql(
      exclusions,
      params
    );
    const rows = await this.responseRepository.query(
      `
        WITH scoped_units AS MATERIALIZED (
          SELECT unit.id
          FROM persons person
          INNER JOIN booklet booklet
            ON booklet.personid = person.id
          INNER JOIN unit unit
            ON unit.bookletid = booklet.id
          LEFT JOIN bookletinfo bookletinfo
            ON bookletinfo.id = booklet.infoid
          WHERE person.workspace_id = $1
            AND person.consider = $2
            ${exclusionSql}
        ),
        manual_derive_responses AS MATERIALIZED (
          SELECT DISTINCT manual_derive_cju.response_id
          FROM coding_job_unit manual_derive_cju
          INNER JOIN coding_job manual_derive_cj
            ON manual_derive_cj.id = manual_derive_cju.coding_job_id
          WHERE manual_derive_cj.training_id IS NULL
            AND ${getNonCodingIssueReviewJobSqlCondition('manual_derive_cj')}
        )
        SELECT COUNT(response.id) AS count
        FROM scoped_units
        INNER JOIN response response
          ON response.unitid = scoped_units.id
        LEFT JOIN manual_derive_responses
          ON manual_derive_responses.response_id = response.id
        WHERE (
          response.status_v1 IN ($3, $4)
          OR (
            response.status_v1 = $5
            AND manual_derive_responses.response_id IS NOT NULL
          )
        )
          AND (
            response.code_v2 IS NULL
            OR (response.code_v2 != $6 AND response.code_v2 != $7)
          )
      `,
      params
    ) as Array<{ count?: number | string }>;
    return Number(rows[0]?.count || 0);
  }

  private buildCoverageResponseCountExclusionSql(
    exclusions: ResolvedWorkspaceExclusions,
    params: unknown[]
  ): string {
    const conditions: string[] = [];
    const unitNameSql = 'REGEXP_REPLACE(UPPER(unit.name), \'\\.XML$\', \'\', \'i\')';
    const bookletNameSql = 'UPPER(bookletinfo.name)';

    if (exclusions.globalIgnoredUnits.length > 0) {
      const placeholders = exclusions.globalIgnoredUnits.map(value => {
        params.push(normalizeExclusionUnitId(value));
        return `$${params.length}`;
      });
      conditions.push(`${unitNameSql} NOT IN (${placeholders.join(', ')})`);
    }

    if (exclusions.ignoredBooklets.length > 0) {
      const placeholders = exclusions.ignoredBooklets.map(value => {
        params.push(normalizeExclusionBookletId(value));
        return `$${params.length}`;
      });
      conditions.push(`${bookletNameSql} NOT IN (${placeholders.join(', ')})`);
    }

    if (exclusions.testletIgnoredUnits.length > 0) {
      const pairConditions = exclusions.testletIgnoredUnits.map(exclusion => {
        params.push(normalizeExclusionBookletId(exclusion.bookletId));
        const bookletPlaceholder = `$${params.length}`;
        params.push(normalizeExclusionUnitId(exclusion.unitId));
        const unitPlaceholder = `$${params.length}`;
        return `(${bookletNameSql} = ${bookletPlaceholder} AND ${unitNameSql} = ${unitPlaceholder})`;
      });
      conditions.push(`NOT (${pairConditions.join(' OR ')})`);
    }

    return conditions.length > 0 ?
      `AND ${conditions.join('\n            AND ')}` :
      '';
  }

  private async getAssignedCoverageResponseRows(workspaceId: number): Promise<number[]> {
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .select('cju.response_id', 'responseId')
      .innerJoin('cju.response', 'response')
      .leftJoin('cju.coding_job', 'coding_job')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .leftJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('coding_job.training_id IS NULL')
      .andWhere(new Brackets(qb => {
        qb.where('response.code_v2 IS NULL')
          .orWhere(subQuery => {
            const exists = subQuery
              .subQuery()
              .select('1')
              .from('coding_job_unit', 'cju')
              .where('cju.response_id = response.id')
              .getQuery();
            return `EXISTS (${exists})`;
          });
      }));
    applyNonCodingIssueReviewJobFilter(
      query,
      'coding_job',
      'assignedCoverageRowsReviewJobType'
    );
    this.applyManualProgressStatusFilter(query, 'andWhere');
    applyResolvedExclusionsToQuery(query, exclusions, { parameterPrefix: 'assignedCoverageRows' });
    const raw = await query.getRawMany();
    return raw
      .map(row => Number(row.responseId))
      .filter(responseId => Number.isFinite(responseId));
  }

  private async getCompletedCoverageResponseIds(workspaceId: number): Promise<Set<number>> {
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'coding_job')
      .innerJoin('cju.response', 'response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .innerJoin('booklet.person', 'person')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.training_id IS NULL')
      .andWhere('cju.code IS NOT NULL')
      .andWhere('person.consider = :consider', { consider: true })
      .select('DISTINCT cju.response_id', 'responseId');
    applyNonCodingIssueReviewJobFilter(
      query,
      'coding_job',
      'completedCoverageReviewJobType'
    );
    this.applyManualProgressStatusFilter(query, 'andWhere');
    applyResolvedExclusionsToQuery(query, exclusions, { parameterPrefix: 'completedCoverage' });
    const raw = await query.getRawMany();

    return new Set(raw.map(row => Number(row.responseId)));
  }

  private isAppliedResultResponse(response: CoverageResponse): boolean {
    const appliedStatuses = [
      statusStringToNumber('CODING_COMPLETE'),
      statusStringToNumber('INVALID'),
      statusStringToNumber('CODING_ERROR')
    ];

    return (
      response.statusV2 !== null &&
      appliedStatuses.includes(response.statusV2) &&
      (response.codeV2 === null || response.codeV2 >= 0)
    );
  }

  private async getAssignedCoverageResponseIds(workspaceId: number): Promise<Set<number>> {
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .select('DISTINCT cju.response_id', 'responseId')
      .innerJoin('cju.response', 'response')
      .leftJoin('cju.coding_job', 'coding_job')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .leftJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('coding_job.training_id IS NULL')
      .andWhere(new Brackets(qb => {
        qb.where('response.code_v2 IS NULL')
          .orWhere(subQuery => {
            const exists = subQuery
              .subQuery()
              .select('1')
              .from('coding_job_unit', 'cju')
              .where('cju.response_id = response.id')
              .getQuery();
            return `EXISTS (${exists})`;
          });
      }));
    applyNonCodingIssueReviewJobFilter(
      query,
      'coding_job',
      'assignedCoverageReviewJobType'
    );
    this.applyManualProgressStatusFilter(query, 'andWhere');
    applyResolvedExclusionsToQuery(query, exclusions, { parameterPrefix: 'assignedCoverage' });
    const raw = await query.getRawMany();

    return new Set(raw.map(row => Number(row.responseId)));
  }

  private async getAggregationThreshold(workspaceId: number): Promise<number | null> {
    const setting = await this.settingRepository.findOne({
      where: { key: `workspace-${workspaceId}-duplicate-aggregation-threshold` }
    });

    if (!setting) {
      return 2;
    }

    if (setting.content === 'disabled' || setting.content === '0') {
      return null;
    }

    const parsedThreshold = parseInt(setting.content, 10);
    return Number.isNaN(parsedThreshold) ? 2 : parsedThreshold;
  }

  private async getResponseMatchingMode(workspaceId: number): Promise<ResponseMatchingFlag[]> {
    const setting = await this.settingRepository.findOne({
      where: { key: `workspace-${workspaceId}-response-matching-mode` }
    });

    if (!setting) {
      return [];
    }

    try {
      const parsed = JSON.parse(setting.content);
      return Array.isArray(parsed.flags) ? parsed.flags : [];
    } catch {
      return [];
    }
  }

  private async getDerivedVariableMap(workspaceId: number): Promise<Map<string, Set<string>>> {
    try {
      return await this.workspaceFilesService.getDerivedVariableMap(workspaceId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not load derived variable map for workspace ${workspaceId}: ${message}`);
      return new Map<string, Set<string>>();
    }
  }

  private async getManualCodingVariableLookups(
    workspaceId: number
  ): Promise<ManualCodingVariableLookups> {
    const [
      unitVariableMap,
      derivedVariablesBySourceMap,
      manualInstructionMap
    ] = await Promise.all([
      this.workspaceFilesService.getUnitVariableMap(workspaceId),
      this.workspaceFilesService.getDerivedVariablesBySourceMap(workspaceId),
      this.workspaceFilesService.getManualInstructionVariableMap(workspaceId)
    ]);

    return {
      validVariableSets: this.toUppercaseVariableSetMap(unitVariableMap),
      manualInstructionSets: this.toUppercaseVariableSetMap(manualInstructionMap),
      derivedVariablesBySourceMap
    };
  }

  private toUppercaseVariableSetMap(
    variableMap: Map<string, Set<string>>
  ): Map<string, Set<string>> {
    const normalized = new Map<string, Set<string>>();
    variableMap.forEach((variables: Set<string>, unitNameKey: string) => {
      normalized.set(unitNameKey.toUpperCase(), variables);
    });
    return normalized;
  }

  private isValidManualVariable(
    row: UnitVariableReference,
    validVariableSets: Map<string, Set<string>>
  ): boolean {
    const validVars = validVariableSets.get(row.unitName?.toUpperCase());
    return validVars?.has(row.variableId) || false;
  }

  private hasManualInstruction(
    row: UnitVariableReference,
    manualInstructionSets: Map<string, Set<string>>
  ): boolean {
    const manualVars = manualInstructionSets.get(row.unitName?.toUpperCase());
    return manualVars?.has(row.variableId) || false;
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
    statusTotalVariables: number;
    coveredSourceVariableCount: number;
    coveredSourceResponseCount: number;
  }> {
    try {
      this.logger.log(
        `Getting variable coverage overview for workspace ${workspaceId} (manual coding variables)`
      );

      const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
      const incompleteVariablesQuery = this.responseRepository
        .createQueryBuilder('response')
        .select('unit.name', 'unitName')
        .addSelect('response.variableid', 'variableId')
        .addSelect('response.status_v1', 'statusV1')
        .addSelect('COUNT(response.id)', 'caseCount')
        .leftJoin('response.unit', 'unit')
        .leftJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.bookletinfo', 'bookletinfo')
        .leftJoin('booklet.person', 'person')
        .where('response.status_v1 IN (:...statuses)', {
          statuses: [
            statusStringToNumber('CODING_INCOMPLETE'),
            statusStringToNumber('INTENDED_INCOMPLETE')
          ]
        })
        .andWhere('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        // Exclude pre-processed responses (not in manual coding pool)
        .andWhere(new Brackets(qb => {
          qb.where('response.code_v2 IS NULL')
            .orWhere(subQuery => {
              const exists = subQuery
                .subQuery()
                .select('1')
                .from('coding_job_unit', 'manual_cju')
                .innerJoin('coding_job', 'manual_cj', 'manual_cj.id = manual_cju.coding_job_id')
                .where('manual_cju.response_id = response.id')
                .andWhere('manual_cj.training_id IS NULL')
                .andWhere(getNonCodingIssueReviewJobSqlCondition('manual_cj'))
                .getQuery();
              return `EXISTS (${exists})`;
            });
        }))
        .groupBy('unit.name')
        .addGroupBy('response.variableid')
        .addGroupBy('response.status_v1');
      applyResolvedExclusionsToQuery(incompleteVariablesQuery, exclusions, { parameterPrefix: 'variableCoverage' });
      const incompleteVariablesResult = await incompleteVariablesQuery.getRawMany();

      const codingIncompleteStatus = statusStringToNumber('CODING_INCOMPLETE');
      const {
        validVariableSets,
        manualInstructionSets,
        derivedVariablesBySourceMap
      } = await this.getManualCodingVariableLookups(workspaceId);
      const coveredSourceKeys = getCoveredSourceKeysForManualDerivedVariables(
        incompleteVariablesResult
          .filter(row => Number(row.statusV1) === codingIncompleteStatus)
          .filter(row => this.isValidManualVariable(row, validVariableSets))
          .map(row => ({
            unitName: row.unitName,
            variableId: row.variableId
          })),
        derivedVariablesBySourceMap
      );
      const filteredIntendedIncompleteBeforeSourceExclusion =
        incompleteVariablesResult.filter(row => (
          Number(row.statusV1) !== codingIncompleteStatus &&
          this.isValidManualVariable(row, validVariableSets) &&
          this.hasManualInstruction(row, manualInstructionSets)
        ));
      const filteredIncompleteVariablesResult = incompleteVariablesResult.filter(row => {
        if (!this.isValidManualVariable(row, validVariableSets)) {
          return false;
        }

        if (Number(row.statusV1) === codingIncompleteStatus) {
          return true;
        }

        return this.hasManualInstruction(row, manualInstructionSets) &&
          !isCoveredSourceVariable(row, coveredSourceKeys);
      });
      const excludedSourceSummary = summarizeCoveredSourceVariables(
        filteredIntendedIncompleteBeforeSourceExclusion
          .map(row => ({
            unitName: row.unitName,
            variableId: row.variableId,
            responseCount: row.caseCount
          })),
        coveredSourceKeys,
        derivedVariablesBySourceMap
      );

      const variablesNeedingCoding = new Set<string>();
      const variableCaseCounts: {
        unitName: string;
        variableId: string;
        caseCount: number;
      }[] = [];
      const variableCaseCountMap = new Map<string, {
        unitName: string;
        variableId: string;
        caseCount: number;
      }>();

      filteredIncompleteVariablesResult.forEach(row => {
        const variableKey = `${row.unitName}:${row.variableId}`;
        const existing = variableCaseCountMap.get(variableKey);
        if (existing) {
          existing.caseCount += parseInt(row.caseCount, 10);
          return;
        }
        variableCaseCountMap.set(variableKey, {
          unitName: row.unitName,
          variableId: row.variableId,
          caseCount: parseInt(row.caseCount, 10)
        });
      });

      variableCaseCountMap.forEach(row => {
        const variableKey = `${row.unitName}:${row.variableId}`;
        variablesNeedingCoding.add(variableKey);
        variableCaseCounts.push(row);
      });

      const jobDefinitions = await this.jobDefinitionRepository.find({
        where: { workspace_id: workspaceId }
      });

      const coveredVariables = new Set<string>();
      const coverageByStatus = {
        draft: new Set<string>(),
        pending_review: new Set<string>(),
        approved: new Set<string>()
      };

      const variableToDefinitions = new Map<
      string,
      Array<{ id: number; status: string }>
      >();

      for (const definition of jobDefinitions) {
        const definitionVariables = new Set<string>();

        if (definition.assigned_variables) {
          definition.assigned_variables.forEach(variable => {
            const variableKey = `${variable.unitName}:${variable.variableId}`;
            if (variablesNeedingCoding.has(variableKey)) {
              definitionVariables.add(variableKey);
            }
          });
        }

        if (definition.assigned_variable_bundles) {
          const bundleIds = definition.assigned_variable_bundles.map(
            bundle => bundle.id
          );
          const variableBundles = await this.variableBundleRepository.find({
            where: { id: In(bundleIds) }
          });

          variableBundles.forEach(bundle => {
            if (bundle.variables) {
              bundle.variables.forEach(variable => {
                const variableKey = `${variable.unitName}:${variable.variableId}`;
                if (variablesNeedingCoding.has(variableKey)) {
                  definitionVariables.add(variableKey);
                }
              });
            }
          });
        }

        definitionVariables.forEach(variableKey => {
          coveredVariables.add(variableKey);
          coverageByStatus[definition.status].add(variableKey);

          if (!variableToDefinitions.has(variableKey)) {
            variableToDefinitions.set(variableKey, []);
          }
          variableToDefinitions.get(variableKey)!.push({
            id: definition.id,
            status: definition.status
          });
        });
      }

      // Get cases in jobs map for conflict detection
      const casesInJobsMap = await this.getVariableCasesInJobs(workspaceId);

      const crossDefinitionCaseConflicts = await this.getCrossDefinitionCaseConflicts(workspaceId);
      const conflictedVariables = new Map<string, VariableDefinitionReference[]>();
      variableToDefinitions.forEach((definitions, variableKey) => {
        if (definitions.length <= 1) {
          return;
        }

        const crossDefinitionConflicts = crossDefinitionCaseConflicts.get(variableKey);
        if (crossDefinitionConflicts && crossDefinitionConflicts.length > 1) {
          conflictedVariables.set(variableKey, crossDefinitionConflicts);
        }
      });

      const missingVariables = new Set<string>();
      const partiallyAbgedeckteVariablen = new Set<string>();
      const fullyAbgedeckteVariablen = new Set<string>();

      variablesNeedingCoding.forEach(variableKey => {
        if (!coveredVariables.has(variableKey)) {
          missingVariables.add(variableKey);
          return;
        }

        // Check if variable is fully or partially covered based on cases in jobs
        const variableCaseInfo = variableCaseCounts.find(
          v => `${v.unitName}:${v.variableId}` === variableKey
        );

        if (variableCaseInfo) {
          const casesInJobs =
            casesInJobsMap.get(
              `${variableCaseInfo.unitName}::${variableCaseInfo.variableId}`
            ) || 0;

          if (casesInJobs >= variableCaseInfo.caseCount) {
            fullyAbgedeckteVariablen.add(variableKey);
          } else if (casesInJobs > 0) {
            partiallyAbgedeckteVariablen.add(variableKey);
          }
        }
      });

      const totalVariables = variablesNeedingCoding.size;
      const coveredCount = coveredVariables.size;
      const draftCount = coverageByStatus.draft.size;
      const pendingReviewCount = coverageByStatus.pending_review.size;
      const approvedCount = coverageByStatus.approved.size;
      const conflictCount = conflictedVariables.size;
      const missingCount = missingVariables.size;
      const partiallyAbgedeckteCount = partiallyAbgedeckteVariablen.size;
      const fullyAbgedeckteCount = fullyAbgedeckteVariablen.size;
      const coveragePercentage =
        totalVariables > 0 ? (coveredCount / totalVariables) * 100 : 0;

      this.logger.log(
        `Variable coverage for workspace ${workspaceId}: ${coveredCount}/${totalVariables} manual coding variables covered (${coveragePercentage.toFixed(
          1
        )}%) - Draft: ${draftCount}, Pending: ${pendingReviewCount}, Approved: ${approvedCount}, Conflicted: ${conflictCount}, Fully covered: ${fullyAbgedeckteCount}, Partially covered: ${partiallyAbgedeckteCount}`
      );

      return {
        totalVariables,
        coveredVariables: coveredCount,
        coveredByDraft: draftCount,
        coveredByPendingReview: pendingReviewCount,
        coveredByApproved: approvedCount,
        conflictedVariables: conflictCount,
        missingVariables: missingCount,
        partiallyAbgedeckteVariablen: partiallyAbgedeckteCount,
        fullyAbgedeckteVariablen: fullyAbgedeckteCount,
        coveragePercentage,
        variableCaseCounts,
        coverageByStatus: {
          draft: Array.from(coverageByStatus.draft),
          pending_review: Array.from(coverageByStatus.pending_review),
          approved: Array.from(coverageByStatus.approved),
          conflicted: Array.from(conflictedVariables.entries()).map(
            ([variableKey, definitions]) => ({
              variableKey,
              conflictingDefinitions: definitions
            })
          )
        },
        statusTotalVariables: new Set(
          incompleteVariablesResult.map(row => `${row.unitName}:${row.variableId}`)
        ).size,
        coveredSourceVariableCount:
          excludedSourceSummary.coveredSourceVariableCount,
        coveredSourceResponseCount:
          excludedSourceSummary.coveredSourceResponseCount
      };
    } catch (error) {
      this.logger.error(
        `Error getting variable coverage overview: ${error.message}`,
        error.stack
      );
      throw new Error(
        'Could not get variable coverage overview. Please check the database connection.'
      );
    }
  }

  private async getVariableCasesInJobs(
    workspaceId: number
  ): Promise<Map<string, number>> {
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .select('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .addSelect('COUNT(DISTINCT cju.response_id)', 'casesInJobs')
      .leftJoin('cju.coding_job', 'coding_job')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.training_id IS NULL')
      .groupBy('cju.unit_name')
      .addGroupBy('cju.variable_id');
    applyNonCodingIssueReviewJobFilter(
      query,
      'coding_job',
      'variableCasesInJobsReviewJobType'
    );
    applyResolvedExclusionsToQuery(query, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix: 'variableCasesInJobs'
    });
    const rawResults = await query.getRawMany();

    const casesInJobsMap = new Map<string, number>();

    rawResults.forEach(row => {
      const key = `${row.unitName}::${row.variableId}`;
      casesInJobsMap.set(key, parseInt(row.casesInJobs, 10));
    });

    return casesInJobsMap;
  }

  private async getCrossDefinitionCaseConflicts(
    workspaceId: number
  ): Promise<Map<string, VariableDefinitionReference[]>> {
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .select('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .addSelect('cju.response_id', 'responseId')
      .addSelect('job_definition.id', 'definitionId')
      .addSelect('job_definition.status', 'definitionStatus')
      .innerJoin('cju.coding_job', 'coding_job')
      .innerJoin('coding_job.jobDefinition', 'job_definition')
      .innerJoin('cju.response', 'response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .innerJoin('booklet.person', 'person')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.training_id IS NULL')
      .andWhere('response.status_v1 IN (:...statuses)', {
        statuses: [
          statusStringToNumber('CODING_INCOMPLETE'),
          statusStringToNumber('INTENDED_INCOMPLETE')
        ]
      })
      .andWhere('person.consider = :consider', { consider: true });
    applyNonCodingIssueReviewJobFilter(
      query,
      'coding_job',
      'crossDefinitionConflictsReviewJobType'
    );
    applyResolvedExclusionsToQuery(query, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix: 'crossDefinitionCaseConflicts'
    });
    const rawResults: CrossDefinitionCaseRow[] = await query.getRawMany();
    const definitionsByCaseKey = new Map<string, Map<number, VariableDefinitionReference>>();
    const variableKeyByCaseKey = new Map<string, string>();

    rawResults.forEach(row => {
      const definitionId = Number(row.definitionId);
      const responseId = Number(row.responseId);

      if (!Number.isFinite(definitionId) || !Number.isFinite(responseId)) {
        return;
      }

      const variableKey = `${row.unitName}:${row.variableId}`;
      const caseKey = `${row.unitName}::${row.variableId}::${responseId}`;
      const caseDefinitions = definitionsByCaseKey.get(caseKey) || new Map<number, VariableDefinitionReference>();

      caseDefinitions.set(definitionId, {
        id: definitionId,
        status: row.definitionStatus
      });
      definitionsByCaseKey.set(caseKey, caseDefinitions);
      variableKeyByCaseKey.set(caseKey, variableKey);
    });

    const conflictsByVariable = new Map<string, Map<number, VariableDefinitionReference>>();

    definitionsByCaseKey.forEach((definitions, caseKey) => {
      if (definitions.size <= 1) {
        return;
      }

      const variableKey = variableKeyByCaseKey.get(caseKey);
      if (!variableKey) {
        return;
      }

      const variableDefinitions = conflictsByVariable.get(variableKey) || new Map<number, VariableDefinitionReference>();
      definitions.forEach(definition => variableDefinitions.set(definition.id, definition));
      conflictsByVariable.set(variableKey, variableDefinitions);
    });

    return new Map(Array.from(conflictsByVariable.entries()).map(([variableKey, definitions]) => [
      variableKey,
      Array.from(definitions.values()).sort((a, b) => a.id - b.id)
    ]));
  }
}
