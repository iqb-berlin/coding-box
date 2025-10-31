import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobDefinition } from '../entities/job-definition.entity';
import { CreateJobDefinitionDto } from '../../admin/coding-job/dto/create-job-definition.dto';
import { UpdateJobDefinitionDto } from '../../admin/coding-job/dto/update-job-definition.dto';
import { ApproveJobDefinitionDto } from '../../admin/coding-job/dto/approve-job-definition.dto';

@Injectable()
export class JobDefinitionService {
  constructor(
    @InjectRepository(JobDefinition)
    private jobDefinitionRepository: Repository<JobDefinition>
  ) {}

  async createJobDefinition(createDto: CreateJobDefinitionDto): Promise<JobDefinition> {
    const jobDefinition = this.jobDefinitionRepository.create({
      status: createDto.status ?? 'draft',
      assigned_variables: createDto.assignedVariables,
      assigned_variable_bundles: createDto.assignedVariableBundles,
      assigned_coders: createDto.assignedCoders,
      duration_seconds: createDto.durationSeconds,
      max_coding_cases: createDto.maxCodingCases,
      double_coding_absolute: createDto.doubleCodingAbsolute,
      double_coding_percentage: createDto.doubleCodingPercentage
    });

    return this.jobDefinitionRepository.save(jobDefinition);
  }

  async getJobDefinition(id: number): Promise<JobDefinition> {
    const jobDefinition = await this.jobDefinitionRepository.findOne({
      where: { id }
    });

    if (!jobDefinition) {
      throw new NotFoundException(`Job definition with ID ${id} not found`);
    }

    return jobDefinition;
  }

  async getJobDefinitions(workspaceId?: number): Promise<JobDefinition[]> {
    const whereClause = workspaceId ? {
      ...(!workspaceId ? {} : {})
    } : {};

    return this.jobDefinitionRepository.find({
      where: whereClause,
      order: { created_at: 'DESC' }
    });
  }

  async updateJobDefinition(id: number, updateDto: UpdateJobDefinitionDto): Promise<JobDefinition> {
    const jobDefinition = await this.getJobDefinition(id);

    if (updateDto.status !== undefined) {
      jobDefinition.status = updateDto.status;
    }
    if (updateDto.assignedVariables !== undefined) {
      jobDefinition.assigned_variables = updateDto.assignedVariables;
    }
    if (updateDto.assignedVariableBundles !== undefined) {
      jobDefinition.assigned_variable_bundles = updateDto.assignedVariableBundles;
    }
    if (updateDto.assignedCoders !== undefined) {
      jobDefinition.assigned_coders = updateDto.assignedCoders;
    }
    if (updateDto.durationSeconds !== undefined) {
      jobDefinition.duration_seconds = updateDto.durationSeconds;
    }
    if (updateDto.maxCodingCases !== undefined) {
      jobDefinition.max_coding_cases = updateDto.maxCodingCases;
    }
    if (updateDto.doubleCodingAbsolute !== undefined) {
      jobDefinition.double_coding_absolute = updateDto.doubleCodingAbsolute;
    }
    if (updateDto.doubleCodingPercentage !== undefined) {
      jobDefinition.double_coding_percentage = updateDto.doubleCodingPercentage;
    }

    return this.jobDefinitionRepository.save(jobDefinition);
  }

  async approveJobDefinition(id: number, approveDto: ApproveJobDefinitionDto): Promise<JobDefinition> {
    const jobDefinition = await this.getJobDefinition(id);

    if (approveDto.status === 'pending_review' && jobDefinition.status === 'draft') {
      jobDefinition.status = 'pending_review';
    } else if (approveDto.status === 'approved' && ['draft', 'pending_review'].includes(jobDefinition.status)) {
      jobDefinition.status = 'approved';
    } else {
      throw new Error(`Invalid status transition from ${jobDefinition.status} to ${approveDto.status}`);
    }

    return this.jobDefinitionRepository.save(jobDefinition);
  }

  async deleteJobDefinition(id: number): Promise<void> {
    const jobDefinition = await this.getJobDefinition(id);

    if (jobDefinition.coding_job_id) {
      throw new Error('Cannot delete job definition that is linked to a coding job');
    }

    await this.jobDefinitionRepository.remove(jobDefinition);
  }

  async linkToCodingJob(jobDefinitionId: number, codingJobId: number): Promise<JobDefinition> {
    const jobDefinition = await this.getJobDefinition(jobDefinitionId);

    if (jobDefinition.status !== 'approved') {
      throw new Error('Only approved job definitions can be linked to coding jobs');
    }

    jobDefinition.coding_job_id = codingJobId;
    return this.jobDefinitionRepository.save(jobDefinition);
  }

  async getApprovedJobDefinitions(): Promise<JobDefinition[]> {
    return this.jobDefinitionRepository.find({
      where: { status: 'approved' },
      order: { created_at: 'DESC' }
    });
  }
}
