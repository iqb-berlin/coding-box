import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  ApplyTrainingDiscussionResultsRequestDto,
  ApplyTrainingDiscussionResultsResultDto,
  TrainingDiscussionApplyPreviewDto,
  TrainingDiscussionApplySource,
  TrainingDiscussionExistingResultStrategy,
  TrainingDiscussionJobConflictStrategy
} from '../../../../../../../api-dto/coding/training-discussion-apply.dto';
import { ResponseEntity } from '../../entities/response.entity';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { lockWorkspaceTestResultsMutationInTransaction } from '../shared/workspace-test-results-lock.util';
import {
  normalizeExclusionBookletId,
  normalizeExclusionUnitId,
  ResolvedWorkspaceExclusions,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import { CodingAnalysisService } from './coding-analysis.service';
import { CodingFreshnessService } from './coding-freshness.service';
import { getNonCodingIssueReviewJobSqlCondition } from './coding-job-type.util';
import { CodingStatisticsService } from './coding-statistics.service';
import { CodingValidationService } from './coding-validation.service';
import { CoderTrainingService } from './coder-training.service';

interface TrainingDiscussionCandidate {
  responseId: number;
  unitName: string;
  variableId: string;
  code: number | null;
  score: number | null;
}

interface ProductiveJobConflict {
  jobUnitId: number;
  responseId: number;
  jobId: number;
  jobDefinitionId: number | null;
  jobDefinitionStatus: string | null;
  jobStatus: string | null;
  hasCodingWork: boolean;
}

interface ApplyContext {
  preview: TrainingDiscussionApplyPreviewDto;
  candidates: TrainingDiscussionCandidate[];
  applicableCandidates: TrainingDiscussionCandidate[];
  existingFinalResponseIds: Set<number>;
  conflicts: ProductiveJobConflict[];
}

interface BuildApplyContextOptions {
  manager?: EntityManager;
  lockProductiveJobConflicts?: boolean;
}

@Injectable()
export class CoderTrainingResultsApplyService {
  private readonly logger = new Logger(CoderTrainingResultsApplyService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    private coderTrainingService: CoderTrainingService,
    private codingStatisticsService: CodingStatisticsService,
    private codingValidationService: CodingValidationService,
    private codingAnalysisService: CodingAnalysisService,
    private codingFreshnessService: CodingFreshnessService,
    private workspaceExclusionService: WorkspaceExclusionService
  ) { }

  async previewTrainingDiscussionResults(
    workspaceId: number,
    trainingId: number,
    source: TrainingDiscussionApplySource
  ): Promise<TrainingDiscussionApplyPreviewDto> {
    return (await this.buildApplyContext(
      workspaceId,
      trainingId,
      this.validateSource(source)
    )).preview;
  }

  async applyTrainingDiscussionResults(
    workspaceId: number,
    trainingId: number,
    request: ApplyTrainingDiscussionResultsRequestDto
  ): Promise<ApplyTrainingDiscussionResultsResultDto> {
    const source = this.validateSource(request.source);
    const existingResultStrategy = this.validateExistingResultStrategy(
      request.existingResultStrategy
    );
    const jobConflictStrategy = this.validateJobConflictStrategy(
      request.jobConflictStrategy
    );
    const queryRunner =
      this.responseRepository.manager.connection.createQueryRunner();
    let applyResult: ApplyTrainingDiscussionResultsResultDto | null = null;
    let shouldInvalidateIncompleteVariablesCache = false;
    let shouldInvalidateStatisticsAndAnalysis = false;

    await queryRunner.connect();
    await queryRunner.startTransaction('READ COMMITTED');

    try {
      await lockWorkspaceTestResultsMutationInTransaction(
        queryRunner.manager,
        workspaceId
      );

      const context = await this.buildApplyContext(
        workspaceId,
        trainingId,
        source,
        {
          manager: queryRunner.manager,
          lockProductiveJobConflicts: true
        }
      );

      if (!context.preview.canApply) {
        await queryRunner.rollbackTransaction();
        return {
          ...context.preview,
          success: false,
          updatedResponsesCount: 0,
          skippedExistingResultsCount: 0,
          overwrittenExistingResultsCount: 0,
          skippedJobConflictCount: 0,
          skippedMissingScoreCount: context.preview.missingScoreCount,
          removedJobUnitCount: 0,
          messageKey: 'coding.trainings.apply.error.freshness'
        };
      }

      const conflictsByResponseId = this.groupConflictsByResponseId(
        context.conflicts
      );
      const responseIdsToSkip = new Set<number>();
      let skippedExistingResultsCount = 0;
      let overwrittenExistingResultsCount = 0;
      let skippedJobConflictCount = 0;
      let removedJobUnitCount = 0;

      if (existingResultStrategy === 'skip') {
        context.existingFinalResponseIds.forEach(responseId => {
          responseIdsToSkip.add(responseId);
          skippedExistingResultsCount += 1;
        });
      }

      if (jobConflictStrategy === 'skip') {
        conflictsByResponseId.forEach((_, responseId) => {
          responseIdsToSkip.add(responseId);
          skippedJobConflictCount += 1;
        });
      } else {
        const blockingResponseIds = new Set(
          context.conflicts
            .filter(conflict => conflict.hasCodingWork)
            .map(conflict => conflict.responseId)
        );
        const removableJobUnitIds = context.conflicts
          .filter(conflict => (
            !conflict.hasCodingWork &&
            !blockingResponseIds.has(conflict.responseId)
          ))
          .map(conflict => conflict.jobUnitId);

        blockingResponseIds.forEach(responseId => {
          responseIdsToSkip.add(responseId);
          skippedJobConflictCount += 1;
        });

        if (removableJobUnitIds.length > 0) {
          const removedJobUnitIds = await this.deleteUntouchedProductiveJobUnits(
            queryRunner.manager,
            workspaceId,
            removableJobUnitIds
          );
          if (removedJobUnitIds.length !== removableJobUnitIds.length) {
            throw new BadRequestException(
              'Coding job conflicts changed while applying training discussion results. Please refresh the preview.'
            );
          }
          removedJobUnitCount = removedJobUnitIds.length;

          const removedJobUnitIdSet = new Set(removedJobUnitIds);
          const affectedJobIdsForRemovedUnits = Array.from(new Set(
            context.conflicts
              .filter(conflict => removedJobUnitIdSet.has(conflict.jobUnitId))
              .map(conflict => conflict.jobId)
          ));
          await this.recalculateProductiveJobStatusesAfterUnitRemoval(
            workspaceId,
            affectedJobIdsForRemovedUnits,
            queryRunner.manager
          );
        }
      }

      const updates = context.applicableCandidates
        .filter(candidate => !responseIdsToSkip.has(candidate.responseId));
      overwrittenExistingResultsCount = existingResultStrategy === 'overwrite' ?
        updates.filter(update => context.existingFinalResponseIds.has(update.responseId)).length :
        0;

      for (const update of updates) {
        await queryRunner.manager.update(
          ResponseEntity,
          update.responseId,
          {
            code_v2: update.code,
            score_v2: update.score,
            status_v2: this.getCompletedStatus()
          }
        );
      }

      if (updates.length > 0) {
        await this.codingFreshnessService.markManualCodingCurrent(
          workspaceId,
          updates.map(update => update.responseId),
          { manager: queryRunner.manager }
        );
      }

      await queryRunner.commitTransaction();

      shouldInvalidateIncompleteVariablesCache =
        updates.length > 0 || removedJobUnitCount > 0;
      shouldInvalidateStatisticsAndAnalysis = updates.length > 0;

      applyResult = {
        ...context.preview,
        success: true,
        updatedResponsesCount: updates.length,
        skippedExistingResultsCount,
        overwrittenExistingResultsCount,
        skippedJobConflictCount,
        skippedMissingScoreCount: context.preview.missingScoreCount,
        removedJobUnitCount,
        messageKey: 'coding.trainings.apply.success',
        messageParams: {
          updated: updates.length,
          skippedExisting: skippedExistingResultsCount,
          overwrittenExisting: overwrittenExistingResultsCount,
          skippedJobConflicts: skippedJobConflictCount,
          removedJobUnits: removedJobUnitCount
        }
      };
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      this.logger.error(
        `Error applying training discussion results: ${error.message}`,
        error.stack
      );
      throw error;
    } finally {
      await queryRunner.release();
    }

    if (!applyResult) {
      throw new Error('Training discussion results apply finished without a result.');
    }

    if (shouldInvalidateIncompleteVariablesCache) {
      await this.codingValidationService.invalidateIncompleteVariablesCache(
        workspaceId
      );
    }
    if (shouldInvalidateStatisticsAndAnalysis) {
      await this.codingStatisticsService.invalidateCache(workspaceId);
      await this.codingAnalysisService.invalidateCache(workspaceId);
    }

    this.logger.log(
      `Applied ${applyResult.updatedResponsesCount} ${source} training discussion results for training ${trainingId} in workspace ${workspaceId}`
    );

    return applyResult;
  }

  private async buildApplyContext(
    workspaceId: number,
    trainingId: number,
    source: TrainingDiscussionApplySource,
    options: BuildApplyContextOptions = {}
  ): Promise<ApplyContext> {
    const rows = await this.coderTrainingService.getWithinTrainingCodingComparison(
      workspaceId,
      trainingId
    );
    const candidates = rows
      .filter(row => row.discussionSource === source)
      .map(row => ({
        responseId: row.responseId,
        unitName: row.unitName,
        variableId: row.variableId,
        code: row.discussionCode,
        score: row.discussionScore
      }));
    const applicableCandidates = candidates.filter(candidate => (
      candidate.code !== null &&
      candidate.code !== undefined &&
      candidate.score !== null &&
      candidate.score !== undefined
    ));
    const applicableResponseIds = applicableCandidates.map(candidate => (
      candidate.responseId
    ));
    const [
      existingFinalResponseIds,
      conflicts,
      staleTrainingJobCount
    ] = await Promise.all([
      this.getExistingFinalResponseIds(applicableResponseIds, options.manager),
      this.getProductiveJobConflicts(
        workspaceId,
        applicableResponseIds,
        options.manager,
        options.lockProductiveJobConflicts === true
      ),
      this.getStaleTrainingJobCount(workspaceId, trainingId, options.manager)
    ]);
    const affectedJobIds = Array.from(new Set(
      conflicts.map(conflict => conflict.jobId)
    )).sort((a, b) => a - b);
    const affectedJobDefinitionIds = Array.from(new Set(
      conflicts
        .map(conflict => conflict.jobDefinitionId)
        .filter((id): id is number => id !== null && id !== undefined)
    )).sort((a, b) => a - b);
    const approvedJobDefinitionConflictCount = new Set(
      conflicts
        .filter(conflict => conflict.jobDefinitionStatus === 'approved')
        .map(conflict => conflict.jobDefinitionId)
        .filter((id): id is number => id !== null && id !== undefined)
    ).size;
    const blockingResponseIds = new Set(
      conflicts
        .filter(conflict => conflict.hasCodingWork)
        .map(conflict => conflict.responseId)
    );
    const blockingProductiveJobUnitCount = conflicts
      .filter(conflict => conflict.hasCodingWork)
      .length;
    const removableProductiveJobUnitCount = conflicts
      .filter(conflict => (
        !conflict.hasCodingWork &&
        !blockingResponseIds.has(conflict.responseId)
      ))
      .length;
    const canApply = staleTrainingJobCount === 0;

    return {
      candidates,
      applicableCandidates,
      existingFinalResponseIds,
      conflicts,
      preview: {
        trainingId,
        source,
        totalTrainingResponses: rows.length,
        sourceResultsCount: candidates.length,
        applicableResultsCount: applicableCandidates.length,
        missingResultsCount: rows.length - candidates.length,
        missingScoreCount: candidates.length - applicableCandidates.length,
        existingFinalResultsCount: existingFinalResponseIds.size,
        productiveJobConflictCount: new Set(
          conflicts.map(conflict => conflict.responseId)
        ).size,
        removableProductiveJobUnitCount,
        blockingProductiveJobUnitCount,
        approvedJobDefinitionConflictCount,
        staleTrainingJobCount,
        affectedJobIds,
        affectedJobDefinitionIds,
        canApply,
        ...(canApply ? {} : {
          blockingReason: 'freshness-stale'
        })
      }
    };
  }

  private async getExistingFinalResponseIds(
    responseIds: number[],
    manager?: EntityManager
  ): Promise<Set<number>> {
    if (responseIds.length === 0) {
      return new Set();
    }

    const repository = manager ?
      manager.getRepository(ResponseEntity) :
      this.responseRepository;
    const rows = await repository
      .createQueryBuilder('response')
      .select('response.id', 'id')
      .where('response.id IN (:...responseIds)', { responseIds })
      .andWhere('response.status_v2 = :completedStatus', {
        completedStatus: this.getCompletedStatus()
      })
      .getRawMany<{ id: number | string }>();

    return new Set(rows.map(row => Number(row.id)));
  }

  private async getProductiveJobConflicts(
    workspaceId: number,
    responseIds: number[],
    manager?: EntityManager,
    lockRows = false
  ): Promise<ProductiveJobConflict[]> {
    if (responseIds.length === 0) {
      return [];
    }

    const rows = await (manager ?? this.responseRepository.manager).query(
      `
        SELECT
          cju.id as "jobUnitId",
          cju.response_id as "responseId",
          cj.id as "jobId",
          cj.status as "jobStatus",
          cj.job_definition_id as "jobDefinitionId",
          jd.status as "jobDefinitionStatus",
          (
            cj.status IN ('review', 'results_applied') OR
            cju.code IS NOT NULL OR
            cju.score IS NOT NULL OR
            cju.is_open = true OR
            cju.notes IS NOT NULL OR
            cju.supervisor_comment IS NOT NULL OR
            cju.coding_issue_option IS NOT NULL
          ) as "hasCodingWork"
        FROM coding_job_unit cju
        INNER JOIN coding_job cj ON cj.id = cju.coding_job_id
        LEFT JOIN job_definitions jd ON jd.id = cj.job_definition_id
        WHERE cj.workspace_id = $1
          AND cju.response_id = ANY($2::int[])
          AND cj.training_id IS NULL
          AND ${getNonCodingIssueReviewJobSqlCondition('cj')}
        ${lockRows ? 'FOR UPDATE OF cju, cj' : ''}
      `,
      [workspaceId, responseIds]
    );

    return rows.map(row => ({
      jobUnitId: Number(row.jobUnitId),
      responseId: Number(row.responseId),
      jobId: Number(row.jobId),
      jobDefinitionId: row.jobDefinitionId === null ||
        row.jobDefinitionId === undefined ? null : Number(row.jobDefinitionId),
      jobDefinitionStatus: row.jobDefinitionStatus ?? null,
      jobStatus: row.jobStatus ?? null,
      hasCodingWork: this.isImmutableCodingJobStatus(row.jobStatus) ||
        row.hasCodingWork === true ||
        row.hasCodingWork === 'true' ||
        row.hasCodingWork === 1
    }));
  }

  private async deleteUntouchedProductiveJobUnits(
    manager: EntityManager,
    workspaceId: number,
    jobUnitIds: number[]
  ): Promise<number[]> {
    if (jobUnitIds.length === 0) {
      return [];
    }

    const rows = await manager.query(
      `
        DELETE FROM coding_job_unit cju
        USING coding_job cj
        WHERE cju.id = ANY($1::int[])
          AND cj.id = cju.coding_job_id
          AND cj.workspace_id = $2
          AND cj.training_id IS NULL
          AND cj.status NOT IN ('review', 'results_applied')
          AND ${getNonCodingIssueReviewJobSqlCondition('cj')}
          AND cju.code IS NULL
          AND cju.score IS NULL
          AND COALESCE(cju.is_open, false) = false
          AND cju.notes IS NULL
          AND cju.supervisor_comment IS NULL
          AND cju.coding_issue_option IS NULL
        RETURNING cju.id
      `,
      [jobUnitIds, workspaceId]
    );

    return rows.map((row: { id: number | string }) => Number(row.id));
  }

  private async recalculateProductiveJobStatusesAfterUnitRemoval(
    workspaceId: number,
    jobIds: number[],
    manager: EntityManager
  ): Promise<void> {
    const ids = Array.from(new Set(
      jobIds.filter(jobId => Number.isInteger(jobId) && jobId > 0)
    ));
    if (ids.length === 0) {
      return;
    }

    const exclusions = await this.workspaceExclusionService
      .resolveExclusionsForQueries(workspaceId);
    const exclusionJoin = this.buildCodingJobUnitExclusionJoinSql(
      exclusions,
      3
    );

    await manager.query(
      `
        WITH progress AS (
          SELECT
            cj.id AS "jobId",
            COUNT(cju.id)::int AS "total",
            COUNT(cju.id) FILTER (WHERE cju.code IS NOT NULL)::int AS "coded",
            COUNT(cju.id) FILTER (WHERE cju.is_open = true)::int AS "open"
          FROM coding_job cj
          LEFT JOIN coding_job_unit cju ON cju.coding_job_id = cj.id
            ${exclusionJoin.sql}
          WHERE cj.workspace_id = $1
            AND cj.id = ANY($2::int[])
            AND cj.training_id IS NULL
            AND ${getNonCodingIssueReviewJobSqlCondition('cj')}
          GROUP BY cj.id
        )
        UPDATE coding_job cj
        SET status = CASE
              WHEN progress."total" = 0 THEN 'pending'
              WHEN progress."coded" + progress."open" >= progress."total" AND progress."open" > 0 THEN 'open'
              WHEN progress."coded" + progress."open" >= progress."total" THEN 'completed'
              WHEN cj.status IN ('completed', 'open') THEN 'active'
              ELSE cj.status
            END,
            updated_at = now()
        FROM progress
        WHERE cj.id = progress."jobId"
          AND cj.status NOT IN ('review', 'results_applied')
          AND cj.status IS DISTINCT FROM CASE
              WHEN progress."total" = 0 THEN 'pending'
              WHEN progress."coded" + progress."open" >= progress."total" AND progress."open" > 0 THEN 'open'
              WHEN progress."coded" + progress."open" >= progress."total" THEN 'completed'
              WHEN cj.status IN ('completed', 'open') THEN 'active'
              ELSE cj.status
            END
      `,
      [workspaceId, ids, ...exclusionJoin.params]
    );
  }

  private buildCodingJobUnitExclusionJoinSql(
    exclusions: ResolvedWorkspaceExclusions,
    startParameterIndex: number
  ): { sql: string; params: string[] } {
    const clauses: string[] = [];
    const params: string[] = [];
    let parameterIndex = startParameterIndex;
    const unitExpression =
      "REGEXP_REPLACE(UPPER(cju.unit_name), '\\.XML$', '', 'i')";

    const addParameter = (value: string): string => {
      params.push(value);
      const placeholder = `$${parameterIndex}`;
      parameterIndex += 1;
      return placeholder;
    };
    const addInClauseParameters = (values: string[]): string => (
      values.map(value => addParameter(value)).join(', ')
    );

    const ignoredUnits = exclusions.globalIgnoredUnits
      .map(normalizeExclusionUnitId)
      .filter(unitId => unitId.length > 0);
    if (ignoredUnits.length > 0) {
      clauses.push(
        `${unitExpression} NOT IN (${addInClauseParameters(ignoredUnits)})`
      );
    }

    const ignoredBooklets = exclusions.ignoredBooklets
      .map(normalizeExclusionBookletId)
      .filter(bookletId => bookletId.length > 0);
    if (ignoredBooklets.length > 0) {
      clauses.push(
        `UPPER(cju.booklet_name) NOT IN (${addInClauseParameters(ignoredBooklets)})`
      );
    }

    const ignoredTestletUnits = exclusions.testletIgnoredUnits
      .map(testletUnit => ({
        bookletId: normalizeExclusionBookletId(testletUnit.bookletId),
        unitId: normalizeExclusionUnitId(testletUnit.unitId)
      }))
      .filter(testletUnit => (
        testletUnit.bookletId.length > 0 &&
        testletUnit.unitId.length > 0
      ));
    if (ignoredTestletUnits.length > 0) {
      const ignoredPairConditions = ignoredTestletUnits.map(testletUnit => (
        `(
          UPPER(cju.booklet_name) = ${addParameter(testletUnit.bookletId)}
          AND ${unitExpression} = ${addParameter(testletUnit.unitId)}
        )`
      ));
      clauses.push(`NOT (${ignoredPairConditions.join(' OR ')})`);
    }

    return {
      sql: clauses.length > 0 ?
        `AND ${clauses.join('\n            AND ')}` :
        '',
      params
    };
  }

  private async getStaleTrainingJobCount(
    workspaceId: number,
    trainingId: number,
    manager?: EntityManager
  ): Promise<number> {
    const rows = await (manager ?? this.responseRepository.manager).query(
      `
        SELECT COUNT(*) as "count"
        FROM coding_job
        WHERE workspace_id = $1
          AND training_id = $2
          AND freshness_status = 'stale_source'
      `,
      [workspaceId, trainingId]
    );

    return Number(rows[0]?.count || 0);
  }

  private groupConflictsByResponseId(
    conflicts: ProductiveJobConflict[]
  ): Map<number, ProductiveJobConflict[]> {
    const grouped = new Map<number, ProductiveJobConflict[]>();
    conflicts.forEach(conflict => {
      const current = grouped.get(conflict.responseId) || [];
      current.push(conflict);
      grouped.set(conflict.responseId, current);
    });
    return grouped;
  }

  private validateSource(
    source: TrainingDiscussionApplySource
  ): TrainingDiscussionApplySource {
    if (source === 'manual' || source === 'auto_agreement') {
      return source;
    }
    throw new BadRequestException('A valid training discussion result source is required.');
  }

  private validateExistingResultStrategy(
    strategy?: TrainingDiscussionExistingResultStrategy
  ): TrainingDiscussionExistingResultStrategy {
    if (!strategy) {
      return 'skip';
    }
    if (strategy === 'skip' || strategy === 'overwrite') {
      return strategy;
    }
    throw new BadRequestException('Invalid existing result strategy.');
  }

  private validateJobConflictStrategy(
    strategy?: TrainingDiscussionJobConflictStrategy
  ): TrainingDiscussionJobConflictStrategy {
    if (!strategy) {
      return 'skip';
    }
    if (strategy === 'skip' || strategy === 'removeFromJobs') {
      return strategy;
    }
    throw new BadRequestException('Invalid job conflict strategy.');
  }

  private isImmutableCodingJobStatus(status: unknown): boolean {
    return status === 'review' || status === 'results_applied';
  }

  private getCompletedStatus(): number {
    const completedStatus = statusStringToNumber('CODING_COMPLETE');
    if (completedStatus === null) {
      throw new Error('Unknown CODING_COMPLETE response status');
    }
    return completedStatus;
  }
}
