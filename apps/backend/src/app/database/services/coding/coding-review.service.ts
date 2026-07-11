import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CodingJobCoder } from '../../entities/coding-job-coder.entity';
import { JobDefinition } from '../../entities/job-definition.entity';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import { CodingStatisticsService } from './coding-statistics.service';
import {
  applyResolvedExclusionsToQuery,
  isExcludedByResolvedExclusions,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import { MissingsProfilesService, ResolvedMissingValue } from './missings-profiles.service';
import {
  applyNonCodingIssueReviewJobFilter,
  isCodingIssueReviewJobType
} from './coding-job-type.util';
import { CodingJobService } from './coding-job.service';
import { CodingAnalysisService } from './coding-analysis.service';
import { CodingValidationService } from './coding-validation.service';

type JobDefinitionBundleScope = {
  bundleIds: number[];
  variableKeysByBundleId: Map<number, Set<string>>;
};

type ReviewCoderResult = {
  coderId: number;
  coderName: string;
  jobId: number;
  jobName: string;
  jobDefinitionId: number | null;
  trainingId: number | null;
  trainingLabel: string | null;
  code: number | null;
  codingIssueOption?: number | null;
  score: number | null;
  notes: string | null;
  supervisorComment: string | null;
  codedAt: Date;
};

type AppliedReviewResult = {
  appliedCode: number | null;
  appliedScore: number | null;
  appliedComment: string | null;
};

type KappaCalculationLevel = 'code' | 'score';

type DoubleCodedResolutionDecision = {
  responseId: number;
  selectedJobId?: number | null;
  code?: number | null;
  score?: number | null;
  resolutionComment?: string;
};

type ResolvedDoubleCodedResolution = {
  response: ResponseEntity;
  sourceUnit: CodingJobUnit;
  code: number | null;
  score: number | null;
};

type KappaCodedVariableRow = {
  responseId: number | string;
  unitName: string;
  variableId: string;
  variableAnchor: string | null;
  personLogin: string;
  personCode: string;
  personGroup: string;
  bookletName: string | null;
  coderId: number | string;
  coderName: string | null;
  jobId: number | string;
  jobName: string | null;
  jobDefinitionId: number | string | null;
  trainingId: number | string | null;
  trainingLabel: string | null;
  code: number | string | null;
  score: number | string | null;
  notes: string | null;
  supervisorComment: string | null;
  codedAt: Date | string;
};

@Injectable()
export class CodingReviewService {
  private readonly logger = new Logger(CodingReviewService.name);
  private readonly allowedCodingIssueCodes = new Set([-1, -2, -3, -4]);
  private readonly manualMissingIdsByIssueOptionId = new Map<number, string>([
    [-3, 'mir'],
    [-4, 'mci']
  ]);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    @InjectRepository(JobDefinition)
    private jobDefinitionRepository: Repository<JobDefinition>,
    @InjectRepository(VariableBundle)
    private variableBundleRepository: Repository<VariableBundle>,
    private codingStatisticsService: CodingStatisticsService,
    private codingAnalysisService: CodingAnalysisService,
    private codingValidationService: CodingValidationService,
    private workspaceExclusionService: WorkspaceExclusionService,
    private codingJobService: CodingJobService,
    @Optional()
    private missingsProfilesService?: MissingsProfilesService
  ) { }

  private async resolveManualMissingForReview(
    workspaceId: number,
    unit: CodingJobUnit,
    cache: Map<string, ResolvedMissingValue>
  ): Promise<{ code: number | null; score: number | null }> {
    const missingId = this.manualMissingIdsByIssueOptionId.get(unit.code ?? 0) ??
      this.manualMissingIdsByIssueOptionId.get(unit.coding_issue_option ?? 0);
    if (!missingId || !this.missingsProfilesService) {
      return {
        code: unit.code,
        score: unit.score
      };
    }

    const profileId = unit.coding_job?.missings_profile_id ?? null;
    const cacheKey = `${profileId ?? 'default'}:${missingId}`;
    let missing = cache.get(cacheKey);
    if (!missing) {
      missing = await this.missingsProfilesService.getMissingByIdForProfileOrDefault(
        workspaceId,
        profileId,
        missingId
      );
      cache.set(cacheKey, missing);
    }

    return {
      code: missing.code,
      score: missing.score
    };
  }

  async getDoubleCodedVariablesForReview(
    workspaceId: number,
    page: number = 1,
    limit: number = 50,
    onlyConflicts: boolean = false,
    excludeTrainings: boolean = false,
    search?: string,
    coderId?: number,
    statusFilter?: string,
    resolvedFilter?: string,
    agreementFilter?: 'all' | 'match' | 'differ',
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    includeRelations: boolean = true
  ): Promise<{
      data: Array<{
        responseId: number;
        unitName: string;
        variableId: string;
        personLogin: string;
        personCode: string;
        personGroup: string;
        bookletName: string;
        givenAnswer: string;
        isResolved: boolean;
        appliedCode: number | null;
        appliedScore: number | null;
        appliedComment: string | null;
        coderResults: Array<{
          coderId: number;
          coderName: string;
          jobId: number;
          jobName: string;
          jobDefinitionId: number | null;
          trainingId: number | null;
          trainingLabel: string | null;
          code: number | null;
          codingIssueOption: number | null;
          score: number | null;
          notes: string | null;
          supervisorComment: string | null;
          codedAt: Date;
        }>;
      }>;
      total: number;
      page: number;
      limit: number;
    }> {
    try {
      this.logger.log(
        `Getting double-coded variables for review in workspace ${workspaceId} (onlyConflicts=${onlyConflicts}, agreementFilter=${agreementFilter}, resolvedFilter=${resolvedFilter}, jobDefinitionFilters=${jobDefinitionIds?.length || 0}, trainingFilters=${coderTrainingIds?.length || 0})`
      );
      const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
      const scopedJobDefinitionBundleScope = await this.getJobDefinitionBundleScope(workspaceId, jobDefinitionIds);
      const query = this.codingJobUnitRepository
        .createQueryBuilder('cju')
        .leftJoin('cju.coding_job', 'cj')
        .innerJoin(
          subQuery => subQuery
            .select('single_cjc.coding_job_id', 'coding_job_id')
            .addSelect('MIN(single_cjc.user_id)', 'user_id')
            .from(CodingJobCoder, 'single_cjc')
            .groupBy('single_cjc.coding_job_id')
            .having('COUNT(DISTINCT single_cjc.user_id) = 1'),
          'review_coder',
          'review_coder.coding_job_id = cj.id'
        )
        .leftJoin('cju.response', 'resp')
        .leftJoin('resp.unit', 'u')
        .leftJoin('u.booklet', 'b')
        .leftJoin('b.person', 'p')
        .select('cju.response_id', 'responseId')
        .addSelect('COUNT(DISTINCT cju.coding_job_id)', 'jobCount')
        .addSelect('resp.status_v2', 'responseStatus')
        .where('cj.workspace_id = :workspaceId', { workspaceId })
        .groupBy('cju.response_id')
        .addGroupBy('resp.status_v2')
        .having('COUNT(DISTINCT review_coder.user_id) > 1'); // Multiple single-coder decisions for this response
      applyNonCodingIssueReviewJobFilter(
        query,
        'cj',
        'reviewBaseReviewJobType'
      );
      applyResolvedExclusionsToQuery(query, exclusions, {
        unitNameExpression: 'cju.unit_name',
        bookletNameExpression: 'cju.booklet_name',
        parameterPrefix: 'doubleCodedReview'
      });
      const dedupedReviewResultsSql = this.getDedupedReviewResultsSql(
        scopedJobDefinitionBundleScope.bundleIds,
        jobDefinitionIds,
        coderTrainingIds,
        excludeTrainings
      );

      if (agreementFilter === 'differ') {
        // Conflict: at least two coding decisions are available and code or score differs.
        query.andHaving(`(SELECT COUNT(*) FROM (${dedupedReviewResultsSql}) deduped_review_results WHERE deduped_review_results.code IS NOT NULL) > 1`);
        query.andHaving(`(SELECT COUNT(DISTINCT deduped_review_results.signature) FROM (${dedupedReviewResultsSql}) deduped_review_results) > 1`);
      } else if (agreementFilter === 'match') {
        // Match: no differing non-null coding decisions.
        query.andHaving(`(SELECT COUNT(DISTINCT deduped_review_results.signature) FROM (${dedupedReviewResultsSql}) deduped_review_results) <= 1`);
      } else if (onlyConflicts) {
        // Legacy behavior for older clients that still use onlyConflicts.
        query.andHaving(`(SELECT COUNT(*) FROM (${dedupedReviewResultsSql}) deduped_review_results WHERE deduped_review_results.code IS NOT NULL) > 1`);
        query.andHaving(`(SELECT COUNT(DISTINCT deduped_review_results.signature) FROM (${dedupedReviewResultsSql}) deduped_review_results) > 1`);
      }

      // Applied Status Filter Logic
      const completeStatus = statusStringToNumber('CODING_COMPLETE');
      if (resolvedFilter === 'resolved') {
        query.andWhere('resp.status_v2 = :completeStatus', { completeStatus });
      } else if (resolvedFilter === 'unresolved') {
        query.andWhere('(resp.status_v2 IS NULL OR resp.status_v2 != :completeStatus)', { completeStatus });
      } else if (onlyConflicts && !agreementFilter && !resolvedFilter) {
        // Legacy behavior: older onlyConflicts clients hide resolved items by default.
        query.andWhere('(resp.status_v2 IS NULL OR resp.status_v2 != :completeStatus)', { completeStatus });
      }

      if (excludeTrainings) {
        query.andWhere('cj.training_id IS NULL');
      }

      if (this.hasScopeFilters(jobDefinitionIds, coderTrainingIds)) {
        const scopeClauses: string[] = [];
        const scopeParams: Record<string, number[]> = {};

        if (jobDefinitionIds?.length) {
          scopeClauses.push(this.getJobDefinitionScopeClause(
            'cj',
            'cju',
            'jobDefinitionIds',
            'jobDefinitionBundleIds',
            scopedJobDefinitionBundleScope.bundleIds
          ));
          scopeParams.jobDefinitionIds = jobDefinitionIds;
          if (scopedJobDefinitionBundleScope.bundleIds.length > 0) {
            scopeParams.jobDefinitionBundleIds = scopedJobDefinitionBundleScope.bundleIds;
          }
        }

        if (coderTrainingIds?.length) {
          scopeClauses.push('cj.training_id IN (:...coderTrainingIds)');
          scopeParams.coderTrainingIds = coderTrainingIds;
        }

        query.andWhere(`(${scopeClauses.join(' OR ')})`, scopeParams);
      }

      if (search && search.trim() !== '') {
        const searchPattern = `%${search.trim().toLowerCase()}%`;
        query.andWhere(
          '(LOWER(u.name) LIKE :searchPattern OR LOWER(resp.variableid) LIKE :searchPattern OR LOWER(p.login) LIKE :searchPattern OR LOWER(p.code) LIKE :searchPattern OR LOWER(p.group) LIKE :searchPattern)',
          { searchPattern }
        );
      }

      if (coderId) {
        // Filter by responses where the specific coder is involved
        query.andWhere(subQuery => {
          const sub = subQuery
            .subQuery()
            .select('cju2.response_id')
            .from(CodingJobUnit, 'cju2')
            .innerJoin('cju2.coding_job', 'cj2')
            .innerJoin(CodingJobCoder, 'cjc2', 'cjc2.coding_job_id = cj2.id')
            .where('cj2.workspace_id = :workspaceId', { workspaceId })
            .andWhere('cjc2.user_id = :coderId', { coderId })
            .andWhere(`(
              SELECT COUNT(DISTINCT cjc2_distinct.user_id)
              FROM coding_job_coder cjc2_distinct
              WHERE cjc2_distinct.coding_job_id = cj2.id
            ) = 1`);

          if (excludeTrainings) {
            sub.andWhere('cj2.training_id IS NULL');
          }

          if (this.hasScopeFilters(jobDefinitionIds, coderTrainingIds)) {
            const scopeClauses: string[] = [];
            const scopeParams: Record<string, number[]> = {};

            if (jobDefinitionIds?.length) {
              scopeClauses.push(this.getJobDefinitionScopeClause(
                'cj2',
                'cju2',
                'coderFilterJobDefinitionIds',
                'coderFilterJobDefinitionBundleIds',
                scopedJobDefinitionBundleScope.bundleIds
              ));
              scopeParams.coderFilterJobDefinitionIds = jobDefinitionIds;
              if (scopedJobDefinitionBundleScope.bundleIds.length > 0) {
                scopeParams.coderFilterJobDefinitionBundleIds = scopedJobDefinitionBundleScope.bundleIds;
              }
            }

            if (coderTrainingIds?.length) {
              scopeClauses.push('cj2.training_id IN (:...coderFilterTrainingIds)');
              scopeParams.coderFilterTrainingIds = coderTrainingIds;
            }

            sub.andWhere(`(${scopeClauses.join(' OR ')})`, scopeParams);
          }

          return `cju.response_id IN ${sub.getQuery()}`;
        });
      }

      if (statusFilter === 'done') {
        query.andHaving(`(SELECT COUNT(*) FROM (${dedupedReviewResultsSql}) deduped_review_results WHERE deduped_review_results.code IS NOT NULL) = (SELECT COUNT(*) FROM (${dedupedReviewResultsSql}) deduped_review_results)`);
      } else if (statusFilter === 'pending') {
        query.andHaving(`(SELECT COUNT(*) FROM (${dedupedReviewResultsSql}) deduped_review_results WHERE deduped_review_results.code IS NOT NULL) < (SELECT COUNT(*) FROM (${dedupedReviewResultsSql}) deduped_review_results)`);
      }

      const [sql, params] = query.getQueryAndParameters();
      const countResult = await this.codingJobUnitRepository.query(
        `SELECT COUNT(*) as "total" FROM (${sql}) "subquery"`,
        params
      );

      const total = parseInt(countResult[0]?.total || '0', 10);

      if (total === 0) {
        return {
          data: [],
          total: 0,
          page,
          limit
        };
      }

      query.orderBy('cju.response_id', 'ASC');
      query.offset((page - 1) * limit).limit(limit);
      const paginatedRawResults = await query.getRawMany();
      const paginatedResponseIds = paginatedRawResults.map(row => row.responseId);

      // Store raw status info to map it back after relation fetch
      const statusMap = new Map<number, number>();
      paginatedRawResults.forEach(row => {
        statusMap.set(row.responseId, row.responseStatus);
      });

      const relations = includeRelations ? [
        'coding_job',
        'coding_job.training',
        'coding_job.codingJobVariableBundles',
        'coding_job.codingJobCoders',
        'coding_job.codingJobCoders.user',
        'response',
        'response.unit',
        'response.unit.booklet',
        'response.unit.booklet.person'
      ] : [
        'coding_job',
        'coding_job.training',
        'coding_job.codingJobVariableBundles',
        'coding_job.codingJobCoders',
        'coding_job.codingJobCoders.user'
      ];

      const codingJobUnits = await this.codingJobUnitRepository.find({
        where: { response_id: In(paginatedResponseIds) },
        relations
      });

      const isIncludedReviewUnit = (unit: CodingJobUnit) => {
        // Ignore orphaned coding_job_unit rows from deleted jobs.
        if (!unit.coding_job) {
          return false;
        }

        // Keep result assembly aligned with the workspace-scoped base query.
        if (unit.coding_job.workspace_id !== workspaceId) {
          return false;
        }

        if (this.getDistinctCodingJobCoders(unit.coding_job.codingJobCoders || []).length !== 1) {
          return false;
        }

        if (excludeTrainings && unit.coding_job.training_id) {
          return false;
        }

        const codingJobBundleIds = new Set(
          (unit.coding_job.codingJobVariableBundles || [])
            .map(bundle => Number(bundle.variable_bundle_id))
            .filter(bundleId => Number.isFinite(bundleId))
        );
        if (unit.variable_bundle_id !== null && unit.variable_bundle_id !== undefined) {
          codingJobBundleIds.add(unit.variable_bundle_id);
        }
        if (!this.isIncludedByScope(
          unit.coding_job.job_definition_id,
          unit.coding_job.training_id,
          jobDefinitionIds,
          coderTrainingIds,
          Array.from(codingJobBundleIds),
          scopedJobDefinitionBundleScope,
          unit.unit_name,
          unit.variable_id
        )) {
          return false;
        }

        if (isExcludedByResolvedExclusions(exclusions, unit.booklet_name, unit.unit_name)) {
          return false;
        }

        return true;
      };
      const scopedCodingJobUnits = codingJobUnits.filter(isIncludedReviewUnit);
      const finalCodingJobUnits = scopedCodingJobUnits.filter(unit => (
        !isCodingIssueReviewJobType(unit.coding_job?.job_type)
      ));
      const codingIssueReviewUnits = scopedCodingJobUnits.filter(unit => (
        isCodingIssueReviewJobType(unit.coding_job?.job_type)
      ));

      const responseGroups = new Map<
      number,
      {
        responseId: number;
        unitName: string;
        variableId: string;
        personLogin: string;
        personCode: string;
        personGroup: string;
        bookletName: string;
        givenAnswer: string;
        isResolved: boolean;
        appliedCode: number | null;
        appliedScore: number | null;
        appliedComment: string | null;
        coderResults: Array<{
          coderId: number;
          coderName: string;
          jobId: number;
          jobName: string;
          jobDefinitionId: number | null;
          trainingId: number | null;
          trainingLabel: string | null;
          code: number | null;
          codingIssueOption: number | null;
          score: number | null;
          notes: string | null;
          supervisorComment: string | null;
          codedAt: Date;
        }>;
      }
      >();
      const coderResultIndexByResponseId = new Map<number, Map<number, number>>();
      const manualMissingCache = new Map<string, ResolvedMissingValue>();

      for (const unit of finalCodingJobUnits) {
        const responseId = unit.response_id;

        if (!responseGroups.has(responseId)) {
          const responseStatus = statusMap.get(responseId);
          const isResolved = responseStatus === completeStatus;
          const appliedResult = this.getAppliedReviewResult(
            isResolved,
            unit.response
          );
          responseGroups.set(responseId, {
            responseId: responseId,
            unitName: unit.unit_name || unit.response?.unit?.name || '',
            variableId: unit.variable_id,
            personLogin: unit.person_login || unit.response?.unit?.booklet?.person?.login || '',
            personCode: unit.person_code || unit.response?.unit?.booklet?.person?.code || '',
            personGroup: unit.person_group || unit.response?.unit?.booklet?.person?.group || '',
            bookletName: unit.booklet_name || unit.response?.unit?.booklet?.bookletinfo?.name || '',
            givenAnswer: unit.response?.value || '',
            isResolved,
            ...appliedResult,
            coderResults: []
          });
        }

        const group = responseGroups.get(responseId)!;
        if (group.isResolved && unit.supervisor_comment && !group.appliedComment) {
          group.appliedComment = unit.supervisor_comment;
        }

        const coder = this.getDistinctCodingJobCoders(unit.coding_job?.codingJobCoders || [])[0];
        if (coder) {
          const resolvedCodeAndScore = await this.resolveManualMissingForReview(
            workspaceId,
            unit,
            manualMissingCache
          );
          if (group.isResolved && this.isAppliedRawResult(group, unit)) {
            group.appliedCode = resolvedCodeAndScore.code;
            group.appliedScore = resolvedCodeAndScore.score;
          }
          const coderResult = {
            coderId: coder.user_id,
            coderName: coder.user?.username || `Coder ${coder.user_id}`,
            jobId: unit.coding_job_id,
            jobName: unit.coding_job?.name || '',
            jobDefinitionId: unit.coding_job?.job_definition_id ?? null,
            trainingId: unit.coding_job?.training_id ?? null,
            trainingLabel: unit.coding_job?.training?.label ?? null,
            code: resolvedCodeAndScore.code,
            codingIssueOption: unit.coding_issue_option ?? null,
            score: resolvedCodeAndScore.score,
            notes: unit.notes,
            supervisorComment: unit.supervisor_comment || null,
            codedAt: unit.created_at
          };

          const coderResultIndexByCoderId = this.getCoderResultIndexByCoderId(
            coderResultIndexByResponseId,
            responseId
          );
          const existingResultIndex = coderResultIndexByCoderId.get(coder.user_id);
          if (existingResultIndex === undefined) {
            coderResultIndexByCoderId.set(coder.user_id, group.coderResults.length);
            group.coderResults.push(coderResult);
          } else if (this.shouldReplaceCoderResult(group.coderResults[existingResultIndex], coderResult)) {
            group.coderResults[existingResultIndex] = coderResult;
          }
        }
      }

      for (const unit of codingIssueReviewUnits) {
        const group = responseGroups.get(unit.response_id);
        if (!group?.isResolved || group.appliedComment || !unit.notes?.trim()) {
          continue;
        }

        const resolvedCodeAndScore = await this.resolveManualMissingForReview(
          workspaceId,
          unit,
          manualMissingCache
        );
        if (this.isAppliedResolvedResult(group, resolvedCodeAndScore)) {
          group.appliedComment = unit.notes.trim();
        }
      }

      const data = Array.from(responseGroups.values())
        .filter(group => group.coderResults.length > 1);

      this.logger.log(
        `Found ${total} double-coded variables for review in workspace ${workspaceId}, returning page ${page} with ${data.length} items`
      );

      return {
        data,
        total,
        page,
        limit
      };
    } catch (error) {
      this.logger.error(
        `Error getting double-coded variables for review: ${error.message}`,
        error.stack
      );
      throw new Error(
        'Could not get double-coded variables for review. Please check the database connection.'
      );
    }
  }

  async getCodedVariablesForKappa(
    workspaceId: number,
    excludeTrainings: boolean = true,
    jobDefinitionIds: number[] = [],
    coderTrainingIds: number[] = [],
    coderIds: number[] = [],
    calculationLevel: KappaCalculationLevel = 'code'
  ): Promise<Array<{
      responseId: number;
      unitName: string;
      variableId: string;
      variableAnchor: string;
      personLogin: string;
      personCode: string;
      personGroup: string;
      bookletName: string;
      coderResults: Array<{
        coderId: number;
        coderName: string;
        jobId: number;
        jobName: string;
        jobDefinitionId: number | null;
        trainingId: number | null;
        trainingLabel: string | null;
        code: number | null;
        score: number | null;
        notes: string | null;
        codedAt: Date;
      }>;
    }>> {
    const scopedJobDefinitionBundleScope = await this.getJobDefinitionBundleScope(workspaceId, jobDefinitionIds);
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const batchSize = 5000;
    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .innerJoin(
        subQuery => subQuery
          .select('single_cjc.coding_job_id', 'coding_job_id')
          .addSelect('MIN(single_cjc.user_id)', 'user_id')
          .from(CodingJobCoder, 'single_cjc')
          .groupBy('single_cjc.coding_job_id')
          .having('COUNT(DISTINCT single_cjc.user_id) = 1'),
        'single_coder_job',
        'single_coder_job.coding_job_id = cj.id'
      )
      .innerJoin('cj.codingJobCoders', 'cjc')
      .leftJoin('cjc.user', 'coder_user')
      .leftJoin('cj.training', 'training')
      .select('cju.response_id', 'responseId')
      .addSelect('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .addSelect('cju.variable_anchor', 'variableAnchor')
      .addSelect('cju.person_login', 'personLogin')
      .addSelect('cju.person_code', 'personCode')
      .addSelect('cju.person_group', 'personGroup')
      .addSelect('cju.booklet_name', 'bookletName')
      .addSelect('cjc.user_id', 'coderId')
      .addSelect('coder_user.username', 'coderName')
      .addSelect('cju.coding_job_id', 'jobId')
      .addSelect('cj.name', 'jobName')
      .addSelect('cj.job_definition_id', 'jobDefinitionId')
      .addSelect('cj.training_id', 'trainingId')
      .addSelect('training.label', 'trainingLabel')
      .addSelect('cju.code', 'code')
      .addSelect('cju.score', 'score')
      .addSelect('cju.notes', 'notes')
      .addSelect('cju.supervisor_comment', 'supervisorComment')
      .addSelect('COALESCE(cju.updated_at, cju.created_at)', 'codedAt')
      .where('cj.workspace_id = :workspaceId', { workspaceId })
      .andWhere(
        calculationLevel === 'score' ?
          'cju.score IS NOT NULL' :
          'cju.code IS NOT NULL'
      )
      .orderBy('cju.unit_name', 'ASC')
      .addOrderBy('cju.variable_id', 'ASC')
      .addOrderBy('cju.person_login', 'ASC')
      .addOrderBy('cju.response_id', 'ASC')
      .addOrderBy('cjc.user_id', 'ASC')
      .addOrderBy('cju.id', 'ASC')
      .addOrderBy('cjc.id', 'ASC');
    applyNonCodingIssueReviewJobFilter(
      query,
      'cj',
      'kappaCodedVariablesReviewJobType'
    );

    if (excludeTrainings) {
      query.andWhere('cj.training_id IS NULL');
    }

    if (this.hasScopeFilters(jobDefinitionIds, coderTrainingIds)) {
      const scopeClauses: string[] = [];

      if (jobDefinitionIds.length) {
        scopeClauses.push(this.getJobDefinitionScopeClause(
          'cj',
          'cju',
          'kappaJobDefinitionIds',
          'kappaJobDefinitionBundleIds',
          scopedJobDefinitionBundleScope.bundleIds
        ));
        query.setParameter('kappaJobDefinitionIds', jobDefinitionIds);
        if (scopedJobDefinitionBundleScope.bundleIds.length) {
          query.setParameter('kappaJobDefinitionBundleIds', scopedJobDefinitionBundleScope.bundleIds);
        }
      }

      if (coderTrainingIds.length) {
        scopeClauses.push('cj.training_id IN (:...kappaCoderTrainingIds)');
        query.setParameter('kappaCoderTrainingIds', coderTrainingIds);
      }

      query.andWhere(`(${scopeClauses.join(' OR ')})`);
    }

    if (coderIds.length) {
      query.andWhere('cjc.user_id IN (:...kappaCoderIds)', { kappaCoderIds: coderIds });
    }

    applyResolvedExclusionsToQuery(query, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix: 'kappaCodedVariables'
    });

    const groups = new Map<string, {
      responseId: number;
      unitName: string;
      variableId: string;
      variableAnchor: string;
      personLogin: string;
      personCode: string;
      personGroup: string;
      bookletName: string;
      coderResults: ReviewCoderResult[];
    }>();
    const coderResultIndexByItemKey = new Map<string, Map<number, number>>();
    let offset = 0;
    let hasMoreRows = true;

    while (hasMoreRows) {
      const rows = await query
        .offset(offset)
        .limit(batchSize)
        .getRawMany<KappaCodedVariableRow>();

      rows.forEach(row => {
        const responseId = Number(row.responseId);
        const coderId = Number(row.coderId);
        const itemKey = JSON.stringify([responseId, row.unitName, row.variableId]);
        if (!groups.has(itemKey)) {
          groups.set(itemKey, {
            responseId,
            unitName: row.unitName,
            variableId: row.variableId,
            variableAnchor: row.variableAnchor || row.variableId,
            personLogin: row.personLogin,
            personCode: row.personCode,
            personGroup: row.personGroup,
            bookletName: row.bookletName || '',
            coderResults: []
          });
        }

        const group = groups.get(itemKey)!;
        const coderResult: ReviewCoderResult = {
          coderId,
          coderName: row.coderName || `Coder ${coderId}`,
          jobId: Number(row.jobId),
          jobName: row.jobName || '',
          jobDefinitionId: row.jobDefinitionId === null ? null : Number(row.jobDefinitionId),
          trainingId: row.trainingId === null ? null : Number(row.trainingId),
          trainingLabel: row.trainingLabel,
          code: row.code === null ? null : Number(row.code),
          score: row.score === null ? null : Number(row.score),
          notes: row.notes,
          supervisorComment: row.supervisorComment || null,
          codedAt: new Date(row.codedAt)
        };

        const coderResultIndexByCoderId = this.getCoderResultIndexByCoderId(
          coderResultIndexByItemKey,
          itemKey
        );
        const existingResultIndex = coderResultIndexByCoderId.get(coderId);
        if (existingResultIndex === undefined) {
          coderResultIndexByCoderId.set(coderId, group.coderResults.length);
          group.coderResults.push(coderResult);
        } else if (this.shouldReplaceCoderResult(
          group.coderResults[existingResultIndex],
          coderResult,
          calculationLevel
        )) {
          group.coderResults[existingResultIndex] = coderResult;
        }
      });

      offset += batchSize;
      hasMoreRows = rows.length === batchSize;
    }

    return Array.from(groups.values()).map(group => ({
      ...group,
      coderResults: group.coderResults.map(result => ({
        coderId: result.coderId,
        coderName: result.coderName,
        jobId: result.jobId,
        jobName: result.jobName,
        jobDefinitionId: result.jobDefinitionId,
        trainingId: result.trainingId,
        trainingLabel: result.trainingLabel,
        code: result.code,
        score: result.score,
        notes: result.notes,
        codedAt: result.codedAt
      }))
    }));
  }

  private hasScopeFilters(jobDefinitionIds?: number[], coderTrainingIds?: number[]): boolean {
    return !!(jobDefinitionIds?.length || coderTrainingIds?.length);
  }

  private getBundleVariableKey(unitName: string, variableId: string): string {
    return `${unitName}::${variableId}`;
  }

  private getCodingResultSignatureSql(codingJobUnitAlias: string): string {
    return `${codingJobUnitAlias}.code::text || ':' || COALESCE(${codingJobUnitAlias}.score::text, 'NULL')`;
  }

  private getReviewResultPreferenceOrderSql(codingJobUnitAlias: string, codingJobAlias: string): string {
    return [
      `(${codingJobUnitAlias}.supervisor_comment IS NOT NULL) DESC`,
      `(${codingJobUnitAlias}.code IS NOT NULL) DESC`,
      `(${codingJobAlias}.training_id IS NULL) DESC`,
      `(${codingJobAlias}.job_definition_id IS NOT NULL) DESC`,
      `${codingJobUnitAlias}.created_at DESC`
    ].join(', ');
  }

  private getDedupedReviewResultsSql(
    scopedJobDefinitionBundleIds: number[],
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    excludeTrainings = false
  ): string {
    const whereClauses = [
      'cju_dedup.response_id = cju.response_id',
      'cj_dedup.workspace_id = :workspaceId'
    ];

    if (excludeTrainings) {
      whereClauses.push('cj_dedup.training_id IS NULL');
    }

    if (this.hasScopeFilters(jobDefinitionIds, coderTrainingIds)) {
      const scopeClauses: string[] = [];

      if (jobDefinitionIds?.length) {
        scopeClauses.push(this.getJobDefinitionScopeClause(
          'cj_dedup',
          'cju_dedup',
          'jobDefinitionIds',
          'jobDefinitionBundleIds',
          scopedJobDefinitionBundleIds
        ));
      }

      if (coderTrainingIds?.length) {
        scopeClauses.push('cj_dedup.training_id IN (:...coderTrainingIds)');
      }

      whereClauses.push(`(${scopeClauses.join(' OR ')})`);
    }

    const preferenceOrderSql = this.getReviewResultPreferenceOrderSql('cju_dedup', 'cj_dedup');

    return `SELECT selected_review_results.user_id, selected_review_results.code, selected_review_results.signature
      FROM (
        SELECT dedup_coder.user_id,
          (ARRAY_AGG(cju_dedup.code ORDER BY ${preferenceOrderSql}))[1] AS code,
          (ARRAY_AGG(${this.getCodingResultSignatureSql('cju_dedup')} ORDER BY ${preferenceOrderSql}))[1] AS signature
        FROM coding_job_unit cju_dedup
        INNER JOIN coding_job cj_dedup
          ON cj_dedup.id = cju_dedup.coding_job_id
        INNER JOIN (
          SELECT single_cjc.coding_job_id, MIN(single_cjc.user_id) AS user_id
          FROM coding_job_coder single_cjc
          GROUP BY single_cjc.coding_job_id
          HAVING COUNT(DISTINCT single_cjc.user_id) = 1
        ) dedup_coder
          ON dedup_coder.coding_job_id = cj_dedup.id
        WHERE ${whereClauses.join(' AND ')}
        GROUP BY dedup_coder.user_id
      ) selected_review_results`;
  }

  private async getJobDefinitionBundleScope(workspaceId: number, jobDefinitionIds?: number[]): Promise<JobDefinitionBundleScope> {
    if (!jobDefinitionIds?.length) {
      return {
        bundleIds: [],
        variableKeysByBundleId: new Map()
      };
    }

    const definitions = await this.jobDefinitionRepository.find({
      where: {
        id: In(jobDefinitionIds),
        workspace_id: workspaceId
      },
      select: ['assigned_variable_bundles']
    });

    const bundleIds = new Set<number>();

    definitions.forEach(definition => {
      (definition.assigned_variable_bundles || []).forEach(bundle => {
        if (!Number.isInteger(bundle.id) || bundle.id <= 0) {
          return;
        }

        bundleIds.add(bundle.id);
      });
    });

    const variableKeysByBundleId = new Map<number, Set<string>>();
    if (bundleIds.size > 0) {
      const bundles = await this.variableBundleRepository.find({
        where: {
          id: In(Array.from(bundleIds)),
          workspace_id: workspaceId
        },
        select: ['id', 'variables']
      });

      bundles.forEach(bundle => {
        variableKeysByBundleId.set(
          bundle.id,
          new Set((bundle.variables || []).map(variable => this.getBundleVariableKey(
            variable.unitName,
            variable.variableId
          )))
        );
      });
    }

    return {
      bundleIds: Array.from(bundleIds),
      variableKeysByBundleId
    };
  }

  private getJobDefinitionScopeClause(
    codingJobAlias: string,
    codingJobUnitAlias: string,
    jobDefinitionParamName: string,
    bundleParamName: string,
    scopedJobDefinitionBundleIds: number[]
  ): string {
    const directClause = `${codingJobAlias}.job_definition_id IN (:...${jobDefinitionParamName})`;

    if (scopedJobDefinitionBundleIds.length === 0) {
      return directClause;
    }

    return `(${directClause} OR (${codingJobAlias}.job_definition_id IS NULL AND EXISTS (
      SELECT 1
      FROM coding_job_variable_bundle scope_cjvb
      INNER JOIN job_definitions scope_jd
        ON scope_jd.id IN (:...${jobDefinitionParamName})
        AND scope_jd.workspace_id = ${codingJobAlias}.workspace_id
      INNER JOIN variable_bundle scope_vb
        ON scope_vb.id = scope_cjvb.variable_bundle_id
        AND scope_vb.workspace_id = ${codingJobAlias}.workspace_id
      WHERE scope_cjvb.coding_job_id = ${codingJobAlias}.id
      AND scope_cjvb.variable_bundle_id IN (:...${bundleParamName})
      AND COALESCE(scope_vb.variables, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object(
        'unitName', ${codingJobUnitAlias}.unit_name,
        'variableId', ${codingJobUnitAlias}.variable_id
      ))
    )))`;
  }

  private isBundleVariableIncluded(
    scope: JobDefinitionBundleScope,
    bundleId: number,
    unitName: string,
    variableId: string
  ): boolean {
    return scope.variableKeysByBundleId.get(bundleId)?.has(
      this.getBundleVariableKey(unitName, variableId)
    ) ?? false;
  }

  private isIncludedByScope(
    jobDefinitionId: number | undefined,
    trainingId: number | undefined,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    codingJobBundleIds: number[] = [],
    scopedJobDefinitionBundleScope: JobDefinitionBundleScope = {
      bundleIds: [],
      variableKeysByBundleId: new Map()
    },
    unitName: string = '',
    variableId: string = ''
  ): boolean {
    if (!this.hasScopeFilters(jobDefinitionIds, coderTrainingIds)) {
      return true;
    }

    const matchesJobDefinition = !!(jobDefinitionIds?.length && jobDefinitionId && jobDefinitionIds.includes(jobDefinitionId));
    const matchesTraining = !!(coderTrainingIds?.length && trainingId && coderTrainingIds.includes(trainingId));
    const matchesLegacyBundleJobDefinition = !!(
      jobDefinitionIds?.length &&
      !jobDefinitionId &&
      scopedJobDefinitionBundleScope.bundleIds.length > 0 &&
      codingJobBundleIds.some(bundleId => this.isBundleVariableIncluded(
        scopedJobDefinitionBundleScope,
        bundleId,
        unitName,
        variableId
      ))
    );

    return matchesJobDefinition || matchesTraining || matchesLegacyBundleJobDefinition;
  }

  private getCoderResultIndexByCoderId<TKey extends number | string>(
    coderResultIndexByResponseId: Map<TKey, Map<number, number>>,
    responseId: TKey
  ): Map<number, number> {
    const existing = coderResultIndexByResponseId.get(responseId);
    if (existing) {
      return existing;
    }

    const created = new Map<number, number>();
    coderResultIndexByResponseId.set(responseId, created);
    return created;
  }

  private getDistinctCodingJobCoders(coders: CodingJobCoder[]): CodingJobCoder[] {
    const coderById = new Map<number, CodingJobCoder>();
    coders.forEach(coder => {
      if (!coderById.has(coder.user_id)) {
        coderById.set(coder.user_id, coder);
      }
    });

    return Array.from(coderById.values());
  }

  private hasReviewResultValueForLevel(
    result: ReviewCoderResult,
    calculationLevel: KappaCalculationLevel
  ): boolean {
    return calculationLevel === 'score' ?
      result.score !== null && result.score !== undefined :
      result.code !== null && result.code !== undefined;
  }

  private shouldReplaceCoderResult(
    existing: ReviewCoderResult,
    candidate: ReviewCoderResult,
    calculationLevel: KappaCalculationLevel = 'code'
  ): boolean {
    const existingHasSupervisorComment = !!existing.supervisorComment;
    const candidateHasSupervisorComment = !!candidate.supervisorComment;
    if (candidateHasSupervisorComment !== existingHasSupervisorComment) {
      return candidateHasSupervisorComment;
    }

    const existingHasLevelValue = this.hasReviewResultValueForLevel(existing, calculationLevel);
    const candidateHasLevelValue = this.hasReviewResultValueForLevel(candidate, calculationLevel);
    if (candidateHasLevelValue !== existingHasLevelValue) {
      return candidateHasLevelValue;
    }

    const existingIsTraining = existing.trainingId !== null && existing.trainingId !== undefined;
    const candidateIsTraining = candidate.trainingId !== null && candidate.trainingId !== undefined;
    if (candidateIsTraining !== existingIsTraining) {
      return !candidateIsTraining;
    }

    const existingHasJobDefinition = existing.jobDefinitionId !== null && existing.jobDefinitionId !== undefined;
    const candidateHasJobDefinition = candidate.jobDefinitionId !== null && candidate.jobDefinitionId !== undefined;
    if (candidateHasJobDefinition !== existingHasJobDefinition) {
      return candidateHasJobDefinition;
    }

    return candidate.codedAt.getTime() > existing.codedAt.getTime();
  }

  private getAppliedReviewResult(
    isResolved: boolean,
    response?: Pick<ResponseEntity, 'code_v2' | 'score_v2'> | null
  ): AppliedReviewResult {
    if (!isResolved) {
      return {
        appliedCode: null,
        appliedScore: null,
        appliedComment: null
      };
    }

    return {
      appliedCode: this.toNullableNumber(response?.code_v2),
      appliedScore: this.toNullableNumber(response?.score_v2),
      appliedComment: null
    };
  }

  private toNullableNumber(value: number | string | null | undefined): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : null;
  }

  private isAppliedRawResult(
    appliedResult: AppliedReviewResult,
    unit: Pick<CodingJobUnit, 'code' | 'score'>
  ): boolean {
    return appliedResult.appliedCode !== null &&
      appliedResult.appliedCode === this.toNullableNumber(unit.code) &&
      appliedResult.appliedScore === this.toNullableNumber(unit.score);
  }

  private isAppliedResolvedResult(
    appliedResult: AppliedReviewResult,
    resolvedResult: { code: number | null; score: number | null }
  ): boolean {
    return appliedResult.appliedCode !== null &&
      appliedResult.appliedCode === resolvedResult.code &&
      appliedResult.appliedScore === resolvedResult.score;
  }

  async applyDoubleCodedResolutions(
    workspaceId: number,
    decisions: DoubleCodedResolutionDecision[]
  ): Promise<{
      success: boolean;
      appliedCount: number;
      failedCount: number;
      skippedCount: number;
      message: string;
    }> {
    try {
      this.logger.log(
        `Applying ${decisions.length} double-coded resolutions in workspace ${workspaceId}`
      );

      let appliedCount = 0;
      let failedCount = 0;
      let skippedCount = 0;

      await this.responseRepository.manager.transaction(async transactionalEntityManager => {
        for (const decision of decisions) {
          try {
            const resolvedDecision = await this.resolveDoubleCodedResolution(
              transactionalEntityManager,
              workspaceId,
              decision
            );

            if (!resolvedDecision) {
              skippedCount += 1;
              continue;
            }

            const response = resolvedDecision.response;
            if (!response) {
              this.logger.warn(
                `Could not find response for responseId ${decision.responseId}`
              );
              skippedCount += 1;
              continue;
            }

            const updatedValue = this.getOriginalResponseValue(response.value);

            await this.clearWorkspaceSupervisorComments(
              transactionalEntityManager,
              workspaceId,
              decision.responseId
            );

            if (decision.resolutionComment && decision.resolutionComment.trim()) {
              resolvedDecision.sourceUnit.supervisor_comment = decision.resolutionComment.trim();
              await transactionalEntityManager.save(CodingJobUnit, resolvedDecision.sourceUnit);
            }

            response.status_v2 = statusStringToNumber('CODING_COMPLETE');
            response.code_v2 = resolvedDecision.code;
            response.score_v2 = resolvedDecision.score;
            response.value = updatedValue;

            await transactionalEntityManager.save(ResponseEntity, response);
            appliedCount += 1;

            this.logger.debug(
              `Applied resolution for responseId ${decision.responseId}: code=${resolvedDecision.code}, score=${resolvedDecision.score}`
            );
          } catch (error) {
            this.logger.error(
              `Error applying resolution for responseId ${decision.responseId}: ${error.message}`,
              error.stack
            );
            failedCount += 1;
          }
        }
      });

      if (appliedCount > 0 && typeof this.codingStatisticsService.invalidateCache === 'function') {
        await this.codingStatisticsService.invalidateCache(workspaceId);
      }
      if (appliedCount > 0 && typeof this.codingAnalysisService.invalidateCache === 'function') {
        await this.codingAnalysisService.invalidateCache(workspaceId);
      }
      if (
        appliedCount > 0 &&
        typeof this.codingValidationService.invalidateIncompleteVariablesCache === 'function'
      ) {
        await this.codingValidationService.invalidateIncompleteVariablesCache(workspaceId);
      }

      const message = `Applied ${appliedCount} resolutions successfully. ${failedCount > 0 ? `${failedCount} failed.` : ''
      } ${skippedCount > 0 ? `${skippedCount} skipped.` : ''}`;
      this.logger.log(message);

      return {
        success: appliedCount > 0,
        appliedCount,
        failedCount,
        skippedCount,
        message
      };
    } catch (error) {
      this.logger.error(
        `Error applying double-coded resolutions: ${error.message}`,
        error.stack
      );
      throw new Error(
        'Could not apply double-coded resolutions. Please check the database connection.'
      );
    }
  }

  private async resolveDoubleCodedResolution(
    manager: EntityManager,
    workspaceId: number,
    decision: DoubleCodedResolutionDecision
  ): Promise<ResolvedDoubleCodedResolution | null> {
    if (this.hasSelectedCodingJobDecision(decision)) {
      return this.resolveSelectedCodingJobResolution(manager, workspaceId, decision);
    }

    return this.resolveExplicitReplayResolution(manager, workspaceId, decision);
  }

  private hasSelectedCodingJobDecision(decision: DoubleCodedResolutionDecision): boolean {
    return this.normalizeExplicitReplayInteger(decision.selectedJobId) !== undefined;
  }

  private async resolveSelectedCodingJobResolution(
    manager: EntityManager,
    workspaceId: number,
    decision: DoubleCodedResolutionDecision
  ): Promise<ResolvedDoubleCodedResolution | null> {
    const selectedJobId = this.normalizeExplicitReplayInteger(decision.selectedJobId);
    if (selectedJobId === undefined) {
      this.logger.warn(`Invalid selected job ID for responseId ${decision.responseId}`);
      return null;
    }

    const selectedCodingJobUnit = await manager.findOne(CodingJobUnit, {
      where: {
        response_id: decision.responseId,
        coding_job_id: selectedJobId
      },
      relations: ['response', 'coding_job']
    });

    if (!selectedCodingJobUnit) {
      this.logger.warn(
        `Could not find coding_job_unit for responseId ${decision.responseId} and jobId ${selectedJobId}`
      );
      return null;
    }

    if (!await this.isResolutionSourceAllowed(workspaceId, selectedCodingJobUnit)) {
      this.logger.warn(`Skipped unavailable responseId ${decision.responseId} for jobId ${selectedJobId}`);
      return null;
    }

    return {
      response: selectedCodingJobUnit.response,
      sourceUnit: selectedCodingJobUnit,
      code: selectedCodingJobUnit.code,
      score: selectedCodingJobUnit.score
    };
  }

  private async resolveExplicitReplayResolution(
    manager: EntityManager,
    workspaceId: number,
    decision: DoubleCodedResolutionDecision
  ): Promise<ResolvedDoubleCodedResolution | null> {
    if (decision.code === null || decision.code === undefined) {
      this.logger.warn(`Missing replay code for responseId ${decision.responseId}`);
      return null;
    }

    const code = this.normalizeExplicitReplayInteger(decision.code);
    if (code === undefined) {
      this.logger.warn(`Invalid replay code for responseId ${decision.responseId}`);
      return null;
    }

    if (!this.isExplicitReplayScorePayloadValid(decision.score)) {
      this.logger.warn(`Invalid replay score for responseId ${decision.responseId}`);
      return null;
    }

    const sourceUnit = await manager.findOne(CodingJobUnit, {
      where: {
        response_id: decision.responseId,
        coding_job: { workspace_id: workspaceId }
      },
      relations: ['response', 'coding_job'],
      order: {
        id: 'ASC'
      }
    });

    if (!sourceUnit) {
      this.logger.warn(`Could not find workspace coding_job_unit for replay responseId ${decision.responseId}`);
      return null;
    }

    if (!await this.isResolutionSourceAllowed(workspaceId, sourceUnit)) {
      this.logger.warn(`Skipped unavailable replay responseId ${decision.responseId}`);
      return null;
    }

    const score = await this.resolveExplicitReplayScore(workspaceId, sourceUnit, code);
    if (score === undefined) {
      this.logger.warn(`Unsupported replay code for responseId ${decision.responseId}: ${code}`);
      return null;
    }

    return {
      response: sourceUnit.response,
      sourceUnit,
      code,
      score
    };
  }

  private async resolveExplicitReplayScore(
    workspaceId: number,
    sourceUnit: CodingJobUnit,
    code: number
  ): Promise<number | null | undefined> {
    if (code < 0) {
      return this.allowedCodingIssueCodes.has(code) ? null : undefined;
    }

    try {
      return await this.codingJobService.getCodingSchemeScoreForUnitCode(
        sourceUnit,
        workspaceId,
        code
      );
    } catch (error) {
      this.logger.warn(
        `Could not validate replay code ${code} for responseId ${sourceUnit.response_id}: ${error.message}`
      );
      return undefined;
    }
  }

  private isExplicitReplayScorePayloadValid(score: unknown): boolean {
    if (score === null || score === undefined) {
      return true;
    }

    return this.normalizeExplicitReplayNumber(score) !== undefined;
  }

  private normalizeExplicitReplayInteger(value: unknown): number | undefined {
    const normalizedValue = this.normalizeExplicitReplayNumber(value);
    if (normalizedValue === undefined) {
      return undefined;
    }

    return Number.isInteger(normalizedValue) ? normalizedValue : undefined;
  }

  private normalizeExplicitReplayNumber(value: unknown): number | undefined {
    if (typeof value !== 'number' && typeof value !== 'string') {
      return undefined;
    }

    if (typeof value === 'string' && value.trim() === '') {
      return undefined;
    }

    const normalizedValue = Number(value);
    return Number.isFinite(normalizedValue) ? normalizedValue : undefined;
  }

  private async isResolutionSourceAllowed(
    workspaceId: number,
    sourceUnit: CodingJobUnit
  ): Promise<boolean> {
    if (sourceUnit.coding_job?.workspace_id !== workspaceId) {
      this.logger.warn(`Workspace mismatch for responseId ${sourceUnit.response_id}`);
      return false;
    }

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    return !isExcludedByResolvedExclusions(
      exclusions,
      sourceUnit.booklet_name,
      sourceUnit.unit_name
    );
  }

  private getOriginalResponseValue(value: string | null | undefined): string {
    let updatedValue = value || '';
    const boundary = '\n\n--- ORIGINAL RESPONSE ---\n';

    if (updatedValue.includes(boundary)) {
      const parts = updatedValue.split(boundary);
      updatedValue = parts[parts.length - 1];
    }

    return updatedValue;
  }

  private async clearWorkspaceSupervisorComments(
    manager: EntityManager,
    workspaceId: number,
    responseId: number
  ): Promise<void> {
    const rows = await manager
      .getRepository(CodingJobUnit)
      .createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .select('cju.id', 'id')
      .where('cju.response_id = :responseId', { responseId })
      .andWhere('cj.workspace_id = :workspaceId', { workspaceId })
      .getRawMany<{ id: number | string }>();

    const ids = rows
      .map(row => Number(row.id))
      .filter(id => Number.isFinite(id));

    if (ids.length === 0) {
      return;
    }

    await manager.update(
      CodingJobUnit,
      { id: In(ids) },
      { supervisor_comment: null }
    );
  }

  async getWorkspaceCohensKappaSummary(
    workspaceId: number,
    weightedMean: boolean = true,
    excludeTrainings: boolean = true,
    jobDefinitionIds: number[] = [],
    coderTrainingIds: number[] = [],
    coderIds: number[] = []
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
    try {
      this.logger.log(
        `Calculating workspace-wide Cohen's Kappa for double-coded incomplete variables in workspace ${workspaceId}${excludeTrainings ? ' (excluding trainings)' : ''}`
      );

      if (coderIds.length === 1) {
        return {
          coderPairs: [],
          workspaceSummary: {
            totalDoubleCodedResponses: 0,
            totalCoderPairs: 0,
            averageKappa: null,
            variablesIncluded: 0,
            codersIncluded: 0,
            weightingMethod: weightedMean ? 'weighted' : 'unweighted'
          }
        };
      }

      let totalReviewItems = 0;
      let totalDoubleCodedResponses = 0;
      let currentPage = 1;
      const batchSize = 1000;
      let hasMore = true;

      const coderPairData = new Map<
      string,
      {
        coder1Id: number;
        coder1Name: string;
        coder2Id: number;
        coder2Name: string;
        codes: Array<{ code1: number | null; code2: number | null }>;
      }
      >();

      const uniqueVariables = new Set<string>();
      const uniqueCoders = new Set<number>();

      while (hasMore) {
        const doubleCodedData = await this.getDoubleCodedVariablesForReview(
          workspaceId,
          currentPage,
          batchSize,
          false, // onlyConflicts = false
          excludeTrainings,
          undefined, // search
          undefined, // coderId
          undefined, // statusFilter
          undefined, // resolvedFilter
          undefined, // agreementFilter
          jobDefinitionIds,
          coderTrainingIds,
          false // includeRelations = false
        );

        if (coderIds.length > 0) {
          doubleCodedData.data.forEach(item => {
            item.coderResults = item.coderResults.filter(result => coderIds.includes(result.coderId));
          });
        }

        if (currentPage === 1) {
          totalReviewItems = doubleCodedData.total;
        }

        for (const item of doubleCodedData.data) {
          if (item.coderResults.length < 2) continue;

          totalDoubleCodedResponses += 1;
          uniqueVariables.add(`${item.unitName}:${item.variableId}`);

          const coders = item.coderResults;
          for (let i = 0; i < coders.length; i++) {
            for (let j = i + 1; j < coders.length; j++) {
              const coder1 = coders[i];
              const coder2 = coders[j];

              uniqueCoders.add(coder1.coderId);
              uniqueCoders.add(coder2.coderId);

              const pairKey =
                coder1.coderId < coder2.coderId ?
                  `${coder1.coderId}-${coder2.coderId}` :
                  `${coder2.coderId}-${coder1.coderId}`;

              if (!coderPairData.has(pairKey)) {
                coderPairData.set(pairKey, {
                  coder1Id:
                    coder1.coderId < coder2.coderId ?
                      coder1.coderId :
                      coder2.coderId,
                  coder1Name:
                    coder1.coderId < coder2.coderId ?
                      coder1.coderName :
                      coder2.coderName,
                  coder2Id:
                    coder1.coderId < coder2.coderId ?
                      coder2.coderId :
                      coder1.coderId,
                  coder2Name:
                    coder1.coderId < coder2.coderId ?
                      coder2.coderName :
                      coder1.coderName,
                  codes: []
                });
              }

              const pair = coderPairData.get(pairKey)!;
              if (coder1.coderId < coder2.coderId) {
                pair.codes.push({
                  code1: coder1.code,
                  code2: coder2.code
                });
              } else {
                pair.codes.push({
                  code1: coder2.code,
                  code2: coder1.code
                });
              }
            }
          }
        }

        if ((currentPage * batchSize) >= totalReviewItems || doubleCodedData.data.length === 0) {
          hasMore = false;
        } else {
          currentPage += 1;
        }
      }

      const coderPairs = [];

      for (const pair of coderPairData.values()) {
        const kappaResults = this.codingStatisticsService.calculateCohensKappa([
          pair
        ]);

        if (kappaResults.length > 0) {
          const result = kappaResults[0];
          coderPairs.push(result);
        }
      }

      let averageKappa: number | null;

      if (weightedMean) {
        let totalWeightedKappa = 0;
        let totalWeight = 0;

        for (const result of coderPairs) {
          if (result.kappa !== null && !Number.isNaN(result.kappa)) {
            const weight = result.validPairs;
            totalWeightedKappa += result.kappa * weight;
            totalWeight += weight;
          }
        }

        averageKappa = totalWeight > 0 ? totalWeightedKappa / totalWeight : null;
      } else {
        let totalKappa = 0;
        let validKappaCount = 0;

        for (const result of coderPairs) {
          if (result.kappa !== null && !Number.isNaN(result.kappa)) {
            totalKappa += result.kappa;
            validKappaCount += 1;
          }
        }

        averageKappa = validKappaCount > 0 ? totalKappa / validKappaCount : null;
      }

      const workspaceSummary = {
        totalDoubleCodedResponses,
        totalCoderPairs: coderPairs.length,
        averageKappa: averageKappa !== null ? Math.round(averageKappa * 1000) / 1000 : null,
        variablesIncluded: uniqueVariables.size,
        codersIncluded: uniqueCoders.size,
        weightingMethod: (weightedMean ? 'weighted' : 'unweighted') as 'weighted' | 'unweighted'
      };

      this.logger.log(
        `Calculated workspace-wide Cohen's Kappa: ${coderPairs.length} coder pairs, ${uniqueVariables.size} variables, ${uniqueCoders.size} coders, average kappa: ${averageKappa}`
      );

      const publicCoderPairs = coderPairs.map(result => {
        const roundedResult = this.codingStatisticsService
          .roundKappaCalculationResult(result);
        return {
          coder1Id: roundedResult.coder1Id,
          coder1Name: roundedResult.coder1Name,
          coder2Id: roundedResult.coder2Id,
          coder2Name: roundedResult.coder2Name,
          kappa: roundedResult.kappa,
          agreement: roundedResult.agreement,
          totalSharedResponses: roundedResult.totalItems,
          validPairs: roundedResult.validPairs,
          interpretation: roundedResult.interpretation
        };
      });

      return {
        coderPairs: publicCoderPairs,
        workspaceSummary
      };
    } catch (error) {
      this.logger.error(
        `Error calculating workspace-wide Cohen's Kappa: ${error.message}`,
        error.stack
      );
      throw new Error(
        "Could not calculate workspace-wide Cohen's Kappa. Please check the database connection."
      );
    }
  }
}
