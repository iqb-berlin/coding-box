import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingResultsService } from './coding-results.service';
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
    codingJobId: number
  ): Promise<{
      success: boolean;
      updatedResponsesCount: number;
      skippedReviewCount: number;
      messageKey: string;
      messageParams?: Record<string, unknown>;
    }> {
    const result = await this.codingResultsService.applyCodingResults(
      workspaceId,
      codingJobId
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
    this.logger.log(
      `Starting bulk apply coding results for workspace ${workspaceId}`
    );

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
      const hasIssues = await this.codingJobService.hasCodingIssues(job.id);

      if (hasIssues) {
        results.push({
          jobId: job.id,
          jobName: job.name,
          hasIssues: true,
          skipped: true
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
            message: `Error: ${error.message}`
          }
        });
      }
    }

    const message = `Bulk apply completed. Processed ${jobsProcessed} jobs, updated ${totalUpdatedResponses} responses, skipped ${totalSkippedReview} for review. ${results.filter(r => r.hasIssues).length
    } jobs skipped due to coding issues.`;

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
