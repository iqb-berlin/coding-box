import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { assertCodingResourceMutation } from '../shared/coding-ownership.policy';
import { canTransitionCodingJobStatus, isProtectedCodingJobStatus } from './coding-job-status-policy';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobAccessService } from './coding-job-access.service';
import { CodingJobMutationService } from './coding-job-mutation.service';
import { CodingJobQueryService } from './coding-job-query.service';

@Injectable()
export class CodingJobStatusService {
  constructor(
    private readonly access: CodingJobAccessService,
    private readonly mutation: CodingJobMutationService,
    private readonly query: CodingJobQueryService
  ) {}

  async pauseCodingJob(id: number, workspaceId: number, actorUserId?: number): Promise<CodingJob> {
    return this.setOwnCodingJobStatus(id, workspaceId, 'paused', actorUserId);
  }

  async resumeCodingJob(id: number, workspaceId: number, actorUserId?: number): Promise<CodingJob> {
    return this.setOwnCodingJobStatus(id, workspaceId, 'active', actorUserId);
  }

  async submitCodingJob(id: number, workspaceId: number, actorUserId?: number): Promise<CodingJob> {
    return this.mutation.updateCodingJob(id, workspaceId, { status: 'completed' }, actorUserId, true);
  }

  private async setOwnCodingJobStatus(
    id: number,
    workspaceId: number,
    status: 'active' | 'paused',
    actorUserId?: number
  ): Promise<CodingJob> {
    return this.mutation.withLockedCodingJob(id, workspaceId, async (codingJob, manager) => {
      await this.access.assertAssignedCoderAccess(id, workspaceId, actorUserId as number, manager);
      if (
        isProtectedCodingJobStatus(codingJob.status) ||
        (codingJob.status === 'completed' && status === 'paused') ||
        codingJob.status === status
      ) {
        return codingJob;
      }
      if (!canTransitionCodingJobStatus(codingJob.status, status)) {
        throw new BadRequestException(`Cannot change coding job ${id} from ${codingJob.status} to ${status}`);
      }
      const previousStatus = codingJob.status;
      codingJob.status = status;
      const saved = await manager.getRepository(CodingJob).save(codingJob);
      await this.mutation.recordJobEvent(manager, workspaceId, id, 'CODING_JOB_UPDATED', actorUserId, {
        changedFields: ['status'], previousStatus, status
      });
      return saved;
    });
  }

  async markCodingJobResultsApplied(
    id: number,
    workspaceId: number,
    manager?: EntityManager
  ): Promise<CodingJob> {
    return this.mutation.withLockedCodingJob(id, workspaceId, async (codingJob, transactionManager) => {
      if (codingJob.status === 'results_applied') return codingJob;
      if (codingJob.freshness_status === 'stale_source') {
        throw new BadRequestException(
          `Cannot apply results for coding job ${id} because its source responses changed`
        );
      }
      if (!canTransitionCodingJobStatus(codingJob.status, 'results_applied', 'apply')) {
        throw new BadRequestException(
          `Cannot apply results for coding job ${id} because it is not completed or submitted for review`
        );
      }
      codingJob.status = 'results_applied';
      return transactionManager.getRepository(CodingJob).save(codingJob);
    }, manager);
  }

  async restartCodingJobWithOpenUnits(
    codingJobId: number,
    workspaceId: number,
    actorUserId?: number
  ): Promise<CodingJob> {
    return this.mutation.withLockedCodingJob(codingJobId, workspaceId, async (codingJob, manager) => {
      await assertCodingResourceMutation(manager, workspaceId, 'job', codingJobId, actorUserId);
      if (!canTransitionCodingJobStatus(codingJob.status, 'open', 'restart')) {
        throw new BadRequestException(`Cannot restart a coding job with status ${codingJob.status}`);
      }
      const progress = await this.query.getCodingJobProgress(codingJobId, manager);
      if (progress.open === 0) {
        throw new BadRequestException('Cannot restart a coding job without open units');
      }
      codingJob.status = 'open';
      return manager.getRepository(CodingJob).save(codingJob);
    });
  }
}
