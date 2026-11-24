import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Brackets,
  EntityManager,
  In,
  QueryRunner,
  Repository,
  SelectQueryBuilder
} from 'typeorm';
import { getErrorMessage, getErrorStack } from '../../../utils/error.util';
import { jobProgressKey } from '../../../../../../../api-dto/coding/coding-progress-key';
import { JournalService } from '../shared/journal.service';
import { readEntityBatchesById } from '../shared/postgres-query-batches.util';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES } from '../../utils/manual-coding-candidate.util';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJobService, ResponseMatchingFlag } from './coding-job.service';
import { CodingStatisticsService } from './coding-statistics.service';
import { CodingAnalysisService } from './coding-analysis.service';
import {
  buildAggregationGroups,
  getAggregationVariableKey,
  toAggregationCandidate
} from './aggregation-metrics.util';
import { CodingFreshnessService } from './coding-freshness.service';
import {
  lockWorkspaceTestResultsMutationInTransaction,
  withWorkspaceTestResultsMutationPoolSlot,
  withWorkspaceTestResultsMutationLock
} from '../shared/workspace-test-results-lock.util';
import { CodingValidationService } from './coding-validation.service';
import { MissingsProfilesService } from './missings-profiles.service';
import { getNonCodingIssueReviewJobSqlCondition } from './coding-job-type.util';
import { addEmptyResponseCandidateValueConditions, EmptyResponseSelectionService } from './empty-response-selection.service';
import { uncodedV2Criteria } from './response-v2-coding.util';
import {
  applyResolvedExclusionsToQuery,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';

export interface ApplyCodingResultsOptions {
  overwriteExisting?: boolean;
  actorUserId?: number;
}

export interface ApplyCodingResultsResult {
  success: boolean;
  updatedResponsesCount: number;
  skippedReviewCount: number;
  skippedAlreadyCodedCount: number;
  overwrittenExistingCount: number;
  messageKey: string;
  messageParams?: Record<string, unknown>;
}

interface ExistingV2State {
  status: number | null;
  code: number | null;
  score: number | null;
}

interface PendingResponseUpdate {
  responseId: number;
  code_v2: number | null;
  score_v2: number | null;
  status_v2: number;
  protectExistingV2?: boolean;
}

export const buildAggregationUnitNameQuery = (
  responseRepository: Repository<ResponseEntity>,
  workspaceId: number,
  codedVariableIds: string[]
): SelectQueryBuilder<ResponseEntity> => responseRepository
  .createQueryBuilder('response')
  .distinct(true)
  .select('unit.name', 'unitName')
  .addSelect('response.variableid', 'variableId')
  .leftJoin('response.unit', 'unit')
  .leftJoin('unit.booklet', 'booklet')
  .leftJoin('booklet.bookletinfo', 'bookletinfo')
  .leftJoin('booklet.person', 'person')
  .where('person.workspace_id = :workspaceId', { workspaceId })
  .andWhere('person.consider = :consider', { consider: true })
  .andWhere('response.status_v1 IN (:...statuses)', {
    statuses: [
      statusStringToNumber('CODING_INCOMPLETE'),
      statusStringToNumber('INTENDED_INCOMPLETE')
    ]
  })
  .andWhere('response.variableid IN (:...codedVariableIds)', {
    codedVariableIds
  });

@Injectable()
export class CodingResultsService {
  private readonly logger = new Logger(CodingResultsService.name);
  private readonly manualMissingIdsByIssueOptionId = new Map<number, string>([
    [-3, 'mir'],
    [-4, 'mci']
  ]);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    private codingStatisticsService: CodingStatisticsService,
    private codingJobService: CodingJobService,
    private codingValidationService: CodingValidationService,
    private codingAnalysisService: CodingAnalysisService,
    private missingsProfilesService: MissingsProfilesService,
    private emptyResponseSelectionService: EmptyResponseSelectionService,
    private workspaceExclusionService: WorkspaceExclusionService,
    @Optional()
    private codingFreshnessService?: CodingFreshnessService
  ) { }

  async applyCodingResults(
    workspaceId: number,
    codingJobId: number,
    options: ApplyCodingResultsOptions = {}
  ): Promise<ApplyCodingResultsResult> {
    return withWorkspaceTestResultsMutationPoolSlot(this.responseRepository.manager.connection,
      () => this.applyCodingResultsInPool(workspaceId, codingJobId, options));
  }

  private async applyCodingResultsInPool(
    workspaceId: number,
    codingJobId: number,
    options: ApplyCodingResultsOptions
  ): Promise<ApplyCodingResultsResult> {
    this.logger.log(`Applying coding results for coding job ${codingJobId} in workspace ${workspaceId}`);
    const overwriteExisting = options.overwriteExisting === true;
    const completedStatus = statusStringToNumber('CODING_COMPLETE');

    // Check if coding job is completed before allowing application
    const codingJob = await this.codingJobService.getCodingJobById(codingJobId);
    const initialFreshnessBlocker = this.getFreshnessApplyBlocker(codingJob);
    if (initialFreshnessBlocker) {
      return initialFreshnessBlocker;
    }

    if (codingJob.training_id !== null && codingJob.training_id !== undefined) {
      return {
        success: false,
        updatedResponsesCount: 0,
        skippedReviewCount: 0,
        skippedAlreadyCodedCount: 0,
        overwrittenExistingCount: 0,
        messageKey: 'coding-results.apply.error.training-job',
        messageParams: { jobId: codingJobId }
      };
    }

    if (!['completed', 'review'].includes(codingJob.status)) {
      return {
        success: false,
        updatedResponsesCount: 0,
        skippedReviewCount: 0,
        skippedAlreadyCodedCount: 0,
        overwrittenExistingCount: 0,
        messageKey: 'coding-results.apply.error.not-completed',
        messageParams: { status: codingJob.status }
      };
    }

    const responsesToUpdate: PendingResponseUpdate[] = [];

    try {
      const codingJobUnits = await this.codingJobService.getCodingJobUnits(codingJobId);
      const codingProgress = await this.codingJobService.getCodingProgress(codingJobId);
      const directResponseIds = Array.from(new Set(codingJobUnits.map(unit => unit.responseId)));
      const existingV2StateByResponseId = await this.getExistingV2StateByResponseId(directResponseIds);
      const resolvedIssueReviewResponseIds = new Set(
        await this.codingJobService.getResolvedCodingIssueReviewResponseIds(codingJobId)
      );
      const openIssueReviewResponseIds = new Set(
        await this.codingJobService.getOpenCodingIssueReviewResponseIds(codingJobId)
      );
      const unitRequiresIssueReview = (unit: typeof codingJobUnits[number]) => (
        openIssueReviewResponseIds.has(unit.responseId) ||
        this.requiresCodingIssueReview(codingProgress[jobProgressKey(unit)])
      );
      const reviewResponseIds = new Set(codingJobUnits
        .filter(unitRequiresIssueReview)
        .map(unit => unit.responseId));
      const conflictCheckResponseIds = directResponseIds.filter(responseId => (
        !reviewResponseIds.has(responseId) &&
        !resolvedIssueReviewResponseIds.has(responseId)
      ));

      const doubleCodingConflicts = await this.getDoubleCodingConflicts(
        workspaceId,
        codingJob,
        conflictCheckResponseIds
      );
      const blockingDoubleCodingConflicts = doubleCodingConflicts.filter(conflict => (
        conflict.statusV2 !== completedStatus || overwriteExisting
      ));

      if (blockingDoubleCodingConflicts.length > 0) {
        return {
          success: false,
          updatedResponsesCount: 0,
          skippedReviewCount: 0,
          skippedAlreadyCodedCount: 0,
          overwrittenExistingCount: 0,
          messageKey: 'coding-results.apply.error.double-coding-conflicts-present',
          messageParams: { count: blockingDoubleCodingConflicts.length }
        };
      }

      let skippedReviewCount = 0;
      let skippedAlreadyCodedCount = 0;
      let overwrittenExistingCount = 0;

      for (const unit of codingJobUnits) {
        const progressKey = jobProgressKey(unit);
        const progress = codingProgress[progressKey];

        if (unitRequiresIssueReview(unit)) {
          skippedReviewCount += 1;
          continue;
        }

        const existingV2State = existingV2StateByResponseId.get(unit.responseId);
        if (this.hasExistingV2Value(existingV2State)) {
          if (!overwriteExisting) {
            skippedAlreadyCodedCount += 1;
            continue;
          }
          overwrittenExistingCount += 1;
        }

        if (!progress || (progress.id === undefined && progress.score === undefined)) {
          responsesToUpdate.push({
            responseId: unit.responseId,
            code_v2: null,
            score_v2: null,
            status_v2: statusStringToNumber('CODING_INCOMPLETE')
          });
        } else if (typeof progress.id === 'number') {
          let status = statusStringToNumber('CODING_COMPLETE');
          let code = null;
          let score = progress.score !== undefined ? progress.score : null;

          if (this.manualMissingIdsByIssueOptionId.has(progress.id)) {
            const missingId = this.manualMissingIdsByIssueOptionId.get(progress.id) as string;
            const missing = await this.missingsProfilesService.getMissingByIdForProfileOrDefault(
              workspaceId,
              codingJob.missings_profile_id,
              missingId
            );
            code = missing.code;
            score = missing.score;
          } else if (progress.id < 0) {
            const missing = await this.missingsProfilesService.getMissingByCodeForProfileOrDefault(
              workspaceId,
              codingJob.missings_profile_id,
              progress.id
            );
            code = missing.code;
            score = missing.score;
          } else if (progress.id >= 0) {
            code = progress.id;
          }

          if (status === statusStringToNumber('CODING_COMPLETE') && (code === null || code === undefined)) {
            status = statusStringToNumber('CODING_INCOMPLETE');
          }

          responsesToUpdate.push({
            responseId: unit.responseId,
            code_v2: code,
            score_v2: score,
            status_v2: status
          });
        } else {
          responsesToUpdate.push({
            responseId: unit.responseId,
            code_v2: null,
            score_v2: progress.score !== undefined ? progress.score : null,
            status_v2: statusStringToNumber('CODING_COMPLETE')
          });
        }
      }

      this.logger.log(`Prepared ${responsesToUpdate.length} responses for update, skipped ${skippedReviewCount} requiring review`);
      // If aggregation is active, find all uncoded responses that share the same normalized value
      // as a successfully coded response in this job, and apply the same result to them.
      const aggregationSettings = await this.codingJobService.getAggregationSettingsForCodingJob(codingJob);
      const aggregationThreshold = aggregationSettings.aggregationThreshold;
      if (aggregationSettings.aggregationEnabled && aggregationThreshold !== null) {
        const matchingFlags = aggregationSettings.responseMatchingFlags;
        if (matchingFlags.includes(ResponseMatchingFlag.NO_AGGREGATION)) {
          this.logger.log('Skipping group sibling propagation because response aggregation is disabled.');
        } else {
          const derivedVariableMap = await this.codingJobService.getDerivedVariableMapForAggregation(workspaceId);
          // Collect the response IDs that are already being updated (avoid double-adding)
          const alreadyUpdatedIds = new Set([
            ...responsesToUpdate.map(r => r.responseId),
            ...reviewResponseIds
          ]);

          // Only propagate results for CODING_COMPLETE responses with a real code
          const completedUpdates = responsesToUpdate.filter(
            r => r.status_v2 === statusStringToNumber('CODING_COMPLETE') && r.code_v2 !== null
          );
          const codedResponseIds = completedUpdates.map(r => r.responseId);
          if (codedResponseIds.length > 0) {
            const codedResponses = await this.responseRepository
              .createQueryBuilder('response')
              .leftJoinAndSelect('response.unit', 'unit')
              .leftJoin('unit.booklet', 'booklet')
              .leftJoin('booklet.person', 'person')
              .select([
                'response.id',
                'response.value',
                'response.variableid',
                'response.status_v2',
                'unit.id',
                'unit.name'
              ])
              .where('response.id IN (:...ids)', { ids: codedResponseIds })
              .getMany();

            const codedVariableIds = Array.from(new Set(
              codedResponses
                .map(response => response.variableid)
                .filter((variableId): variableId is string => Boolean(variableId))
            ));
            const unitNamesByVariable = new Map<string, Set<string>>();
            codedResponses.forEach(response => {
              if (!response.unit?.name || !response.variableid) {
                return;
              }
              const variableKey = getAggregationVariableKey(
                response.unit.name,
                response.variableid
              );
              const unitNames = unitNamesByVariable.get(variableKey) || new Set<string>();
              unitNames.add(response.unit.name);
              unitNamesByVariable.set(variableKey, unitNames);
            });

            const exclusions = await this.workspaceExclusionService
              .resolveExclusionsForQueries(workspaceId);
            if (codedVariableIds.length > 0) {
              const unitNameQuery = buildAggregationUnitNameQuery(
                this.responseRepository,
                workspaceId,
                codedVariableIds
              );
              applyResolvedExclusionsToQuery(unitNameQuery, exclusions, {
                parameterPrefix: 'aggregationSiblingUnits'
              });
              const unitNameRows: Array<{
                unitName: string;
                variableId: string;
              }> = await unitNameQuery.getRawMany();
              unitNameRows.forEach(row => {
                const variableKey = getAggregationVariableKey(
                  row.unitName,
                  row.variableId
                );
                if (!unitNamesByVariable.has(variableKey)) {
                  return;
                }
                unitNamesByVariable.get(variableKey)?.add(row.unitName);
              });
            }

            for (const codedResponse of codedResponses) {
              const update = completedUpdates.find(u => u.responseId === codedResponse.id);
              if (!update) continue;

              const unitName = codedResponse.unit?.name;
              const variableId = codedResponse.variableid;

              if (!unitName || !variableId) continue;

              const unitNames = Array.from(
                unitNamesByVariable.get(getAggregationVariableKey(
                  unitName,
                  variableId
                )) || [unitName]
              );

              // Find all sibling responses for the same workspace + unit + variable.
              // Existing v2 codings are either reported as skipped or overwritten only when explicitly requested.
              const candidateQuery = this.responseRepository
                .createQueryBuilder('response')
                .leftJoinAndSelect('response.unit', 'unit')
                .leftJoin('unit.booklet', 'booklet')
                .leftJoin('booklet.bookletinfo', 'bookletinfo')
                .leftJoin('booklet.person', 'person')
                .select([
                  'response.id',
                  'response.value',
                  'response.status',
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
                .andWhere('unit.name IN (:...unitNames)', { unitNames })
                .andWhere('response.variableid = :variableId', { variableId });
              applyResolvedExclusionsToQuery(candidateQuery, exclusions, {
                parameterPrefix: 'aggregationSiblingCandidates'
              });
              const candidates = await candidateQuery.getMany();

              const groups = buildAggregationGroups(
                candidates.map(candidate => toAggregationCandidate(candidate, unitName, variableId)),
                matchingFlags,
                aggregationThreshold,
                derivedVariableMap
              );
              const aggregationGroup = groups.find(group => (
                group.responses.some(candidate => candidate.responseId === codedResponse.id)
              ));

              if (!aggregationGroup || aggregationGroup.responses.length < aggregationThreshold) {
                continue;
              }

              for (const candidate of aggregationGroup.responses) {
                if (candidate.responseId === codedResponse.id || alreadyUpdatedIds.has(candidate.responseId)) continue;

                if (this.hasExistingV2Value({
                  status: candidate.statusV2 ?? null,
                  code: candidate.codeV2 ?? null,
                  score: candidate.scoreV2 ?? null
                })) {
                  if (!overwriteExisting) {
                    skippedAlreadyCodedCount += 1;
                    alreadyUpdatedIds.add(candidate.responseId);
                    continue;
                  }
                  overwrittenExistingCount += 1;
                }

                responsesToUpdate.push({
                  responseId: candidate.responseId,
                  code_v2: update.code_v2,
                  score_v2: update.score_v2,
                  status_v2: update.status_v2,
                  protectExistingV2: !overwriteExisting
                });
                alreadyUpdatedIds.add(candidate.responseId);
              }
            }

            this.logger.log(`Group sibling propagation complete. Total responses to update: ${responsesToUpdate.length}`);
          }
        }
      }

      if (responsesToUpdate.length === 0) {
        if (skippedReviewCount === 0) {
          const queryRunner = this.responseRepository.manager.connection.createQueryRunner();
          await queryRunner.connect();
          await queryRunner.startTransaction('READ COMMITTED');

          try {
            const freshnessBlocker = await this.getFreshnessApplyBlockerInTransaction(
              workspaceId,
              codingJobId,
              queryRunner.manager
            );
            if (freshnessBlocker) {
              await queryRunner.rollbackTransaction();
              return freshnessBlocker;
            }

            await this.markManualFreshnessCurrent(
              workspaceId,
              directResponseIds,
              codingJobId,
              queryRunner.manager
            );
            await this.codingJobService.markCodingJobResultsApplied(
              codingJobId,
              workspaceId,
              queryRunner.manager
            );
            await this.recordAppliedResults(queryRunner.manager, workspaceId, codingJobId, options, {
              updatedResponsesCount: 0, skippedReviewCount, skippedAlreadyCodedCount, overwrittenExistingCount
            });
            await queryRunner.commitTransaction();
          } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error(`Error finalizing coding results: ${getErrorMessage(error)}`, getErrorStack(error));
            throw new Error(`Fehler beim Anwenden der Kodierungsergebnisse: ${getErrorMessage(error)}`);
          } finally {
            await queryRunner.release();
          }

          await this.invalidateIncompleteVariablesCache(workspaceId);
          await this.codingStatisticsService.invalidateCache(workspaceId);
          await this.codingAnalysisService.invalidateCache(workspaceId);
        }

        return {
          success: true,
          updatedResponsesCount: 0,
          skippedReviewCount,
          skippedAlreadyCodedCount,
          overwrittenExistingCount,
          messageKey: 'coding-results.apply.success.no-responses'
        };
      }

      const queryRunner = this.responseRepository.manager.connection.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction('READ COMMITTED');

      try {
        const freshnessBlocker = await this.getFreshnessApplyBlockerInTransaction(
          workspaceId,
          codingJobId,
          queryRunner.manager
        );
        if (freshnessBlocker) {
          await queryRunner.rollbackTransaction();
          return freshnessBlocker;
        }

        const batchSize = 500;
        let totalUpdated = 0;
        const updatedResponseIds: number[] = [];

        for (let i = 0; i < responsesToUpdate.length; i += batchSize) {
          const batch = responsesToUpdate.slice(i, i + batchSize);

          const updateResults = await Promise.all(batch.map(async responseUpdate => ({
            responseUpdate,
            result: await queryRunner.manager.update(
              ResponseEntity,
              responseUpdate.protectExistingV2 ?
                {
                  id: responseUpdate.responseId,
                  ...uncodedV2Criteria
                } :
                responseUpdate.responseId,
              {
                code_v2: responseUpdate.code_v2,
                score_v2: responseUpdate.score_v2,
                status_v2: responseUpdate.status_v2,
                autocoder_invalidated_version: null
              }
            )
          })));

          const protectedUpdatesSkipped = updateResults.filter(({ responseUpdate, result }) => (
            responseUpdate.protectExistingV2 && result.affected === 0
          )).length;
          skippedAlreadyCodedCount += protectedUpdatesSkipped;

          const updatedBatch = updateResults.filter(({ responseUpdate, result }) => (
            !responseUpdate.protectExistingV2 || result.affected !== 0
          ));
          updatedResponseIds.push(...updatedBatch.map(({ responseUpdate }) => (
            responseUpdate.responseId
          )));
          totalUpdated += updatedBatch.length;

          this.logger.log(`Updated batch of ${updatedBatch.length} responses (${totalUpdated}/${responsesToUpdate.length})`);
        }

        const freshnessResponseIds = skippedReviewCount === 0 ?
          Array.from(new Set([
            ...directResponseIds,
            ...updatedResponseIds
          ])) :
          Array.from(new Set(updatedResponseIds));

        await this.markManualFreshnessCurrent(
          workspaceId,
          freshnessResponseIds,
          codingJobId,
          queryRunner.manager
        );

        if (skippedReviewCount === 0) {
          await this.codingJobService.markCodingJobResultsApplied(
            codingJobId,
            workspaceId,
            queryRunner.manager
          );
        }

        await this.recordAppliedResults(queryRunner.manager, workspaceId, codingJobId, options, {
          updatedResponsesCount: totalUpdated, skippedReviewCount, skippedAlreadyCodedCount, overwrittenExistingCount
        });
        await queryRunner.commitTransaction();

        await this.invalidateIncompleteVariablesCache(workspaceId);
        await this.codingStatisticsService.invalidateCache(workspaceId);
        await this.codingAnalysisService.invalidateCache(workspaceId);

        return {
          success: true,
          updatedResponsesCount: totalUpdated,
          skippedReviewCount,
          skippedAlreadyCodedCount,
          overwrittenExistingCount,
          messageKey: 'coding-results.apply.success.bulk',
          messageParams: {
            count: totalUpdated,
            skipped: skippedReviewCount,
            skippedAlreadyCoded: skippedAlreadyCodedCount,
            overwrittenExisting: overwrittenExistingCount
          }
        };
      } catch (error) {
        await queryRunner.rollbackTransaction();
        this.logger.error(`Error updating responses: ${getErrorMessage(error)}`, getErrorStack(error));
        throw new Error(`Fehler beim Anwenden der Kodierungsergebnisse: ${getErrorMessage(error)}`);
      } finally {
        await queryRunner.release();
      }
    } catch (error) {
      this.logger.error(`Error applying coding results: ${getErrorMessage(error)}`, getErrorStack(error));
      throw new Error(`Fehler beim Anwenden der Kodierungsergebnisse: ${getErrorMessage(error)}`);
    }
  }

  private recordAppliedResults(manager: EntityManager, workspaceId: number, codingJobId: number,
                               options: ApplyCodingResultsOptions, counts: Record<string, number>) {
    return JournalService.recordEventInTransaction(manager, {
      workspaceId,
      actorUserId: options.actorUserId,
      actorType: options.actorUserId ? 'user' : 'system',
      eventType: 'CODING_RESULTS_APPLIED',
      entityType: 'coding-job',
      entityId: codingJobId,
      result: 'success',
      summary: 'Coding results applied',
      details: { ...counts, overwriteExisting: options.overwriteExisting === true }
    });
  }

  private async markManualFreshnessCurrent(
    workspaceId: number,
    responseIds: number[],
    codingJobId: number,
    manager?: EntityManager
  ): Promise<void> {
    if (!this.codingFreshnessService) {
      return;
    }

    await this.codingFreshnessService.markManualCodingCurrent(
      workspaceId,
      responseIds,
      { codingJobId, manager }
    );
  }

  private requiresCodingIssueReview(progress?: { id?: unknown; codingIssueOption?: unknown } | null): boolean {
    return progress?.id === -1 ||
      progress?.id === -2 ||
      progress?.codingIssueOption === -1 ||
      progress?.codingIssueOption === -2;
  }

  private async getFreshnessApplyBlockerInTransaction(
    workspaceId: number,
    codingJobId: number,
    manager: EntityManager
  ): Promise<ApplyCodingResultsResult | null> {
    await lockWorkspaceTestResultsMutationInTransaction(manager, workspaceId);
    const codingJob = await this.codingJobService.getCodingJobByIdForWorkspace(
      codingJobId,
      workspaceId,
      manager
    );
    return this.getFreshnessApplyBlocker(codingJob);
  }

  private getFreshnessApplyBlocker(codingJob: {
    freshness_status?: string | null;
    freshness_affected_units?: number | null;
    freshness_affected_responses?: number | null;
  }): ApplyCodingResultsResult | null {
    if (codingJob.freshness_status !== 'stale_source') {
      return null;
    }

    return {
      success: false,
      updatedResponsesCount: 0,
      skippedReviewCount: 0,
      skippedAlreadyCodedCount: 0,
      overwrittenExistingCount: 0,
      messageKey: 'coding-results.apply.error.freshness-review-required',
      messageParams: {
        status: codingJob.freshness_status,
        affectedUnits: codingJob.freshness_affected_units || 0,
        affectedResponses: codingJob.freshness_affected_responses || 0
      }
    };
  }

  private async invalidateIncompleteVariablesCache(workspaceId: number): Promise<void> {
    await this.codingValidationService.invalidateIncompleteVariablesCache(workspaceId);
    this.logger.log(`Invalidated manual coding variables cache for workspace ${workspaceId}`);
  }

  private hasExistingV2Value(state: ExistingV2State | undefined): boolean {
    return state !== undefined &&
      (
        state.status !== null ||
        state.code !== null ||
        state.score !== null
      );
  }

  private async getExistingV2StateByResponseId(responseIds: number[]): Promise<Map<number, ExistingV2State>> {
    if (responseIds.length === 0) {
      return new Map();
    }

    const rows = await this.responseRepository.manager.query(
      `
        SELECT
          id,
          status_v2 as "statusV2",
          code_v2 as "codeV2",
          score_v2 as "scoreV2"
        FROM response
        WHERE id = ANY($1::int[])
      `,
      [responseIds]
    );

    return new Map(rows.map((row: Record<string, unknown>) => [
      Number(row.id),
      {
        status: row.statusV2 === null || row.statusV2 === undefined ? null : Number(row.statusV2),
        code: row.codeV2 === null || row.codeV2 === undefined ? null : Number(row.codeV2),
        score: row.scoreV2 === null || row.scoreV2 === undefined ? null : Number(row.scoreV2)
      }
    ]));
  }

  private async getDoubleCodingConflicts(
    workspaceId: number,
    codingJob: {
      training_id?: number | null;
      job_definition_id?: number | null;
    },
    responseIds: number[]
  ): Promise<Array<{ responseId: number; statusV2: number | null }>> {
    if (responseIds.length === 0) {
      return [];
    }

    const scopeClauses = ['cj.workspace_id = $1'];
    const params: unknown[] = [workspaceId, responseIds];

    if (codingJob.training_id !== null && codingJob.training_id !== undefined) {
      params.push(codingJob.training_id);
      scopeClauses.push(`cj.training_id = $${params.length}`);
    } else {
      scopeClauses.push('cj.training_id IS NULL');
      scopeClauses.push(getNonCodingIssueReviewJobSqlCondition('cj'));

      if (codingJob.job_definition_id !== null && codingJob.job_definition_id !== undefined) {
        params.push(codingJob.job_definition_id);
        scopeClauses.push(`cj.job_definition_id = $${params.length}`);
      } else {
        scopeClauses.push('cj.job_definition_id IS NULL');
      }
    }

    const rows = await this.responseRepository.manager.query(
      `
        SELECT
          cju.response_id as "responseId",
          MAX(resp.status_v2) as "statusV2"
        FROM coding_job_unit cju
        INNER JOIN coding_job cj ON cj.id = cju.coding_job_id
        INNER JOIN response resp ON resp.id = cju.response_id
        WHERE cju.response_id = ANY($2::int[])
          AND cju.code IS NOT NULL
          AND ${scopeClauses.join(' AND ')}
        GROUP BY cju.response_id
        HAVING COUNT(DISTINCT cju.coding_job_id) > 1
           AND COUNT(cju.code) > 1
           AND COUNT(DISTINCT (
             cju.code::text || ':' || COALESCE(cju.score::text, 'NULL')
           )) > 1
      `,
      params
    );

    return rows.map((row: Record<string, unknown>) => ({
      responseId: Number(row.responseId),
      statusV2: row.statusV2 === null || row.statusV2 === undefined ? null : Number(row.statusV2)
    }));
  }

  /**
   * Apply coding to all empty responses in a workspace
   * Sets status_v2 = CODING_COMPLETE and resolves MIR code/score from the default missings profile.
   * Only updates effectively empty responses without a V2 status.
   */
  async applyEmptyResponseCoding(workspaceId: number): Promise<{
    success: boolean;
    updatedCount: number;
    message: string;
  }> {
    this.logger.log(`Applying empty response coding for workspace ${workspaceId}`);

    try {
      const result = await withWorkspaceTestResultsMutationLock(
        this.responseRepository.manager.connection,
        workspaceId,
        queryRunner => this.applyEmptyResponseCodingLocked(
          workspaceId,
          queryRunner
        )
      );

      if (result.updatedCount > 0) {
        await this.invalidateIncompleteVariablesCache(workspaceId);
        await this.codingStatisticsService.invalidateCache(workspaceId);
        await this.codingAnalysisService.invalidateCache(workspaceId);
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Error applying empty response coding: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      return {
        success: false,
        updatedCount: 0,
        message: `Fehler: ${getErrorMessage(error)}`
      };
    }
  }

  private async applyEmptyResponseCodingLocked(
    workspaceId: number,
    queryRunner: QueryRunner
  ): Promise<{
    success: boolean;
    updatedCount: number;
    message: string;
  }> {
    await queryRunner.startTransaction('READ COMMITTED');

    try {
      const responseRepository =
        queryRunner.manager.getRepository(ResponseEntity);
      const emptyResponseContext =
        await this.emptyResponseSelectionService.createContext(
          workspaceId,
          queryRunner.manager
        );

      const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId, queryRunner.manager);
      const emptyResponseCandidateQuery = responseRepository
        .createQueryBuilder('response')
        .innerJoin('response.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.bookletinfo', 'bookletinfo')
        .innerJoin('booklet.person', 'person')
        .select(['response.id', 'response.unitid', 'response.variableid', 'response.subform', 'response.status',
          'response.status_v1', 'response.value', 'unit.id', 'unit.name'])
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere('response.status_v1 IN (:...statuses)', {
          statuses: MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES
        })
        .andWhere(uncodedV2Criteria);
      applyResolvedExclusionsToQuery(emptyResponseCandidateQuery, exclusions);

      emptyResponseCandidateQuery.andWhere(new Brackets(candidateQuery => {
        addEmptyResponseCandidateValueConditions(candidateQuery, emptyResponseContext.derivedVariableMap);
      }));

      let totalUpdated = 0;
      let missing: Awaited<ReturnType<MissingsProfilesService['getMissingByIdForProfileOrDefault']>> | undefined;
      for await (const candidates of readEntityBatchesById(emptyResponseCandidateQuery, 500)) {
        const emptyResponses = await this.emptyResponseSelectionService.filterEffectivelyEmptyResponses(
          candidates, emptyResponseContext, queryRunner.manager
        );
        if (emptyResponses.length === 0) continue;
        missing ??= await this.missingsProfilesService.getMissingByIdForProfileOrDefault(
          workspaceId, null, 'mir', queryRunner.manager
        );
        const { affected } = await queryRunner.manager.update(ResponseEntity, {
          id: In(emptyResponses.map(response => response.id)),
          ...uncodedV2Criteria
        }, {
          code_v2: missing.code,
          score_v2: missing.score,
          status_v2: statusStringToNumber('CODING_COMPLETE'),
          autocoder_invalidated_version: null
        });
        totalUpdated += affected ?? 0;
      }

      await queryRunner.commitTransaction();

      this.logger.log(`Successfully applied coding to ${totalUpdated} empty responses`);

      return {
        success: true,
        updatedCount: totalUpdated,
        message: totalUpdated ?
          `${totalUpdated} leere Antworten erfolgreich kodiert` :
          'Keine leeren Antworten zum Kodieren gefunden'
      };
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      this.logger.error(
        `Error updating empty responses: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      throw new Error(
        `Fehler beim Kodieren der leeren Antworten: ${getErrorMessage(error)}`
      );
    }
  }
}
