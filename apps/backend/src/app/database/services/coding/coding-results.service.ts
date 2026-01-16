import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { CacheService } from '../../../cache/cache.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJobService } from './coding-job.service';
import { CodingStatisticsService } from './coding-statistics.service';

@Injectable()
export class CodingResultsService {
  private readonly logger = new Logger(CodingResultsService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    private cacheService: CacheService,
    private codingStatisticsService: CodingStatisticsService,
    private codingJobService: CodingJobService
  ) {}

  async applyCodingResults(workspaceId: number, codingJobId: number): Promise<{
    success: boolean;
    updatedResponsesCount: number;
    skippedReviewCount: number;
    messageKey: string;
    messageParams?: Record<string, unknown>;
  }> {
    this.logger.log(`Applying coding results for coding job ${codingJobId} in workspace ${workspaceId}`);

    // Check if coding job is completed before allowing application
    const codingJob = await this.codingJobService.getCodingJobById(codingJobId);
    if (codingJob.status !== 'completed') {
      return {
        success: false,
        updatedResponsesCount: 0,
        skippedReviewCount: 0,
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

      const uncertainIssues = Object.values(codingProgress).filter(p => typeof p.id === 'number' && (p.id === -1 || p.id === -2)
      );

      if (uncertainIssues.length > 0) {
        return {
          success: false,
          updatedResponsesCount: 0,
          skippedReviewCount: 0,
          messageKey: 'coding-results.apply.error.uncertain-issues-present',
          messageParams: { count: uncertainIssues.length }
        };
      }

      let skippedReviewCount = 0;

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
          const score = progress.score !== undefined ? progress.score : null;

          // Handle uncertain options (negative IDs)
          if (progress.id === -1) {
            status = statusStringToNumber('CODING_INCOMPLETE');
          } else if (progress.id === -3) {
            status = statusStringToNumber('INVALID');
          } else if (progress.id === -4) {
            status = statusStringToNumber('CODING_ERROR');
          } else if (progress.id === -2 || progress.id === -1) {
            skippedReviewCount += 1;
            continue;
          } else if (progress.id > 0) {
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

      if (responsesToUpdate.length === 0) {
        return {
          success: true,
          updatedResponsesCount: 0,
          skippedReviewCount,
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

        // Update coding job status to 'results_applied' after successful application
        await this.codingJobService.updateCodingJob(codingJobId, workspaceId, { status: 'results_applied' });

        await this.invalidateIncompleteVariablesCache(workspaceId);
        await this.codingStatisticsService.refreshStatistics(workspaceId);

        return {
          success: true,
          updatedResponsesCount: responsesToUpdate.length,
          skippedReviewCount,
          messageKey: 'coding-results.apply.success.bulk',
          messageParams: { count: responsesToUpdate.length, skipped: skippedReviewCount }
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
    const cacheKey = `coding_incomplete_variables:${workspaceId}`;
    await this.cacheService.delete(cacheKey);
    this.logger.log(`Invalidated CODING_INCOMPLETE variables cache for workspace ${workspaceId}`);
  }
}
