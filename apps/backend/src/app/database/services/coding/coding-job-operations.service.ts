import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CodingJob } from '../../entities/coding-job.entity';
import {
  ApplyCodingResultsOptions,
  ApplyCodingResultsResult,
  CodingResultsService
} from './coding-results.service';
import { CodingJobService } from './coding-job.service';
import { CodingValidationService } from './coding-validation.service';

@Injectable()
export class CodingJobOperationsService {
  private readonly logger = new Logger(CodingJobOperationsService.name);

  constructor(
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>,
    private codingResultsService: CodingResultsService,
    private codingJobService: CodingJobService,
    private codingValidationService: CodingValidationService
  ) { }

  async applyCodingResults(
    workspaceId: number,
    codingJobId: number,
    options: ApplyCodingResultsOptions = {}
  ): Promise<ApplyCodingResultsResult> {
    const result = await this.codingResultsService.applyCodingResults(
      workspaceId,
      codingJobId,
      options
    );

    if (result.success && result.updatedResponsesCount > 0) {
      await this.codingValidationService.invalidateIncompleteVariablesCache(workspaceId);
      this.logger.log(
        `Invalidated incomplete variables cache for workspace ${workspaceId} after applying ${result.updatedResponsesCount} coding results`
      );
    }

    return result;
  }

  async bulkApplyCodingResults(workspaceId: number): Promise<{
    success: boolean;
    jobsProcessed: number;
    totalUpdatedResponses: number;
    totalSkippedReview: number;
    totalSkippedAlreadyCoded: number;
    totalOverwrittenExisting: number;
    message: string;
    results: Array<{
      jobId: number;
      jobName: string;
      hasIssues: boolean;
      skipped: boolean;
      skippedReason?: 'coding-issues' | 'training-job' | 'not-completed';
      result?: {
        success: boolean;
        updatedResponsesCount: number;
        skippedReviewCount: number;
        skippedAlreadyCodedCount: number;
        overwrittenExistingCount: number;
        message: string;
      };
    }>;
  }> {
    this.logger.log(
      `Starting bulk apply coding results for workspace ${workspaceId}`
    );

    const codingJobs = await this.codingJobRepository.find({
      where: { workspace_id: workspaceId },
      select: ['id', 'name', 'status', 'training_id']
    });

    const results: Array<{
      jobId: number;
      jobName: string;
      hasIssues: boolean;
      skipped: boolean;
      skippedReason?: 'coding-issues' | 'training-job' | 'not-completed';
      result?: {
        success: boolean;
        updatedResponsesCount: number;
        skippedReviewCount: number;
        skippedAlreadyCodedCount: number;
        overwrittenExistingCount: number;
        message: string;
      };
    }> = [];

    let totalUpdatedResponses = 0;
    let totalSkippedReview = 0;
    let totalSkippedAlreadyCoded = 0;
    let totalOverwrittenExisting = 0;
    let jobsProcessed = 0;

    for (const job of codingJobs) {
      const hasIssues = await this.codingJobService.hasCodingIssues(job.id);

      if (hasIssues) {
        results.push({
          jobId: job.id,
          jobName: job.name,
          hasIssues: true,
          skipped: true,
          skippedReason: 'coding-issues'
        });
        continue;
      }

      if (job.training_id !== null && job.training_id !== undefined) {
        results.push({
          jobId: job.id,
          jobName: job.name,
          hasIssues: false,
          skipped: true,
          skippedReason: 'training-job'
        });
        continue;
      }

      if (job.status !== 'completed') {
        results.push({
          jobId: job.id,
          jobName: job.name,
          hasIssues: false,
          skipped: true,
          skippedReason: 'not-completed'
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
            skippedAlreadyCodedCount: applyResult.skippedAlreadyCodedCount,
            overwrittenExistingCount: applyResult.overwrittenExistingCount,
            message: applyResult.messageKey || 'Apply result'
          }
        });

        if (applyResult.success) {
          totalUpdatedResponses += applyResult.updatedResponsesCount;
          totalSkippedReview += applyResult.skippedReviewCount;
          totalSkippedAlreadyCoded += applyResult.skippedAlreadyCodedCount;
          totalOverwrittenExisting += applyResult.overwrittenExistingCount;
          jobsProcessed += 1;
        }
      } catch (error) {
        this.logger.error(
          `Error applying results for job ${job.id}: ${error.message}`
        );
        results.push({
          jobId: job.id,
          jobName: job.name,
          hasIssues: false,
          skipped: false,
          result: {
            success: false,
            updatedResponsesCount: 0,
            skippedReviewCount: 0,
            skippedAlreadyCodedCount: 0,
            overwrittenExistingCount: 0,
            message: `Error: ${error.message}`
          }
        });
      }
    }

    const codingIssueJobs = results.filter(result => result.skippedReason === 'coding-issues').length;
    const trainingJobs = results.filter(result => result.skippedReason === 'training-job').length;
    const notCompletedJobs = results.filter(result => result.skippedReason === 'not-completed').length;
    const failedJobs = results.filter(result => !result.skipped && result.result && !result.result.success).length;
    const message = `Bulk apply completed. Processed ${jobsProcessed} jobs, updated ${totalUpdatedResponses} responses, skipped ${totalSkippedReview} for review. ${codingIssueJobs
    } jobs skipped due to coding issues.${trainingJobs > 0 ? ` ${trainingJobs} training jobs skipped.` : ''}${notCompletedJobs > 0 ? ` ${notCompletedJobs} jobs skipped because they are not completed.` : ''}${failedJobs > 0 ? ` ${failedJobs} jobs could not be applied due to conflicts or errors.` : ''}`;

    this.logger.log(message);

    return {
      success: true,
      jobsProcessed,
      totalUpdatedResponses,
      totalSkippedReview,
      totalSkippedAlreadyCoded,
      totalOverwrittenExisting,
      message,
      results
    };
  }

  async createDistributedCodingJobs(
    workspaceId: number,
    request: {
      selectedVariables: { unitName: string; variableId: string }[];
      selectedVariableBundles?: {
        id: number;
        name: string;
        variables: { unitName: string; variableId: string }[];
      }[];
      selectedCoders: { id: number; name: string; username: string }[];
      doubleCodingAbsolute?: number;
      doubleCodingPercentage?: number;
      caseOrderingMode?: 'continuous' | 'alternating';
      maxCodingCases?: number;
      showScore?: boolean;
      allowComments?: boolean;
      suppressGeneralInstructions?: boolean;
    }
  ): Promise<{
      success: boolean;
      jobsCreated: number;
      message: string;
      distribution: Record<string, Record<string, number>>;
      doubleCodingInfo: Record<
      string,
      {
        totalCases: number;
        doubleCodedCases: number;
        singleCodedCasesAssigned: number;
        doubleCodedCasesPerCoder: Record<string, number>;
      }
      >;
      jobs: {
        coderId: number;
        coderName: string;
        variable: { unitName: string; variableId: string };
        jobId: number;
        jobName: string;
        caseCount: number;
      }[];
    }> {
    return this.codingJobService.createDistributedCodingJobs(
      workspaceId,
      request
    );
  }
}
