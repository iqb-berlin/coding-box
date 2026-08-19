import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CodingJobCoder } from '../../entities/coding-job-coder.entity';
import { JobDefinition } from '../../entities/job-definition.entity';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import { DoubleCodingReviewDecision } from '../../entities/double-coding-review-decision.entity';
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
import {
  DoubleCodedManagerDecisionDto,
  DoubleCodedReviewCodeDto,
  DoubleCodedReviewQuery,
  DoubleCodedReviewResponseDto
} from '../../../../../../../api-dto/coding/double-coded-review.dto';

type JobDefinitionBundleScope = {
  bundleIds: number[];
  variableKeysByBundleId: Map<number, Set<string>>;
};

type DoubleCodedReviewFilters = DoubleCodedReviewQuery & {
  includeRelations?: boolean;
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
  missingsProfileId: number | string | null;
  code: number | string | null;
  codingIssueOption: number | string | null;
  score: number | string | null;
  notes: string | null;
  supervisorComment: string | null;
  codedAt: Date | string;
};

@Injectable()
export class DoubleCodingReviewQueryService {
  private readonly logger = new Logger(DoubleCodingReviewQueryService.name);
  private readonly manualMissingIdsByIssueOptionId = new Map<number, string>([
    [-3, 'mir'],
    [-4, 'mci']
  ]);

  constructor(
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    @InjectRepository(JobDefinition)
    private jobDefinitionRepository: Repository<JobDefinition>,
    @InjectRepository(VariableBundle)
    private variableBundleRepository: Repository<VariableBundle>,
    private codingStatisticsService: CodingStatisticsService,
    private workspaceExclusionService: WorkspaceExclusionService,
    private codingJobService: CodingJobService,
    private missingsProfilesService: MissingsProfilesService,
    @InjectRepository(DoubleCodingReviewDecision)
    private reviewDecisionRepository: Repository<DoubleCodingReviewDecision>
  ) { }

  private async resolveManualMissingForReview(
    workspaceId: number,
    unit: CodingJobUnit,
    cache: Map<string, Promise<ResolvedMissingValue>>
  ): Promise<{ code: number | null; score: number | null }> {
    const missingId = this.manualMissingIdsByIssueOptionId.get(unit.code ?? 0) ??
      this.manualMissingIdsByIssueOptionId.get(unit.coding_issue_option ?? 0);
    if (!missingId) {
      return {
        code: unit.code,
        score: unit.score
      };
    }

    const profileId = unit.coding_job?.missings_profile_id ?? null;
    const missing = await this.getCachedReviewMissing(
      workspaceId,
      profileId,
      missingId,
      cache
    );

    return {
      code: missing.code,
      score: missing.score
    };
  }

  private async getGeneralReviewCodes(
    workspaceId: number,
    unit: CodingJobUnit,
    cache: Map<string, Promise<ResolvedMissingValue>>
  ): Promise<DoubleCodedReviewCodeDto[]> {
    const definitions = [
      { code: -3, missingId: 'mir', label: '(mir) Ungültig (Spaßantwort)' },
      { code: -4, missingId: 'mci', label: '(mci) Technische Probleme' }
    ];
    const profileId = unit.coding_job?.missings_profile_id ?? null;

    return Promise.all(definitions.map(async definition => {
      const missing = await this.getCachedReviewMissing(
        workspaceId,
        profileId,
        definition.missingId,
        cache
      );

      return {
        code: definition.code,
        label: definition.label,
        score: missing.score,
        source: 'general' as const
      };
    }));
  }

