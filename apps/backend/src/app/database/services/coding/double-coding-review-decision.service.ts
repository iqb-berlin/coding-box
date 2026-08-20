import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager, In, IsNull, Not, Repository
} from 'typeorm';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CodingJobCoder } from '../../entities/coding-job-coder.entity';
import { DoubleCodingReviewDecision } from '../../entities/double-coding-review-decision.entity';
import { CodingStatisticsService } from './coding-statistics.service';
import {
  applyResolvedExclusionsToQuery,
  isExcludedByResolvedExclusions,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import { MissingsProfilesService } from './missings-profiles.service';
import { CODING_JOB_TYPE_CODING_ISSUE_REVIEW } from './coding-job-type.util';
import {
  CodingJobAggregationSettings,
  CodingJobService,
  ResponseMatchingFlag
} from './coding-job.service';
import { CodingAnalysisService } from './coding-analysis.service';
import { CodingValidationService } from './coding-validation.service';
import { CodingProgressService } from './coding-progress.service';
import { CodingFreshnessService } from './coding-freshness.service';
import { buildAggregationGroups } from './aggregation-metrics.util';
import {
  DoubleCodedManagerDecisionDto,
  DoubleCodedResolutionDecisionDto,
  DoubleCodedResolutionResultDto,
  SaveDoubleCodedReviewDraftDto
} from '../../../../../../../api-dto/coding/double-coded-review.dto';

type ResolvedDoubleCodedResolution = {
  response: ResponseEntity;
  sourceUnit: CodingJobUnit;
  selectionCode: number;
  code: number | null;
  score: number | null;
};

type ResolvedReviewSelection = {
  code: number;
  score: number | null;
};

type AggregationSiblingApplication = {
  updatedResponseIds: number[];
  protectedPartialResponseIds: number[];
};

type AggregationReconciliationItem = {
  responseId: number;
  sourceUnitId: number | null;
  status: 'would-update' | 'updated' | 'protected' | 'no-op' | 'skipped' | 'failed';
  siblingResponseIds: number[];
  protectedPartialResponseIds: number[];
  reason?: string;
};

type AggregationReconciliationResult = {
  dryRun: boolean;
  scannedDecisionCount: number;
  representativeCount: number;
  wouldUpdateCount: number;
  updatedCount: number;
  protectedPartialCount: number;
  noOpCount: number;
  skippedCount: number;
  failedCount: number;
  items: AggregationReconciliationItem[];
};

@Injectable()
export class DoubleCodingReviewDecisionService {
  private readonly logger = new Logger(DoubleCodingReviewDecisionService.name);
  private readonly allowedCodingIssueCodes = new Set([-3, -4]);
  private readonly manualMissingIdsByIssueOptionId = new Map<number, string>([
    [-3, 'mir'],
    [-4, 'mci']
  ]);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    private codingStatisticsService: CodingStatisticsService,
    private codingAnalysisService: CodingAnalysisService,
    private codingValidationService: CodingValidationService,
    private codingProgressService: CodingProgressService,
    private workspaceExclusionService: WorkspaceExclusionService,
    private codingJobService: CodingJobService,
    private missingsProfilesService: MissingsProfilesService,
    @InjectRepository(DoubleCodingReviewDecision)
    private reviewDecisionRepository: Repository<DoubleCodingReviewDecision>,
    private codingFreshnessService: CodingFreshnessService
  ) { }

  private toManagerDecisionDto(
    decision: DoubleCodingReviewDecision
  ): DoubleCodedManagerDecisionDto {
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

  private toIsoString(value: Date | string | null): string | null {
    if (value === null) {
      return null;
    }
    return value instanceof Date ? value.toISOString() : value;
  }

  private toNullableNumber(
    value: number | string | null | undefined
  ): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : null;
  }

  private getDistinctCodingJobCoders(
    coders: CodingJobCoder[]
  ): CodingJobCoder[] {
    const distinctCoders = new Map<number, CodingJobCoder>();
    coders.forEach(coder => {
      if (!distinctCoders.has(coder.user_id)) {
        distinctCoders.set(coder.user_id, coder);
      }
    });
    return Array.from(distinctCoders.values());
  }

  async saveDoubleCodedReviewDraft(
    workspaceId: number,
    responseId: number,
    managerUserId: number,
    managerName: string,
    draft: SaveDoubleCodedReviewDraftDto
  ): Promise<DoubleCodedManagerDecisionDto> {
    return this.responseRepository.manager.transaction(async entityManager => {
      const sourceUnitId = this.normalizeExplicitReplayInteger(draft.sourceUnitId);
      if (sourceUnitId === undefined || sourceUnitId <= 0) {
        throw new BadRequestException('A valid review source unit is required');
      }
      const sourceUnit = await this.getReviewSourceUnit(
        entityManager,
        workspaceId,
        responseId,
        sourceUnitId
      );
      if (!sourceUnit || !await this.isResolutionSourceAllowed(workspaceId, sourceUnit)) {
        throw new NotFoundException('Review case not found');
      }

      const response = await entityManager.findOne(ResponseEntity, {
        where: { id: sourceUnit.response.id },
        lock: { mode: 'pessimistic_write' }
      });
      if (!response) {
        throw new NotFoundException('Review response not found');
      }
      if (response.status_v2 === statusStringToNumber('CODING_COMPLETE')) {
        throw new ConflictException('Applied review cases cannot be reopened');
      }

      const code = this.normalizeExplicitReplayInteger(draft.code);
      if (code === undefined) {
        throw new BadRequestException('A valid final code is required');
      }
      const resolvedSelection = await this.resolveReviewSelection(workspaceId, sourceUnit, code);
      if (!resolvedSelection) {
        throw new BadRequestException('Code is not selectable for this review case');
      }

      const normalizedName = managerName.trim() || `Manager ${managerUserId}`;
      const normalizedComment = draft.comment?.trim() || null;
      const repository = entityManager.getRepository(DoubleCodingReviewDecision);
      await repository.upsert({
        workspace_id: workspaceId,
        response_id: responseId,
        manager_user_id: managerUserId,
        manager_key: String(managerUserId),
        manager_name: normalizedName,
        state: 'draft',
        effective_code: resolvedSelection.code,
        selected_code: code,
        score: resolvedSelection.score,
        comment: normalizedComment,
        finalized_at: null
      }, {
        conflictPaths: ['workspace_id', 'response_id', 'manager_user_id'],
        indexPredicate: '"state" = \'draft\'',
        skipUpdateIfNoValuesChanged: true
      });
      const saved = await repository.findOneOrFail({
        where: {
          workspace_id: workspaceId,
          response_id: responseId,
          manager_user_id: managerUserId,
          state: 'draft'
        }
      });
      return this.toManagerDecisionDto(saved);
    });
  }

  private async getReviewSourceUnit(
    manager: EntityManager,
    workspaceId: number,
    responseId: number,
    sourceUnitId: number
  ): Promise<CodingJobUnit | null> {
    const sourceUnit = await manager.findOne(CodingJobUnit, {
      where: [
        {
          id: sourceUnitId,
          response_id: responseId,
          coding_job: {
            workspace_id: workspaceId,
            job_type: IsNull()
          }
        },
        {
          id: sourceUnitId,
          response_id: responseId,
          coding_job: {
            workspace_id: workspaceId,
            job_type: Not(CODING_JOB_TYPE_CODING_ISSUE_REVIEW)
          }
        }
      ],
      relations: ['response', 'coding_job', 'coding_job.codingJobCoders']
    });
    if (!sourceUnit || this.getDistinctCodingJobCoders(
      sourceUnit.coding_job?.codingJobCoders || []
    ).length !== 1) {
      return null;
    }
    return sourceUnit;
  }

  async deleteDoubleCodedReviewDraft(
    workspaceId: number,
    responseId: number,
    managerUserId: number
  ): Promise<{ success: boolean }> {
    const result = await this.reviewDecisionRepository.delete({
      workspace_id: workspaceId,
      response_id: responseId,
      manager_user_id: managerUserId,
      state: 'draft'
    });
    return { success: (result.affected || 0) > 0 };
  }

  async applyDoubleCodedResolutions(
    workspaceId: number,
    decisions: DoubleCodedResolutionDecisionDto[],
    manager: { userId: number; name: string }
  ): Promise<{
      success: boolean;
      appliedCount: number;
      failedCount: number;
      skippedCount: number;
      message: string;
      results: DoubleCodedResolutionResultDto[];
    }> {
    if (
      !manager ||
      !Number.isInteger(manager.userId) ||
      manager.userId <= 0 ||
      typeof manager.name !== 'string'
    ) {
      throw new BadRequestException('A valid manager is required to apply review decisions');
    }

    try {
      this.logger.log(
        `Applying ${decisions.length} double-coded resolutions in workspace ${workspaceId}`
      );

      let appliedCount = 0;
      let failedCount = 0;
      let skippedCount = 0;
      const results: DoubleCodedResolutionResultDto[] = [];

      for (const decision of decisions) {
        try {
          const result = await this.responseRepository.manager.transaction(
            transactionalEntityManager => this.applyDoubleCodedResolutionInTransaction(
              transactionalEntityManager,
              workspaceId,
              decision,
              manager
            )
          );
          results.push(result);
          if (result.status === 'applied') appliedCount += 1;
          if (result.status === 'skipped') skippedCount += 1;
        } catch (error) {
          this.logger.error(
            `Error applying resolution for responseId ${decision.responseId}: ${error.message}`,
            error.stack
          );
          failedCount += 1;
          results.push({
            responseId: decision.responseId,
            status: 'failed',
            message: error.message
          });
        }
      }

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
      if (appliedCount > 0) {
        await this.codingProgressService.invalidateAppliedResultsOverviewCache(workspaceId);
      }

      const message = `Applied ${appliedCount} resolutions successfully. ${failedCount > 0 ? `${failedCount} failed.` : ''
      } ${skippedCount > 0 ? `${skippedCount} skipped.` : ''}`;
      this.logger.log(message);

      return {
        success: appliedCount > 0,
        appliedCount,
        failedCount,
        skippedCount,
        message,
        results
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

  async reconcileAppliedAggregationResolutions(
    workspaceId: number,
    options: { dryRun?: boolean; responseIds?: number[] } = {}
  ): Promise<AggregationReconciliationResult> {
    const dryRun = options.dryRun !== false;
    const responseIds = options.responseIds ?
      Array.from(new Set(options.responseIds)) :
      undefined;
    const decisions = await this.reviewDecisionRepository.find({
      where: {
        workspace_id: workspaceId,
        state: 'applied',
        ...(responseIds?.length ? { response_id: In(responseIds) } : {})
      },
      order: { updated_at: 'DESC', id: 'DESC' }
    });
    const latestDecisionByResponseId = new Map<number, DoubleCodingReviewDecision>();
    decisions.forEach(decision => {
      if (!latestDecisionByResponseId.has(decision.response_id)) {
        latestDecisionByResponseId.set(decision.response_id, decision);
      }
    });

    const result: AggregationReconciliationResult = {
      dryRun,
      scannedDecisionCount: decisions.length,
      representativeCount: latestDecisionByResponseId.size,
      wouldUpdateCount: 0,
      updatedCount: 0,
      protectedPartialCount: 0,
      noOpCount: 0,
      skippedCount: 0,
      failedCount: 0,
      items: []
    };

    for (const decision of latestDecisionByResponseId.values()) {
      try {
        const item = await this.responseRepository.manager.transaction(
          entityManager => this.reconcileAppliedAggregationResolutionInTransaction(
            entityManager,
            workspaceId,
            decision,
            dryRun
          )
        );
        result.items.push(item);
        result.protectedPartialCount += item.protectedPartialResponseIds.length;
        if (item.status === 'would-update') {
          result.wouldUpdateCount += item.siblingResponseIds.length;
        } else if (item.status === 'updated') {
          result.updatedCount += item.siblingResponseIds.length;
        } else if (item.status === 'no-op' || item.status === 'protected') {
          result.noOpCount += 1;
        } else if (item.status === 'skipped') {
          result.skippedCount += 1;
        }
      } catch (error) {
        this.logger.error(
          `Could not reconcile aggregation siblings for responseId ${decision.response_id}: ${error.message}`,
          error.stack
        );
        result.failedCount += 1;
        result.items.push({
          responseId: decision.response_id,
          sourceUnitId: null,
          status: 'failed',
          siblingResponseIds: [],
          protectedPartialResponseIds: [],
          reason: error.message
        });
      }
    }

    if (!dryRun && result.updatedCount > 0) {
      await this.invalidateCodingCaches(workspaceId);
    }
    this.logger.log(
      `${dryRun ? 'Dry-run for' : 'Applied'} aggregation reconciliation in workspace ${workspaceId}: representatives=${result.representativeCount}, ${dryRun ? 'wouldUpdate' : 'updated'}=${dryRun ? result.wouldUpdateCount : result.updatedCount}, protectedPartial=${result.protectedPartialCount}, skipped=${result.skippedCount}, failed=${result.failedCount}`
    );
    return result;
  }

  private async reconcileAppliedAggregationResolutionInTransaction(
    entityManager: EntityManager,
    workspaceId: number,
    decision: DoubleCodingReviewDecision,
    dryRun: boolean
  ): Promise<AggregationReconciliationItem> {
    const responseId = decision.response_id;
    const representative = await entityManager.findOne(ResponseEntity, {
      where: { id: responseId },
      ...(!dryRun ? { lock: { mode: 'pessimistic_write' as const } } : {})
    });
    const emptyItem = {
      responseId,
      sourceUnitId: null,
      siblingResponseIds: [],
      protectedPartialResponseIds: []
    };
    if (!representative) {
      return { ...emptyItem, status: 'skipped', reason: 'Representative response not found' };
    }
    if (representative.status_v2 !== statusStringToNumber('CODING_COMPLETE')) {
      return {
        ...emptyItem,
        status: 'skipped',
        reason: 'Applied manager decision has no completed v2 response'
      };
    }
    if (representative.code_v2 === null) {
      return {
        ...emptyItem,
        status: 'skipped',
        reason: 'Completed representative has no v2 code'
      };
    }
    if (
      this.toNullableNumber(decision.effective_code) !==
        this.toNullableNumber(representative.code_v2) ||
      this.toNullableNumber(decision.score) !==
        this.toNullableNumber(representative.score_v2)
    ) {
      return {
        ...emptyItem,
        status: 'skipped',
        reason: 'Applied manager decision no longer matches the v2 response'
      };
    }

    const source = await this.getReconciliationSourceUnit(
      entityManager,
      workspaceId,
      decision
    );
    if (!source.sourceUnit || !source.aggregationSettings) {
      return { ...emptyItem, status: 'skipped', reason: source.reason };
    }

    const application = await this.applyResolutionToAggregationSiblings(
      entityManager,
      workspaceId,
      {
        response: representative,
        sourceUnit: source.sourceUnit,
        selectionCode: representative.code_v2,
        code: representative.code_v2,
        score: representative.score_v2
      },
      representative,
      { dryRun, aggregationSettings: source.aggregationSettings }
    );
    if (!dryRun && application.updatedResponseIds.length > 0) {
      await this.codingFreshnessService.markManualCodingCurrent(
        workspaceId,
        application.updatedResponseIds,
        {
          clearCoveredReviewJobs: true,
          manager: entityManager
        }
      );
    }

    let status: AggregationReconciliationItem['status'];
    if (application.updatedResponseIds.length > 0) {
      status = dryRun ? 'would-update' : 'updated';
    } else if (application.protectedPartialResponseIds.length > 0) {
      status = 'protected';
    } else {
      status = 'no-op';
    }
    return {
      responseId,
      sourceUnitId: source.sourceUnit.id,
      status,
      siblingResponseIds: application.updatedResponseIds,
      protectedPartialResponseIds: application.protectedPartialResponseIds
    };
  }

  private async getReconciliationSourceUnit(
    entityManager: EntityManager,
    workspaceId: number,
    decision: DoubleCodingReviewDecision
  ): Promise<{
      sourceUnit: CodingJobUnit | null;
      aggregationSettings: CodingJobAggregationSettings | null;
      reason?: string;
    }> {
    const decisionTime = decision.finalized_at || decision.updated_at;
    const sourceUnits = (await entityManager.find(CodingJobUnit, {
      where: [
        {
          response_id: decision.response_id,
          coding_job: { workspace_id: workspaceId, job_type: IsNull() }
        },
        {
          response_id: decision.response_id,
          coding_job: {
            workspace_id: workspaceId,
            job_type: Not(CODING_JOB_TYPE_CODING_ISSUE_REVIEW)
          }
        }
      ],
      relations: ['response', 'coding_job', 'coding_job.codingJobCoders'],
      order: { id: 'ASC' }
    })).filter(unit => {
      const existedWhenDecisionWasApplied = !decisionTime || !unit.created_at ||
        new Date(unit.created_at).getTime() <= new Date(decisionTime).getTime();
      return unit.coding_job && existedWhenDecisionWasApplied &&
        this.getDistinctCodingJobCoders(unit.coding_job.codingJobCoders || []).length === 1;
    });
    if (sourceUnits.length === 0) {
      return {
        sourceUnit: null,
        aggregationSettings: null,
        reason: 'No eligible single-coder source unit found'
      };
    }
    if (!await this.isResolutionSourceAllowed(workspaceId, sourceUnits[0])) {
      return {
        sourceUnit: null,
        aggregationSettings: null,
        reason: 'Representative response is excluded from coding'
      };
    }

    const settingsByUnit = await Promise.all(sourceUnits.map(async sourceUnit => ({
      sourceUnit,
      settings: await this.codingJobService.getAggregationSettingsForCodingJob(
        sourceUnit.coding_job
      )
    })));
    if (settingsByUnit.some(entry => !entry.settings.fromJobSnapshot)) {
      return {
        sourceUnit: null,
        aggregationSettings: null,
        reason: 'Stored aggregation snapshot is unavailable for at least one source job'
      };
    }
    const settingsFingerprints = new Set(settingsByUnit.map(entry => JSON.stringify([
      entry.settings.aggregationEnabled,
      entry.settings.aggregationThreshold,
      [...entry.settings.responseMatchingFlags].sort()
    ])));
    if (settingsFingerprints.size !== 1) {
      return {
        sourceUnit: null,
        aggregationSettings: null,
        reason: 'Source jobs have conflicting aggregation snapshots'
      };
    }

    return {
      sourceUnit: settingsByUnit[0].sourceUnit,
      aggregationSettings: settingsByUnit[0].settings
    };
  }

  private async invalidateCodingCaches(workspaceId: number): Promise<void> {
    if (typeof this.codingStatisticsService.invalidateCache === 'function') {
      await this.codingStatisticsService.invalidateCache(workspaceId);
    }
    if (typeof this.codingAnalysisService.invalidateCache === 'function') {
      await this.codingAnalysisService.invalidateCache(workspaceId);
    }
    if (typeof this.codingValidationService.invalidateIncompleteVariablesCache === 'function') {
      await this.codingValidationService.invalidateIncompleteVariablesCache(workspaceId);
    }
    if (typeof this.codingProgressService.invalidateAppliedResultsOverviewCache === 'function') {
      await this.codingProgressService.invalidateAppliedResultsOverviewCache(workspaceId);
    }
  }

  private async applyDoubleCodedResolutionInTransaction(
    transactionalEntityManager: EntityManager,
    workspaceId: number,
    decision: DoubleCodedResolutionDecisionDto,
    manager: { userId: number; name: string }
  ): Promise<DoubleCodedResolutionResultDto> {
    const resolvedDecision = await this.resolveDoubleCodedResolution(
      transactionalEntityManager,
      workspaceId,
      decision
    );
    if (!resolvedDecision) {
      return {
        responseId: decision.responseId,
        status: 'skipped',
        message: 'Decision is not valid for this review case'
      };
    }

    const response = await transactionalEntityManager.findOne(ResponseEntity, {
      where: { id: resolvedDecision.response.id },
      lock: { mode: 'pessimistic_write' }
    });
    if (!response) {
      return { responseId: decision.responseId, status: 'skipped', message: 'Response not found' };
    }
    if (response.status_v2 === statusStringToNumber('CODING_COMPLETE')) {
      return {
        responseId: decision.responseId,
        status: 'skipped',
        message: 'Applied review cases cannot be reopened'
      };
    }
    if (resolvedDecision.code === -1 || resolvedDecision.code === -2) {
      return {
        responseId: decision.responseId,
        status: 'skipped',
        message: 'Workflow markers cannot be applied as final codes'
      };
    }

    await this.clearWorkspaceSupervisorComments(
      transactionalEntityManager,
      workspaceId,
      decision.responseId
    );

    response.status_v2 = statusStringToNumber('CODING_COMPLETE');
    response.code_v2 = resolvedDecision.code;
    response.score_v2 = resolvedDecision.score;
    response.value = this.getOriginalResponseValue(response.value);
    await transactionalEntityManager.save(ResponseEntity, response);
    const aggregationApplication = await this.applyResolutionToAggregationSiblings(
      transactionalEntityManager,
      workspaceId,
      resolvedDecision,
      response
    );
    await this.persistAppliedManagerDecision(
      transactionalEntityManager,
      workspaceId,
      decision.responseId,
      manager,
      resolvedDecision.selectionCode,
      resolvedDecision.code,
      resolvedDecision.score,
      decision.resolutionComment?.trim() || null
    );
    await this.codingFreshnessService.markManualCodingCurrent(
      workspaceId,
      [response.id, ...aggregationApplication.updatedResponseIds],
      {
        clearCoveredReviewJobs: true,
        manager: transactionalEntityManager
      }
    );
    this.logger.debug(
      `Applied resolution for responseId ${decision.responseId}: code=${resolvedDecision.code}, score=${resolvedDecision.score}, aggregatedSiblings=${aggregationApplication.updatedResponseIds.length}, protectedPartialSiblings=${aggregationApplication.protectedPartialResponseIds.length}`
    );
    return {
      responseId: decision.responseId,
      status: 'applied',
      ...(aggregationApplication.protectedPartialResponseIds.length > 0 ? {
        message:
          `${aggregationApplication.protectedPartialResponseIds.length} aggregation sibling(s) with existing v2 values were not overwritten`
      } : {})
    };
  }

  private async applyResolutionToAggregationSiblings(
    entityManager: EntityManager,
    workspaceId: number,
    resolvedDecision: ResolvedDoubleCodedResolution,
    representative: ResponseEntity,
    options: {
      dryRun?: boolean;
      aggregationSettings?: CodingJobAggregationSettings;
    } = {}
  ): Promise<AggregationSiblingApplication> {
    const aggregationSettings = options.aggregationSettings || await this.codingJobService
      .getAggregationSettingsForCodingJob(resolvedDecision.sourceUnit.coding_job);
    const aggregationThreshold = aggregationSettings.aggregationThreshold;
    if (
      !aggregationSettings.aggregationEnabled ||
      aggregationThreshold === null ||
      aggregationSettings.responseMatchingFlags.includes(
        ResponseMatchingFlag.NO_AGGREGATION
      )
    ) {
      return { updatedResponseIds: [], protectedPartialResponseIds: [] };
    }

    const unitName = resolvedDecision.sourceUnit.unit_name;
    const variableId = resolvedDecision.sourceUnit.variable_id;
    if (!unitName || !variableId) {
      return { updatedResponseIds: [], protectedPartialResponseIds: [] };
    }

    const exclusions = await this.workspaceExclusionService
      .resolveExclusionsForQueries(workspaceId);
    const candidateQuery = entityManager
      .getRepository(ResponseEntity)
      .createQueryBuilder('response')
      .leftJoinAndSelect('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .leftJoin('booklet.person', 'person')
      .select([
        'response.id',
        'response.value',
        'response.variableid',
        'response.status_v2',
        'response.code_v2',
        'response.score_v2',
        'unit.id',
        'unit.name'
      ])
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('response.status_v1 IN (:...statuses)', {
        statuses: [
          statusStringToNumber('CODING_INCOMPLETE'),
          statusStringToNumber('INTENDED_INCOMPLETE')
        ]
      })
      .andWhere('UPPER(unit.name) = UPPER(:unitName)', { unitName })
      .andWhere('response.variableid = :variableId', { variableId });
    if (!options.dryRun) {
      candidateQuery.setLock('pessimistic_write', undefined, ['response']);
    }
    applyResolvedExclusionsToQuery(candidateQuery, exclusions, {
      parameterPrefix: 'reviewAggregationSiblings'
    });
    const candidates = await candidateQuery.getMany();
    const candidateById = new Map(candidates.map(candidate => [candidate.id, candidate]));
    candidateById.set(representative.id, {
      ...representative,
      unit: representative.unit || ({ name: unitName } as never)
    });

    const derivedVariableMap = await this.codingJobService
      .getDerivedVariableMapForAggregation(workspaceId);
    const groups = buildAggregationGroups(
      Array.from(candidateById.values()).map(candidate => ({
        responseId: candidate.id,
        unitName: candidate.unit?.name || unitName,
        variableId: candidate.variableid || variableId,
        value: candidate.value,
        statusV2: candidate.status_v2,
        codeV2: candidate.code_v2,
        scoreV2: candidate.score_v2
      })),
      aggregationSettings.responseMatchingFlags,
      aggregationThreshold,
      derivedVariableMap
    );
    const aggregationGroup = groups.find(group => group.responses.some(
      candidate => candidate.responseId === representative.id
    ));
    if (!aggregationGroup || aggregationGroup.responses.length < aggregationThreshold) {
      return { updatedResponseIds: [], protectedPartialResponseIds: [] };
    }

    const unresolvedStatuses = new Set([
      null,
      statusStringToNumber('CODING_INCOMPLETE'),
      statusStringToNumber('INTENDED_INCOMPLETE'),
      statusStringToNumber('CODE_SELECTION_PENDING')
    ]);
    const unresolvedSiblingResponses = aggregationGroup.responses
      .filter(candidate => candidate.responseId !== representative.id)
      .map(candidate => candidateById.get(candidate.responseId))
      .filter((candidate): candidate is ResponseEntity => Boolean(candidate))
      .filter(candidate => unresolvedStatuses.has(candidate.status_v2));
    const protectedPartialResponses = unresolvedSiblingResponses.filter(candidate => (
      candidate.code_v2 !== null || candidate.score_v2 !== null
    ));
    const siblingResponses = unresolvedSiblingResponses.filter(candidate => (
      candidate.code_v2 === null && candidate.score_v2 === null
    ));

    if (!options.dryRun) {
      siblingResponses.forEach(sibling => {
        sibling.status_v2 = representative.status_v2;
        sibling.code_v2 = representative.code_v2;
        sibling.score_v2 = representative.score_v2;
      });
      if (siblingResponses.length > 0) {
        await entityManager.save(ResponseEntity, siblingResponses);
      }
    }

    return {
      updatedResponseIds: siblingResponses.map(sibling => sibling.id),
      protectedPartialResponseIds: protectedPartialResponses.map(sibling => sibling.id)
    };
  }

  private async persistAppliedManagerDecision(
    entityManager: EntityManager,
    workspaceId: number,
    responseId: number,
    manager: { userId: number; name: string },
    selectionCode: number,
    effectiveCode: number | null,
    score: number | null,
    comment: string | null
  ): Promise<void> {
    const repository = entityManager.getRepository(DoubleCodingReviewDecision);
    const drafts = await repository.find({
      where: {
        workspace_id: workspaceId,
        response_id: responseId,
        state: 'draft'
      },
      lock: { mode: 'pessimistic_write' }
    });
    const finalizedAt = new Date();
    let appliedDecision = drafts.find(draft => draft.manager_user_id === manager.userId);

    drafts.forEach(draft => {
      draft.state = draft.manager_user_id === manager.userId ? 'applied' : 'superseded';
      draft.finalized_at = finalizedAt;
    });
    if (drafts.length > 0) {
      await repository.save(drafts);
    }

    if (!appliedDecision) {
      appliedDecision = repository.create({
        workspace_id: workspaceId,
        response_id: responseId,
        manager_user_id: manager.userId,
        manager_key: String(manager.userId),
        manager_name: manager.name.trim() || `Manager ${manager.userId}`,
        state: 'applied',
        effective_code: effectiveCode,
        selected_code: selectionCode,
        score,
        comment,
        finalized_at: finalizedAt
      });
    } else {
      appliedDecision.manager_key = String(manager.userId);
      appliedDecision.manager_name = manager.name.trim() || appliedDecision.manager_name;
      appliedDecision.effective_code = effectiveCode;
      appliedDecision.selected_code = selectionCode;
      appliedDecision.score = score;
      appliedDecision.comment = comment;
    }
    await repository.save(appliedDecision);
  }

  private async resolveDoubleCodedResolution(
    manager: EntityManager,
    workspaceId: number,
    decision: DoubleCodedResolutionDecisionDto
  ): Promise<ResolvedDoubleCodedResolution | null> {
    if (this.hasSelectedCodingJobDecision(decision)) {
      return this.resolveSelectedCodingJobResolution(manager, workspaceId, decision);
    }

    return this.resolveExplicitReplayResolution(manager, workspaceId, decision);
  }

  private hasSelectedCodingJobDecision(decision: DoubleCodedResolutionDecisionDto): boolean {
    return this.normalizeExplicitReplayInteger(decision.selectedJobId) !== undefined;
  }

  private async resolveSelectedCodingJobResolution(
    manager: EntityManager,
    workspaceId: number,
    decision: DoubleCodedResolutionDecisionDto
  ): Promise<ResolvedDoubleCodedResolution | null> {
    const sourceUnitId = this.normalizeExplicitReplayInteger(decision.sourceUnitId);
    if (sourceUnitId === undefined || sourceUnitId <= 0) {
      this.logger.warn(`Missing review source unit for responseId ${decision.responseId}`);
      return null;
    }

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

    const selectedIssueOption = selectedCodingJobUnit.coding_issue_option;
    if (selectedIssueOption === -1 || selectedIssueOption === -2) {
      this.logger.warn(
        `Skipped internal workflow marker for responseId ${decision.responseId} and jobId ${selectedJobId}`
      );
      return null;
    }

    const selectedCode = this.allowedCodingIssueCodes.has(selectedIssueOption ?? 0) ?
      selectedIssueOption :
      selectedCodingJobUnit.code;
    if (selectedCode === null || selectedCode === undefined) {
      this.logger.warn(
        `Skipped empty coding result for responseId ${decision.responseId} and jobId ${selectedJobId}`
      );
      return null;
    }

    const sourceUnit = await this.getReviewSourceUnit(
      manager,
      workspaceId,
      decision.responseId,
      sourceUnitId
    );
    if (!sourceUnit || !await this.isResolutionSourceAllowed(workspaceId, sourceUnit)) {
      this.logger.warn(`Skipped unavailable review source for responseId ${decision.responseId}`);
      return null;
    }

    const resolvedSelection = await this.resolveReviewSelection(workspaceId, sourceUnit, selectedCode);
    if (!resolvedSelection) {
      this.logger.warn(
        `Skipped unavailable coding result for responseId ${decision.responseId} and jobId ${selectedJobId}`
      );
      return null;
    }

    return {
      response: sourceUnit.response,
      sourceUnit,
      selectionCode: selectedCode,
      code: resolvedSelection.code,
      score: resolvedSelection.score
    };
  }

  private async resolveExplicitReplayResolution(
    manager: EntityManager,
    workspaceId: number,
    decision: DoubleCodedResolutionDecisionDto
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

    const sourceUnitId = this.normalizeExplicitReplayInteger(decision.sourceUnitId);
    if (sourceUnitId === undefined || sourceUnitId <= 0) {
      this.logger.warn(`Missing review source unit for replay responseId ${decision.responseId}`);
      return null;
    }

    const sourceUnit = await this.getReviewSourceUnit(
      manager,
      workspaceId,
      decision.responseId,
      sourceUnitId
    );

    if (!sourceUnit) {
      this.logger.warn(`Could not find workspace coding_job_unit for replay responseId ${decision.responseId}`);
      return null;
    }

    if (!await this.isResolutionSourceAllowed(workspaceId, sourceUnit)) {
      this.logger.warn(`Skipped unavailable replay responseId ${decision.responseId}`);
      return null;
    }

    const resolvedSelection = await this.resolveReviewSelection(workspaceId, sourceUnit, code);
    if (!resolvedSelection) {
      this.logger.warn(`Unsupported replay code for responseId ${decision.responseId}: ${code}`);
      return null;
    }

    return {
      response: sourceUnit.response,
      sourceUnit,
      selectionCode: code,
      code: resolvedSelection.code,
      score: resolvedSelection.score
    };
  }

  private async resolveReviewSelection(
    workspaceId: number,
    sourceUnit: CodingJobUnit,
    code: number
  ): Promise<ResolvedReviewSelection | undefined> {
    if (code < 0) {
      if (!this.allowedCodingIssueCodes.has(code)) {
        return undefined;
      }
      const missingId = this.manualMissingIdsByIssueOptionId.get(code);
      if (!missingId) {
        return undefined;
      }
      const missing = await this.missingsProfilesService.getMissingByIdForProfileOrDefault(
        workspaceId,
        sourceUnit.coding_job?.missings_profile_id ?? null,
        missingId
      );
      return {
        code: missing.code,
        score: missing.score
      };
    }

    try {
      const selectableCode = await this.codingJobService.getSelectableReviewCodeForUnit(
        sourceUnit,
        workspaceId,
        code
      );
      return {
        code: selectableCode.code,
        score: selectableCode.score
      };
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
}
