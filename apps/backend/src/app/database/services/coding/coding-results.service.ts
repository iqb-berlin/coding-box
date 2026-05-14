import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { CacheService } from '../../../cache/cache.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJobService, ResponseMatchingFlag } from './coding-job.service';
import { CodingStatisticsService } from './coding-statistics.service';
import { CodingAnalysisService } from './coding-analysis.service';
import { buildAggregationGroups } from './aggregation-metrics.util';

export interface ApplyCodingResultsOptions {
  overwriteExisting?: boolean;
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

@Injectable()
export class CodingResultsService {
  private readonly logger = new Logger(CodingResultsService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    private cacheService: CacheService,
    private codingStatisticsService: CodingStatisticsService,
    private codingJobService: CodingJobService,
    private codingAnalysisService: CodingAnalysisService
  ) { }

  async applyCodingResults(
    workspaceId: number,
    codingJobId: number,
    options: ApplyCodingResultsOptions = {}
  ): Promise<ApplyCodingResultsResult> {
    this.logger.log(`Applying coding results for coding job ${codingJobId} in workspace ${workspaceId}`);
    const overwriteExisting = options.overwriteExisting === true;

    // Check if coding job is completed before allowing application
    const codingJob = await this.codingJobService.getCodingJobById(codingJobId);
    if (codingJob.status !== 'completed') {
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

    const responsesToUpdate: {
      responseId: number;
      code_v2: number | null;
      score_v2: number | null;
      status_v2: number;
    }[] = [];

    try {
      const codingJobUnits = await this.codingJobService.getCodingJobUnits(codingJobId);
      const codingProgress = await this.codingJobService.getCodingProgress(codingJobId);

      const uncertainIssues = Object.values(codingProgress).filter(p => {
        if (!p || typeof p !== 'object') {
          return false;
        }

        const codeId = typeof p.id === 'number' ? p.id : null;
        const codingIssueOption = typeof p.codingIssueOption === 'number' ? p.codingIssueOption : null;

        return codeId === -1 || codeId === -2 || codingIssueOption === -1 || codingIssueOption === -2;
      });

      if (uncertainIssues.length > 0) {
        return {
          success: false,
          updatedResponsesCount: 0,
          skippedReviewCount: 0,
          skippedAlreadyCodedCount: 0,
          overwrittenExistingCount: 0,
          messageKey: 'coding-results.apply.error.uncertain-issues-present',
          messageParams: { count: uncertainIssues.length }
        };
      }

      let skippedReviewCount = 0;
      let skippedAlreadyCodedCount = 0;
      let overwrittenExistingCount = 0;

      for (const unit of codingJobUnits) {
        const testPerson = `${unit.personLogin}@${unit.personCode}@${unit.bookletName}`;
        const progressKey = `${testPerson}::${unit.bookletName}::${unit.unitName}::${unit.variableId}`;
        const progress = codingProgress[progressKey];

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

          if (progress.codingIssueOption === -1 || progress.codingIssueOption === -2) {
            skippedReviewCount += 1;
            continue;
          }

          // Handle uncertain options (negative IDs)
          if (progress.id === -1) {
            status = statusStringToNumber('CODING_INCOMPLETE');
          } else if (progress.id === -3) {
            code = -98;
            score = 0;
          } else if (progress.id === -4) {
            code = -97;
            score = 0;
          } else if (progress.id === -2) {
            skippedReviewCount += 1;
            continue;
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
          const alreadyUpdatedIds = new Set(responsesToUpdate.map(r => r.responseId));

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

            for (const codedResponse of codedResponses) {
              const update = completedUpdates.find(u => u.responseId === codedResponse.id);
              if (!update) continue;

              const unitName = codedResponse.unit?.name;
              const variableId = codedResponse.variableid;

              if (!unitName || !variableId) continue;

              // Find all sibling responses for the same workspace + unit + variable.
              // Existing v2 codings are either reported as skipped or overwritten only when explicitly requested.
              const candidates = await this.responseRepository
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
                .where('person.workspace_id = :workspaceId', { workspaceId })
                .andWhere('person.consider = :consider', { consider: true })
                .andWhere('response.status_v1 IN (:...statuses)', {
                  statuses: [
                    statusStringToNumber('CODING_INCOMPLETE'),
                    statusStringToNumber('INTENDED_INCOMPLETE')
                  ]
                })
                .andWhere('unit.name = :unitName', { unitName })
                .andWhere('response.variableid = :variableId', { variableId })
                .getMany();

              const groups = buildAggregationGroups(
                candidates.map(candidate => ({
                  responseId: candidate.id,
                  unitName: candidate.unit?.name || unitName,
                  variableId: candidate.variableid,
                  value: candidate.value,
                  statusV2: candidate.status_v2
                })),
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

                if (candidate.statusV2 !== null && candidate.statusV2 !== undefined) {
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
                  status_v2: update.status_v2
                });
                alreadyUpdatedIds.add(candidate.responseId);
              }
            }

            this.logger.log(`Group sibling propagation complete. Total responses to update: ${responsesToUpdate.length}`);
          }
        }
      }

      if (responsesToUpdate.length === 0) {
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
        const batchSize = 500;
        let totalUpdated = 0;

        for (let i = 0; i < responsesToUpdate.length; i += batchSize) {
          const batch = responsesToUpdate.slice(i, i + batchSize);

          const updatePromises = batch.map(responseUpdate => queryRunner.manager.update(
            ResponseEntity,
            responseUpdate.responseId,
            {
              code_v2: responseUpdate.code_v2,
              score_v2: responseUpdate.score_v2,
              status_v2: responseUpdate.status_v2
            }
          )
          );

          await Promise.all(updatePromises);
          totalUpdated += batch.length;

          this.logger.log(`Updated batch of ${batch.length} responses (${totalUpdated}/${responsesToUpdate.length})`);
        }

        await queryRunner.commitTransaction();

        await this.codingJobService.updateCodingJob(codingJobId, workspaceId, { status: 'results_applied' });

        await this.invalidateIncompleteVariablesCache(workspaceId);
        await this.codingStatisticsService.invalidateCache(workspaceId);

        return {
          success: true,
          updatedResponsesCount: responsesToUpdate.length,
          skippedReviewCount,
          skippedAlreadyCodedCount,
          overwrittenExistingCount,
          messageKey: 'coding-results.apply.success.bulk',
          messageParams: {
            count: responsesToUpdate.length,
            skipped: skippedReviewCount,
            skippedAlreadyCoded: skippedAlreadyCodedCount,
            overwrittenExisting: overwrittenExistingCount
          }
        };
      } catch (error) {
        await queryRunner.rollbackTransaction();
        this.logger.error(`Error updating responses: ${error.message}`, error.stack);
        throw new Error(`Fehler beim Anwenden der Kodierungsergebnisse: ${error.message}`);
      } finally {
        await queryRunner.release();
      }
    } catch (error) {
      this.logger.error(`Error applying coding results: ${error.message}`, error.stack);
      throw new Error(`Fehler beim Anwenden der Kodierungsergebnisse: ${error.message}`);
    }
  }