  private getCachedReviewMissing(
    workspaceId: number,
    profileId: number | null,
    missingId: string,
    cache: Map<string, Promise<ResolvedMissingValue>>
  ): Promise<ResolvedMissingValue> {
    const cacheKey = `${profileId ?? 'default'}:${missingId}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const pending = this.missingsProfilesService.getMissingByIdForProfileOrDefault(
      workspaceId,
      profileId,
      missingId
    ).catch(error => {
      cache.delete(cacheKey);
      throw error;
    });
    cache.set(cacheKey, pending);
    return pending;
  }

  private async resolveKappaCodeAndScore(
    workspaceId: number,
    code: number | null,
    score: number | null,
    codingIssueOption: number | null,
    missingsProfileId: number | null,
    cache: Map<string, ResolvedMissingValue>
  ): Promise<{ code: number | null; score: number | null }> {
    if (code === -1 || code === -2) {
      return { code: null, score: null };
    }

    const missingId = this.manualMissingIdsByIssueOptionId.get(code ?? 0) ??
      this.manualMissingIdsByIssueOptionId.get(codingIssueOption ?? 0);
    if (missingId) {
      const cacheKey = `${missingsProfileId ?? 'default'}:id:${missingId}`;
      let missing = cache.get(cacheKey);
      if (!missing) {
        missing = await this.missingsProfilesService.getMissingByIdForProfileOrDefault(
          workspaceId,
          missingsProfileId,
          missingId
        );
        cache.set(cacheKey, missing);
      }
      return {
        code: missing.code,
        score: missing.score
      };
    }

    if (code !== null && code < 0) {
      const cacheKey = `${missingsProfileId ?? 'default'}:code:${code}`;
      let missing = cache.get(cacheKey);
      if (!missing) {
        missing = await this.missingsProfilesService.getMissingByCodeForProfileOrDefault(
          workspaceId,
          missingsProfileId,
          code
        );
        cache.set(cacheKey, missing);
      }
      return {
        code: missing.code,
        score: missing.score
      };
    }

    return { code, score };
  }

  async getDoubleCodedVariablesForReview(
    workspaceId: number,
    filters: DoubleCodedReviewFilters = {}
  ): Promise<DoubleCodedReviewResponseDto> {
    const {
      page = 1,
      limit = 50,
      onlyConflicts = false,
      excludeTrainings = false,
      search,
      coderId,
      statusFilter,
      resolvedFilter,
      agreementFilter,
      sortBy = 'unitVariable',
      sortDirection = 'asc',
      jobDefinitionIds,
      coderTrainingIds,
      includeRelations = true
    } = filters;
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

      const orderDirection = sortDirection === 'desc' ? 'DESC' : 'ASC';
      if (sortBy === 'personInfo') {
        query
          .orderBy("MIN(LOWER(COALESCE(cju.person_login, p.login, '')))", orderDirection)
          .addOrderBy("MIN(LOWER(COALESCE(cju.person_code, p.code, '')))", orderDirection)
          .addOrderBy("MIN(LOWER(COALESCE(cju.booklet_name, '')))", orderDirection)
          .addOrderBy("MIN(LOWER(COALESCE(cju.unit_name, u.name, '')))", orderDirection)
          .addOrderBy("MIN(LOWER(COALESCE(cju.variable_id, resp.variableid, '')))", orderDirection);
      } else {
        query
          .orderBy("MIN(LOWER(COALESCE(cju.unit_name, u.name, '')))", orderDirection)
          .addOrderBy("MIN(LOWER(COALESCE(cju.variable_id, resp.variableid, '')))", orderDirection)
          .addOrderBy("MIN(LOWER(COALESCE(cju.person_login, p.login, '')))", orderDirection);
      }
      query.addOrderBy('cju.response_id', 'ASC');
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
        sourceUnitId: number;
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
        availableCodes: DoubleCodedReviewCodeDto[];
        managerDrafts: DoubleCodedManagerDecisionDto[];
        managerHistory: DoubleCodedManagerDecisionDto[];
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
      const manualMissingCache = new Map<string, Promise<ResolvedMissingValue>>();

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
            sourceUnitId: unit.id,
            unitName: unit.unit_name || unit.response?.unit?.name || '',
            variableId: unit.variable_id,
            personLogin: unit.person_login || unit.response?.unit?.booklet?.person?.login || '',
            personCode: unit.person_code || unit.response?.unit?.booklet?.person?.code || '',
            personGroup: unit.person_group || unit.response?.unit?.booklet?.person?.group || '',
            bookletName: unit.booklet_name || unit.response?.unit?.booklet?.bookletinfo?.name || '',
            givenAnswer: unit.response?.value || '',
            isResolved,
            ...appliedResult,
            availableCodes: [],
            managerDrafts: [],
            managerHistory: [],
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

      const responseOrder = new Map(
        paginatedResponseIds.map((responseId, index) => [responseId, index])
      );
      const data = Array.from(responseGroups.values())
        .filter(group => group.coderResults.length > 1)
        .sort((a, b) => (
          (responseOrder.get(a.responseId) ?? Number.MAX_SAFE_INTEGER) -
          (responseOrder.get(b.responseId) ?? Number.MAX_SAFE_INTEGER)
        ));

      const representativeUnitByResponseId = new Map<number, CodingJobUnit>();
      finalCodingJobUnits.forEach(unit => {
        const current = representativeUnitByResponseId.get(unit.response_id);
        if (responseGroups.has(unit.response_id) && (!current || unit.id < current.id)) {
          representativeUnitByResponseId.set(unit.response_id, unit);
        }
      });
      const representativeUnits = [...representativeUnitByResponseId.values()];
      const selectableCodesByUnit = typeof this.codingJobService.getSelectableReviewCodesForUnits === 'function' ?
        await this.codingJobService.getSelectableReviewCodesForUnits(representativeUnits, workspaceId) :
        new Map<CodingJobUnit, Array<{ code: number; label: string; score: number | null }>>();
      await Promise.all(data.map(async group => {
        const representativeUnit = representativeUnitByResponseId.get(group.responseId);
        if (representativeUnit) {
          group.sourceUnitId = representativeUnit.id;
        }
        const schemaCodes = representativeUnit ? selectableCodesByUnit.get(representativeUnit) || [] : [];
        const generalCodes = representativeUnit ?
          await this.getGeneralReviewCodes(workspaceId, representativeUnit, manualMissingCache) :
          [];
        group.availableCodes = [
          ...schemaCodes.map(code => ({ ...code, source: 'schema' as const })),
          ...generalCodes
        ];
      }));
      await this.attachManagerDecisions(workspaceId, data);

      this.logger.log(
        `Found ${total} double-coded variables for review in workspace ${workspaceId}, returning page ${page} with ${data.length} items`
      );

      return {
        data: data.map(group => ({
          ...group,
          coderResults: group.coderResults.map(result => ({
            ...result,
            codedAt: this.toIsoString(result.codedAt)
          }))
        })),
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

  private async attachManagerDecisions(
    workspaceId: number,
    groups: Array<{
      responseId: number;
      isResolved: boolean;
      appliedCode: number | null;
      appliedScore: number | null;
      appliedComment: string | null;
      managerDrafts: DoubleCodedManagerDecisionDto[];
      managerHistory: DoubleCodedManagerDecisionDto[];
    }>
  ): Promise<void> {
    if (groups.length === 0) {
      groups.forEach(group => this.addLegacyManagerHistory(group));
      return;
    }

    const responseIds = groups.map(group => group.responseId);
    const decisions = await this.reviewDecisionRepository.find({
      where: {
        workspace_id: workspaceId,
        response_id: In(responseIds)
      },
      order: {
        created_at: 'ASC',
        id: 'ASC'
      }
    });
    const decisionsByResponseId = new Map<number, DoubleCodingReviewDecision[]>();
    decisions.forEach(decision => {
      const responseDecisions = decisionsByResponseId.get(decision.response_id) || [];
      responseDecisions.push(decision);
      decisionsByResponseId.set(decision.response_id, responseDecisions);
    });

    groups.forEach(group => {
      const responseDecisions = decisionsByResponseId.get(group.responseId) || [];
      group.managerDrafts = responseDecisions
        .filter(decision => decision.state === 'draft')
        .map(decision => this.toManagerDecisionDto(decision));
      group.managerHistory = responseDecisions
        .filter(decision => decision.state !== 'draft')
        .map(decision => this.toManagerDecisionDto(decision));
      this.addLegacyManagerHistory(group);
    });
  }

  private addLegacyManagerHistory(group: {
    responseId: number;
    isResolved: boolean;
    appliedCode: number | null;
    appliedScore: number | null;
    appliedComment: string | null;
    managerHistory: DoubleCodedManagerDecisionDto[];
  }): void {
    if (!group.isResolved || group.managerHistory.some(decision => decision.state === 'applied')) {
      return;
    }

    group.managerHistory.push({
      id: null,
      responseId: group.responseId,
      managerUserId: null,
      managerKey: null,
      managerName: 'Manager unbekannt',
      state: 'applied',
      effectiveCode: group.appliedCode,
      selectedCode: null,
      score: group.appliedScore,
      comment: group.appliedComment,
      createdAt: null,
      updatedAt: null,
      finalizedAt: null,
      legacy: true
    });
  }

  private toManagerDecisionDto(decision: DoubleCodingReviewDecision): DoubleCodedManagerDecisionDto {
    return {
      id: decision.id,
      responseId: decision.response_id,
      managerUserId: decision.manager_user_id,
      managerKey: decision.manager_key,
      managerName: decision.manager_name,
      state: decision.state,
      effectiveCode: this.toNullableNumber(decision.effective_code),
      selectedCode: this.toNullableNumber(decision.selected_code),
      score: this.toNullableNumber(decision.score),
      comment: decision.comment,
      createdAt: this.toIsoString(decision.created_at),
      updatedAt: this.toIsoString(decision.updated_at),
      finalizedAt: this.toIsoString(decision.finalized_at),
      legacy: false
    };
  }

  private toIsoString(value: Date | string): string;
  private toIsoString(value: Date | string | null): string | null;
  private toIsoString(value: Date | string | null): string | null {
    if (value === null) {
      return null;
    }
    return value instanceof Date ? value.toISOString() : value;
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
      .addSelect('cj.missings_profile_id', 'missingsProfileId')
      .addSelect('cju.code', 'code')
      .addSelect('cju.coding_issue_option', 'codingIssueOption')
      .addSelect('cju.score', 'score')
      .addSelect('cju.notes', 'notes')
      .addSelect('cju.supervisor_comment', 'supervisorComment')
      .addSelect('COALESCE(cju.updated_at, cju.created_at)', 'codedAt')
      .where('cj.workspace_id = :workspaceId', { workspaceId })
      .andWhere(
        calculationLevel === 'score' ?
          '(cju.score IS NOT NULL OR cju.code < 0 OR cju.coding_issue_option IN (-3, -4))' :
          '(cju.code IS NOT NULL OR cju.coding_issue_option IN (-3, -4))'
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
    const missingValueCache = new Map<string, ResolvedMissingValue>();
    let offset = 0;
    let hasMoreRows = true;

    while (hasMoreRows) {
      const rows = await query
        .offset(offset)
        .limit(batchSize)
        .getRawMany<KappaCodedVariableRow>();

      for (const row of rows) {
        const responseId = Number(row.responseId);
        const coderId = Number(row.coderId);
        const codeAndScore = await this.resolveKappaCodeAndScore(
          workspaceId,
          this.toNullableNumber(row.code),
          this.toNullableNumber(row.score),
          this.toNullableNumber(row.codingIssueOption),
          this.toNullableNumber(row.missingsProfileId),
          missingValueCache
        );
        const hasCalculationLevelValue = calculationLevel === 'score' ?
          codeAndScore.score !== null :
          codeAndScore.code !== null;
        if (!hasCalculationLevelValue) {
          continue;
        }

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
          code: codeAndScore.code,
          score: codeAndScore.score,
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
      }

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

    return `(${directClause} OR (${codingJobAlias}.job_definition_id IS NULL AND ${codingJobAlias}.training_id IS NULL AND EXISTS (
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
      !trainingId &&
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
          {
            page: currentPage,
            limit: batchSize,
            onlyConflicts: false,
            excludeTrainings,
            jobDefinitionIds,
            coderTrainingIds,
            includeRelations: false
          }
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
