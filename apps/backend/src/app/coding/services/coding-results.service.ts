import {
  Injectable, Logger
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { statusStringToNumber } from '../../workspaces/utils/response-status-converter';
import { CacheService } from '../../cache/cache.service';
import { WorkspacesFacadeService } from '../../workspaces/services/workspaces-facade.service';
import { CodingJobService } from './coding-job.service';
import { CodingStatisticsService } from './coding-statistics.service';

import { CodingJob } from '../entities/coding-job.entity';

@Injectable()
export class CodingResultsService {
  private readonly logger = new Logger(CodingResultsService.name);

  constructor(
    private workspacesFacadeService: WorkspacesFacadeService,
    private cacheService: CacheService,
    private codingStatisticsService: CodingStatisticsService,
    private codingJobService: CodingJobService,
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>
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

    const codingJobUnits = await this.codingJobService.getCodingJobUnits(codingJobId);
    const codingProgress = await this.codingJobService.getCodingProgress(codingJobId);

    const uncertainIssues = Object.values(codingProgress).filter(p => typeof p.id === 'number' && (p.id === -1 || p.id === -2));

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

    try {
      await this.workspacesFacadeService.updateResponsesV2(responsesToUpdate);

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
      this.logger.error(`Error updating responses: ${error.message}`, error.stack);
      throw error;
    }
  }

  async bulkApplyCodingResults(workspaceId: number): Promise<{
    success: boolean;
    jobsProcessed: number;
    totalUpdatedResponses: number;
    totalSkippedReview: number;
    message: string;
    results: Array<{
      jobId: number;
      jobName: string;
      hasIssues: boolean;
      skipped: boolean;
      result?: {
        success: boolean;
        updatedResponsesCount: number;
        skippedReviewCount: number;
        message: string;
      };
    }>;
  }> {
    this.logger.log(`Starting bulk apply coding results for workspace ${workspaceId}`);
    const codingJobs = await this.codingJobRepository.find({
      where: { workspace_id: workspaceId },
      select: ['id', 'name']
    });

    const results: Array<{
      jobId: number;
      jobName: string;
      hasIssues: boolean;
      skipped: boolean;
      result?: {
        success: boolean;
        updatedResponsesCount: number;
        skippedReviewCount: number;
        message: string;
      };
    }> = [];
    let totalUpdatedResponses = 0;
    let totalSkippedReview = 0;
    let jobsProcessed = 0;

    for (const job of codingJobs) {
      if (await this.codingJobService.hasCodingIssues(job.id)) {
        results.push({
          jobId: job.id, jobName: job.name, hasIssues: true, skipped: true
        });
        continue;
      }

      try {
        const applyResult = await this.applyCodingResults(workspaceId, job.id);
        results.push({
          jobId: job.id,
          jobName: job.name,
          hasIssues: false,
          skipped: false,
          result: {
            success: applyResult.success,
            updatedResponsesCount: applyResult.updatedResponsesCount,
            skippedReviewCount: applyResult.skippedReviewCount,
            message: applyResult.messageKey || 'Apply result'
          }
        });

        if (applyResult.success) {
          totalUpdatedResponses += applyResult.updatedResponsesCount;
          totalSkippedReview += applyResult.skippedReviewCount;
          jobsProcessed += 1;
        }
      } catch (error) {
        this.logger.error(`Error applying results for job ${job.id}: ${error.message}`);
        results.push({
          jobId: job.id,
          jobName: job.name,
          hasIssues: false,
          skipped: false,
          result: {
            success: false, updatedResponsesCount: 0, skippedReviewCount: 0, message: `Error: ${error.message}`
          }
        });
      }
    }

    const message = `Bulk apply completed. Processed ${jobsProcessed} jobs, updated ${totalUpdatedResponses} responses.`;
    this.logger.log(message);

    return {
      success: true,
      jobsProcessed,
      totalUpdatedResponses,
      totalSkippedReview,
      message,
      results
    };
  }

  private async invalidateIncompleteVariablesCache(workspaceId: number): Promise<void> {
    const cacheKey = `coding_incomplete_variables:${workspaceId}`;
    await this.cacheService.delete(cacheKey);
    this.logger.log(`Invalidated CODING_INCOMPLETE variables cache for workspace ${workspaceId}`);
  }
}