  private async invalidateIncompleteVariablesCache(workspaceId: number): Promise<void> {
    const cacheKey = `coding_incomplete_variables_v3:${workspaceId}`;
    await this.cacheService.delete(cacheKey);
    this.logger.log(`Invalidated manual coding variables cache for workspace ${workspaceId}`);
  }

  /**
   * Apply coding to all empty responses in a workspace
   * Sets status_v2 = CODING_COMPLETE (5), code_v2 = -98, score_v2 = 0
   * Only updates responses where value is null or empty and status_v2 is not already set
   */
  async applyEmptyResponseCoding(workspaceId: number): Promise<{
    success: boolean;
    updatedCount: number;
    message: string;
  }> {
    this.logger.log(`Applying empty response coding for workspace ${workspaceId}`);

    try {
      // Find all empty responses that don't have v2 coding yet
      // Only target unit responses (status_v1 = CODING_INCOMPLETE)
      const emptyResponses = await this.responseRepository
        .createQueryBuilder('response')
        .leftJoin('response.unit', 'unit')
        .leftJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere('response.status_v1 IN (:...statuses)', {
          statuses: [
            statusStringToNumber('CODING_INCOMPLETE'),
            statusStringToNumber('INTENDED_INCOMPLETE')
          ]
        })
        .andWhere('(response.value IS NULL OR TRIM(BOTH :whitespaces FROM response.value) = :emptyString OR response.value = :emptyArrayString)', {
          whitespaces: ' \r\n\t',
          emptyString: '',
          emptyArrayString: '[]'
        })
        .andWhere('response.status_v2 IS NULL')
        .getMany();

      if (emptyResponses.length === 0) {
        return {
          success: true,
          updatedCount: 0,
          message: 'Keine leeren Antworten zum Kodieren gefunden'
        };
      }

      this.logger.log(`Found ${emptyResponses.length} empty responses to code`);
      const queryRunner = this.responseRepository.manager.connection.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction('READ COMMITTED');

      try {
        const batchSize = 500;
        let totalUpdated = 0;

        for (let i = 0; i < emptyResponses.length; i += batchSize) {
          const batch = emptyResponses.slice(i, i + batchSize);

          const updatePromises = batch.map(response => queryRunner.manager.update(
            ResponseEntity,
            response.id,
            {
              code_v2: -98,
              score_v2: 0,
              status_v2: statusStringToNumber('CODING_COMPLETE') // 5
            }
          )
          );

          await Promise.all(updatePromises);
          totalUpdated += batch.length;

          this.logger.log(
            `Updated batch of ${batch.length} empty responses (${totalUpdated}/${emptyResponses.length})`
          );
        }

        await queryRunner.commitTransaction();

        await this.invalidateIncompleteVariablesCache(workspaceId);
        await this.codingStatisticsService.invalidateCache(workspaceId);
        await this.codingAnalysisService.invalidateCache(workspaceId);

        this.logger.log(`Successfully applied coding to ${totalUpdated} empty responses`);

        return {
          success: true,
          updatedCount: totalUpdated,
          message: `${totalUpdated} leere Antworten erfolgreich kodiert`
        };
      } catch (error) {
        await queryRunner.rollbackTransaction();
        this.logger.error(
          `Error updating empty responses: ${error.message}`,
          error.stack
        );
        throw new Error(
          `Fehler beim Kodieren der leeren Antworten: ${error.message}`
        );
      } finally {
        await queryRunner.release();
      }
    } catch (error) {
      this.logger.error(
        `Error applying empty response coding: ${error.message}`,
        error.stack
      );
      return {
        success: false,
        updatedCount: 0,
        message: `Fehler: ${error.message}`
      };
    }
  }
}
