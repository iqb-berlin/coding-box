import { Injectable } from '@nestjs/common';
import { CodingJobQueryService } from './coding-job-query.service';
import { CodingJobMutationService } from './coding-job-mutation.service';
import { ResponseDistributionService } from './response-distribution.service';
import { CodingJobAssignmentService } from './coding-job-assignment.service';
import { CreateCodingJobDto } from '../dto/create-coding-job.dto';
import { UpdateCodingJobDto } from '../dto/update-coding-job.dto';
import { SaveCodingProgressDto } from '../dto/save-coding-progress.dto';

@Injectable()
export class CodingJobFacade {
  constructor(
    private readonly queryService: CodingJobQueryService,
    private readonly mutationService: CodingJobMutationService,
    private readonly distributionService: ResponseDistributionService,
    private readonly assignmentService: CodingJobAssignmentService
  ) {}

  // Query Methods
  async getCodingJobs(workspaceId: number, page: number = 1, limit?: number) {
    return this.queryService.getCodingJobs(workspaceId, page, limit);
  }

  async getCodingJob(id: number, workspaceId?: number) {
    return this.queryService.getCodingJob(id, workspaceId);
  }

  async getCodingJobById(id: number) {
    return this.queryService.getCodingJobById(id);
  }

  async getCodingJobsByCoder(coderId: number) {
    return this.queryService.getCodingJobsByCoder(coderId);
  }

  async getCodersByJobId(jobId: number) {
    return this.queryService.getCodersByJobId(jobId);
  }

  async getResponsesForCodingJob(codingJobId: number) {
    return this.queryService.getResponsesForCodingJob(codingJobId);
  }

  async getCodingProgress(codingJobId: number) {
    return this.queryService.getCodingProgress(codingJobId);
  }

  async getCodingNotes(codingJobId: number) {
    return this.queryService.getCodingNotes(codingJobId);
  }

  async getCodingJobUnits(codingJobId: number, onlyOpen: boolean = false) {
    return this.queryService.getCodingJobUnits(codingJobId, onlyOpen);
  }

  async getCodingSchemes(unitAliases: string[], workspaceId: number) {
    return this.queryService.getCodingSchemes(unitAliases, workspaceId);
  }

  async hasCodingIssues(codingJobId: number) {
    return this.queryService.hasCodingIssues(codingJobId);
  }

  async getVariableCasesInJobs(workspaceId: number) {
    return this.queryService.getVariableCasesInJobs(workspaceId);
  }

  async getBulkCodingProgress(codingJobIds: number[], workspaceId: number) {
    return this.queryService.getBulkCodingProgress(codingJobIds, workspaceId);
  }

  // Mutation Methods
  async createCodingJob(workspaceId: number, createCodingJobDto: CreateCodingJobDto) {
    return this.mutationService.createCodingJob(workspaceId, createCodingJobDto);
  }

  async updateCodingJob(id: number, workspaceId: number, updateCodingJobDto: UpdateCodingJobDto) {
    return this.mutationService.updateCodingJob(id, workspaceId, updateCodingJobDto);
  }

  async deleteCodingJob(id: number, workspaceId: number) {
    return this.mutationService.deleteCodingJob(id, workspaceId);
  }

  async restartCodingJobWithOpenUnits(codingJobId: number, workspaceId: number) {
    return this.mutationService.restartCodingJobWithOpenUnits(codingJobId, workspaceId);
  }

  async saveCodingProgress(codingJobId: number, progress: SaveCodingProgressDto) {
    const job = await this.mutationService.saveCodingProgress(codingJobId, progress);
    await this.checkAndUpdateCodingJobCompletion(codingJobId);
    return job;
  }

  // Distribution Methods
  async calculateDistribution(workspaceId: number, request: any) {
    return this.distributionService.calculateDistribution(workspaceId, request);
  }

  async createDistributedCodingJobs(workspaceId: number, request: any) {
    // This method was originally in CodingJobService and is complex.
    // It's probably better to keep it in the facade or move it to ResponseDistributionService
    // and let it call mutationService.createCodingJobWithUnitSubset.
    // For now, I'll recommend implementing it in ResponseDistributionService.
    return (this.distributionService as any).createDistributedCodingJobs(workspaceId, request, this.mutationService);
  }

  // Assignment Methods
  async assignCoders(codingJobId: number, userIds: number[]) {
    return this.assignmentService.assignCoders(codingJobId, userIds);
  }

  async assignVariables(codingJobId: number, variables: { unitName: string; variableId: string }[]) {
    return this.assignmentService.assignVariables(codingJobId, variables);
  }

  // Helpers
  async checkAndUpdateCodingJobCompletion(codingJobId: number) {
    const progress = await this.queryService.getCodingJobProgress(codingJobId);
    if (progress.total > 0 && progress.progress === 100) {
      const newStatus = progress.open > 0 ? 'open' : 'completed';
      await (this.mutationService as any).codingJobRepository.update(codingJobId, { status: newStatus });
    }
  }
}
