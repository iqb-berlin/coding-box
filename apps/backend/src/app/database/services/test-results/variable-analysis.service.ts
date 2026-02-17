import {
  ConflictException, Injectable, Logger, NotFoundException
} from '@nestjs/common';
import { VariableAnalysisResultDto } from '../../../admin/variable-analysis/dto/variable-analysis-result.dto';
import { JobQueueService, VariableAnalysisJobData } from '../../../job-queue/job-queue.service';
import { VariableAnalysisJobDto } from '../../../admin/variable-analysis/dto/variable-analysis-job.dto';

@Injectable()
export class VariableAnalysisService {
  private readonly logger = new Logger(VariableAnalysisService.name);

  constructor(
    private jobQueueService: JobQueueService
  ) { }

  async createAnalysisJob(
    workspaceId: number,
    unitId?: number,
    variableId?: string
  ): Promise<VariableAnalysisJobDto> {
    const existingJobs = await this.getAnalysisJobs(workspaceId);
    const hasActiveJob = existingJobs.some(j => j.status === 'pending' || j.status === 'processing');

    if (hasActiveJob) {
      throw new ConflictException(`A variable analysis job is already in progress for workspace ${workspaceId}`);
    }

    const jobData: VariableAnalysisJobData = {
      workspaceId,
      unitId,
      variableId
    };

    const job = await this.jobQueueService.addVariableAnalysisJob(jobData);
    this.logger.log(`Created variable analysis job with ID ${job.id}`);

    // Map Bull job to DTO
    return VariableAnalysisJobDto.fromJob({
      id: job.id,
      workspaceId,
      unitId,
      variableId,
      status: 'pending', // Initial status
      progress: 0,
      timestamp: Date.now()
    });
  }

  async getAnalysisJob(jobId: number | string, workspaceId?: number): Promise<VariableAnalysisJobDto> {
    const job = await this.jobQueueService.getVariableAnalysisJob(jobId.toString());

    if (!job) {
      if (workspaceId !== undefined) {
        throw new NotFoundException(`Job with ID ${jobId} not found in workspace ${workspaceId}`);
      } else {
        throw new NotFoundException(`Job with ID ${jobId} not found`);
      }
    }

    if (workspaceId !== undefined && job.data.workspaceId !== workspaceId) {
      throw new NotFoundException(`Job with ID ${jobId} not found in workspace ${workspaceId}`);
    }

    const state = await job.getState();
    const progress = await job.progress();

    return VariableAnalysisJobDto.fromJob({
      id: job.id,
      workspaceId: job.data.workspaceId,
      unitId: job.data.unitId,
      variableId: job.data.variableId,
      status: state === 'active' ? 'processing' : state, // Map 'active' to 'processing' to match previous enum if needed
      progress,
      error: job.failedReason,
      timestamp: job.timestamp,
      finishedOn: job.finishedOn
    });
  }

  async getAnalysisResults(jobId: number | string, workspaceId?: number): Promise<VariableAnalysisResultDto> {
    const job = await this.jobQueueService.getVariableAnalysisJob(jobId.toString());

    if (!job) {
      throw new NotFoundException(`Job with ID ${jobId} not found`);
    }

    if (workspaceId !== undefined && job.data.workspaceId !== workspaceId) {
      throw new NotFoundException(`Job with ID ${jobId} not found in workspace ${workspaceId}`);
    }

    const state = await job.getState();
    if (state !== 'completed') {
      throw new Error(`Job with ID ${jobId} is not completed (status: ${state})`);
    }

    if (!job.returnvalue) {
      throw new Error(`Job with ID ${jobId} has no results`);
    }

    return job.returnvalue as VariableAnalysisResultDto;
  }

  async getAnalysisJobs(workspaceId: number): Promise<VariableAnalysisJobDto[]> {
    const jobs = await this.jobQueueService.getVariableAnalysisJobs(workspaceId);

    // Map to DTOs and sort by creation date
    const dtos = await Promise.all(jobs.map(async job => {
      const state = await job.getState();
      const progress = await job.progress();
      return VariableAnalysisJobDto.fromJob({
        id: job.id,
        workspaceId: job.data.workspaceId,
        unitId: job.data.unitId,
        variableId: job.data.variableId,
        status: state === 'active' ? 'processing' : state,
        progress,
        error: job.failedReason,
        timestamp: job.timestamp,
        finishedOn: job.finishedOn
      });
    }));

    return dtos.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  }

  async deleteJob(workspaceId: number, jobId: string | number): Promise<boolean> {
    return this.jobQueueService.deleteVariableAnalysisJob(jobId.toString());
  }

  async cancelJob(workspaceId: number, jobId: string | number): Promise<boolean> {
    return this.jobQueueService.cancelVariableAnalysisJob(jobId.toString());
  }

  async deleteAllJobs(workspaceId: number): Promise<void> {
    return this.jobQueueService.deleteVariableAnalysisJobs(workspaceId);
  }
}
