import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobMutationService } from './coding-job-mutation.service';
import { CodingJobQueryService } from './coding-job-query.service';

@Injectable()
export class CodingJobStatusService {
  constructor(
    @InjectRepository(CodingJob)
    private readonly codingJobRepository: Repository<CodingJob>,
    private readonly mutation: CodingJobMutationService,
    private readonly query: CodingJobQueryService
  ) {}

  async pauseCodingJob(id: number, workspaceId: number): Promise<CodingJob> {
    return this.setOwnCodingJobStatus(id, workspaceId, 'paused');
  }

  async resumeCodingJob(id: number, workspaceId: number): Promise<CodingJob> {
    return this.setOwnCodingJobStatus(id, workspaceId, 'active');
  }

  async submitCodingJob(id: number, workspaceId: number): Promise<CodingJob> {
    return this.mutation.updateCodingJob(id, workspaceId, { status: 'completed' });
  }

  async setOwnCodingJobStatus(
    id: number,
    workspaceId: number,
    status: 'active' | 'paused'
  ): Promise<CodingJob> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id, workspace_id: workspaceId }
    });

    if (!codingJob) {
      throw new NotFoundException(`Coding job with ID ${id} not found`);
    }

    if (['review', 'results_applied'].includes(codingJob.status)) {
      return codingJob;
    }

    if (codingJob.status === 'completed' && status === 'paused') {
      return codingJob;
    }

    if (codingJob.status === status) {
      return codingJob;
    }

    codingJob.status = status;
    return this.codingJobRepository.save(codingJob);
  }

  async markCodingJobResultsApplied(
    id: number,
    workspaceId: number,
    manager?: EntityManager
  ): Promise<CodingJob> {
    const codingJobRepository = this.query.getCodingJobRepository(manager);
    const codingJob = await this.query.getCodingJobByIdForWorkspace(
      id,
      workspaceId,
      manager
    );

    if (codingJob.status === 'results_applied') {
      return codingJob;
    }

    if (codingJob.freshness_status === 'stale_source') {
      throw new BadRequestException(
        `Cannot apply results for coding job ${id} because its source responses changed`
      );
    }

    if (!['completed', 'review'].includes(codingJob.status)) {
      throw new BadRequestException(
        `Cannot apply results for coding job ${id} because it is not completed or submitted for review`
      );
    }

    codingJob.status = 'results_applied';
    return codingJobRepository.save(codingJob);
  }

  async restartCodingJobWithOpenUnits(
    codingJobId: number,
    workspaceId: number
  ): Promise<CodingJob> {
    const codingJob = await this.query.getCodingJob(codingJobId, workspaceId);
    codingJob.codingJob.status = 'open';
    await this.codingJobRepository.save(codingJob.codingJob);

    return codingJob.codingJob;
  }
}
