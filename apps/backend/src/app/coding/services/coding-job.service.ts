import { Injectable } from '@nestjs/common';
import { CodingJobFacade } from './coding-job-facade.service';
import { CreateCodingJobDto } from '../dto/create-coding-job.dto';
import { UpdateCodingJobDto } from '../dto/update-coding-job.dto';
import { SaveCodingProgressDto } from '../dto/save-coding-progress.dto';
import { DistributionRequest } from './response-distribution.service';

@Injectable()
export class CodingJobService {
  constructor(private readonly facade: CodingJobFacade) {}

  // Delegated Query Methods
  async getCodingJobs(workspaceId: number, page: number = 1, limit?: number) {
    return this.facade.getCodingJobs(workspaceId, page, limit);
  }

  async getCodingJob(id: number, workspaceId?: number) {
    return this.facade.getCodingJob(id, workspaceId);
  }

  async getCodingJobById(id: number) {
    return this.facade.getCodingJobById(id);
  }

  async getCodingJobsByCoder(coderId: number) {
    return this.facade.getCodingJobsByCoder(coderId);
  }

  async getCodersByJobId(jobId: number) {
    return this.facade.getCodersByJobId(jobId);
  }

  async getResponsesForCodingJob(codingJobId: number) {
    return this.facade.getResponsesForCodingJob(codingJobId);
  }

  async getCodingProgress(codingJobId: number) {
    return this.facade.getCodingProgress(codingJobId);
  }

  async getCodingNotes(codingJobId: number) {
    return this.facade.getCodingNotes(codingJobId);
  }

  async getCodingJobUnits(codingJobId: number, onlyOpen: boolean = false) {
    return this.facade.getCodingJobUnits(codingJobId, onlyOpen);
  }

  async getCodingSchemes(unitAliases: string[], workspaceId: number) {
    return this.facade.getCodingSchemes(unitAliases, workspaceId);
  }

  async hasCodingIssues(codingJobId: number) {
    return this.facade.hasCodingIssues(codingJobId);
  }

  async getVariableCasesInJobs(workspaceId: number) {
    return this.facade.getVariableCasesInJobs(workspaceId);
  }

  async getBulkCodingProgress(codingJobIds: number[], workspaceId: number) {
    return this.facade.getBulkCodingProgress(codingJobIds, workspaceId);
  }

  // Delegated Mutation Methods
  async createCodingJob(workspaceId: number, createCodingJobDto: CreateCodingJobDto) {
    return this.facade.createCodingJob(workspaceId, createCodingJobDto);
  }

  async updateCodingJob(id: number, workspaceId: number, updateCodingJobDto: UpdateCodingJobDto) {
    return this.facade.updateCodingJob(id, workspaceId, updateCodingJobDto);
  }

  async deleteCodingJob(id: number, workspaceId: number) {
    return this.facade.deleteCodingJob(id, workspaceId);
  }

  async restartCodingJobWithOpenUnits(codingJobId: number, workspaceId: number) {
    return this.facade.restartCodingJobWithOpenUnits(codingJobId, workspaceId);
  }

  async saveCodingProgress(codingJobId: number, progress: SaveCodingProgressDto) {
    return this.facade.saveCodingProgress(codingJobId, progress);
  }

  async calculateDistribution(workspaceId: number, request: DistributionRequest) {
    return this.facade.calculateDistribution(workspaceId, request);
  }

  async createDistributedCodingJobs(workspaceId: number, request: DistributionRequest) {
    return this.facade.createDistributedCodingJobs(workspaceId, request);
  }

  // Delegated Assignment Methods
  async assignCoders(codingJobId: number, userIds: number[]) {
    return this.facade.assignCoders(codingJobId, userIds);
  }

  async assignVariables(codingJobId: number, variables: { unitName: string; variableId: string }[]) {
    return this.facade.assignVariables(codingJobId, variables);
  }
}
